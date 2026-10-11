import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database.service';
import { writeTransaction } from '../transaction';
import type { StatisticsSnapshot } from '../../modules/statistics/statistics.types';
import { parseStatisticsSnapshot } from '../../modules/statistics/statistics-validation';

// Keep aggregation on compact metadata instead of fetching title descriptions/posters.
const library = (columns: string) => `WITH library AS (
 SELECT ${columns} FROM titles t INDEXED BY titles_statistics JOIN library_entries l ON l.title_id=t.id
)`;
const queries = [
  `${library('t.id,t.kind,t.movie_length')} SELECT COUNT(*) AS titles,
 COALESCE(SUM(kind='movie'),0) AS movies, COALESCE(SUM(kind='series'),0) AS series,
 COALESCE(SUM(CASE WHEN kind='movie' THEN movie_length ELSE 0 END),0) AS runtime,
 COALESCE(SUM(kind='movie' AND movie_length IS NOT NULL),0) AS known_runtime,
 (SELECT COUNT(*) FROM seasons s JOIN library l ON l.id=s.series_id) AS recorded,
 (SELECT COUNT(*) FROM seasons s JOIN library l ON l.id=s.series_id WHERE s.is_available=1 AND s.season_number>0) AS available,
 COALESCE(SUM(NOT EXISTS(SELECT 1 FROM title_genres tg WHERE tg.title_id=library.id)),0) AS no_genres
 FROM library`,
  `SELECT g.value AS label,COUNT(DISTINCT l.title_id) AS n FROM library_entries l
 JOIN title_genres tg ON tg.title_id=l.title_id JOIN genres g ON g.id=tg.genre_id
 GROUP BY g.value ORDER BY n DESC,g.value ASC`,
  `${library('t.id,t.kind')}, formats AS (
 SELECT l.id,q.value FROM library l JOIN title_formats f ON f.title_id=l.id JOIN qualities q ON q.id=f.quality_id WHERE l.kind='movie'
 UNION
 SELECT l.id,q.value FROM library l JOIN seasons s ON s.series_id=l.id JOIN season_formats f ON f.season_id=s.id JOIN qualities q ON q.id=f.quality_id WHERE l.kind='series' AND s.is_available=1
 ), title_quality AS (
 SELECT l.id,CASE COUNT(f.value) WHEN 0 THEN 'none' WHEN 1 THEN 'quality' ELSE 'multiple' END AS kind,
 CASE WHEN COUNT(f.value)=1 THEN MAX(f.value) ELSE NULL END AS value
 FROM library l LEFT JOIN formats f ON f.id=l.id GROUP BY l.id
 ) SELECT kind,value,COUNT(*) AS n FROM title_quality GROUP BY kind,value ORDER BY n DESC,kind ASC,value ASC`,
  `${library('t.id,t.kind,t.year_json')}, years AS (
 SELECT CASE WHEN library.kind='series' AND d.start_year IS NOT NULL THEN d.start_year ELSE
 (SELECT MIN(CAST(value AS INTEGER)) FROM json_each(year_json) WHERE type='integer' AND value BETWEEN 1 AND 9999) END AS year FROM library LEFT JOIN series_details d ON d.title_id=library.id
 ) SELECT CASE WHEN year IS NOT NULL THEN CAST(year/10 AS INTEGER)*10 ELSE NULL END AS decade,COUNT(*) AS n FROM years GROUP BY decade ORDER BY decade ASC`,
  `${library('t.id,t.rating')}, rated AS (
 SELECT rating,ROW_NUMBER() OVER(ORDER BY rating) AS position,COUNT(*) OVER() AS total
 FROM library WHERE rating IS NOT NULL AND rating BETWEEN 0 AND 10
 ) SELECT COUNT(*) AS known,AVG(rating) AS mean,
 AVG(CASE WHEN position IN ((total+1)/2,(total+2)/2) THEN rating END) AS median,
 COALESCE(SUM(rating>=9),0) AS high FROM rated`,
  `${library('t.id,t.rating')}, bins AS (SELECT 0 AS n UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9)
 SELECT b.n,COUNT(l.id) AS count FROM bins b LEFT JOIN library l ON l.rating>=b.n AND (l.rating<b.n+1 OR (b.n=9 AND l.rating=10)) GROUP BY b.n ORDER BY b.n`,
];

@Injectable()
export class StatisticsRepository {
  constructor(private readonly database: DatabaseService) {}

  async getSnapshot(): Promise<StatisticsSnapshot | null> {
    const result = await this.database.client.execute(
      "SELECT payload_json FROM library_statistics_snapshot WHERE id='library'",
    );
    if (!result.rows.length) return null;
    return parseStatisticsSnapshot(
      JSON.parse(String(result.rows[0].payload_json)) as unknown,
    );
  }

  scan(): Promise<StatisticsSnapshot> {
    // Primary write transaction serializes scans and keeps all metrics consistent.
    // Statistics persistence needs no catalog replica synchronization.
    return writeTransaction(this.database.client, async (tx) => {
      const [counts, genres, qualities, years, ratings, bins] =
        await tx.batch(queries);
      const c = counts.rows[0];
      const r = ratings.rows[0];
      const knownCount = Number(r.known);
      const snapshot = parseStatisticsSnapshot({
        version: 1,
        scannedAt: new Date().toISOString(),
        totals: {
          titles: Number(c.titles),
          movies: Number(c.movies),
          series: Number(c.series),
          movieRuntimeMinutes: Number(c.runtime),
          knownMovieRuntimes: Number(c.known_runtime),
          recordedSeasons: Number(c.recorded),
          availableSeasons: Number(c.available),
          titlesWithoutGenres: Number(c.no_genres),
        },
        genres: genres.rows.map((row) => ({
          label: String(row.label),
          count: Number(row.n),
        })),
        qualities: qualities.rows.map((row) => ({
          kind: row.kind,
          value: row.value,
          count: Number(row.n),
        })),
        decades: years.rows
          .filter((row) => row.decade !== null)
          .map((row) => ({ start: Number(row.decade), count: Number(row.n) })),
        unknownYears: Number(
          years.rows.find((row) => row.decade === null)?.n ?? 0,
        ),
        ratings: {
          knownCount,
          unknownCount: Number(c.titles) - knownCount,
          mean: r.mean === null ? null : Number(r.mean),
          median: r.median === null ? null : Number(r.median),
          highRatedCount: Number(r.high),
          bins: bins.rows.map((row) => ({
            from: Number(row.n),
            to: Number(row.n) + 1,
            count: Number(row.count),
          })),
        },
      });
      await tx.execute({
        sql: `INSERT INTO library_statistics_snapshot(id,schema_version,scanned_at,payload_json) VALUES('library',1,?,?)
       ON CONFLICT(id) DO UPDATE SET schema_version=excluded.schema_version,scanned_at=excluded.scanned_at,payload_json=excluded.payload_json`,
        args: [snapshot.scannedAt, JSON.stringify(snapshot)],
      });
      return snapshot;
    });
  }
}
