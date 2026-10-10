import { Injectable } from '@nestjs/common';
import type { Row } from '@libsql/client';
import { DatabaseService } from '../database.service';
import { substringPattern } from '../search';
import { storedStringArray, storedYear, storedSeriesYear } from '../json';
import type {
  GalleryQuery,
  GalleryItem,
} from '../../modules/gallery/gallery.types';

@Injectable()
export class GalleryRepository {
  constructor(private readonly database: DatabaseService) {}
  async findAll(query: GalleryQuery) {
    const args: (string | number)[] = [];
    const conditions: string[] = [];
    if (query.search) {
      conditions.push("t.name_search LIKE ? ESCAPE '\\'");
      args.push(substringPattern(query.search));
    }
    if (query.rating !== undefined) {
      conditions.push('t.rating>=?');
      args.push(query.rating);
    }
    if (query.ageRating?.length) {
      conditions.push(
        `t.age_rating IN (${query.ageRating.map(() => '?').join(',')})`,
      );
      args.push(...query.ageRating);
    }
    if (query.fromYear !== undefined || query.toYear !== undefined) {
      conditions.push(
        'EXISTS(SELECT 1 FROM json_each(t.year_json) WHERE CAST(value AS INTEGER) BETWEEN ? AND ?)',
      );
      args.push(query.fromYear ?? 1, query.toYear ?? 9999);
    }
    if (query.quality?.length) {
      conditions.push(`(EXISTS(SELECT 1 FROM title_formats f JOIN qualities q ON q.id=f.quality_id WHERE f.title_id=t.id AND q.value IN (${query.quality.map(() => '?').join(',')}))
        OR EXISTS(SELECT 1 FROM seasons s JOIN season_formats f ON f.season_id=s.id JOIN qualities q ON q.id=f.quality_id WHERE s.series_id=t.id AND s.is_available=1 AND q.value IN (${query.quality.map(() => '?').join(',')})))`);
      args.push(...query.quality, ...query.quality);
    }
    for (const genre of Array.isArray(query.genres) ? query.genres : []) {
      conditions.push(
        'EXISTS(SELECT 1 FROM title_genres tg JOIN genres g ON g.id=tg.genre_id WHERE tg.title_id=t.id AND g.value=?)',
      );
      args.push(genre);
    }
    for (const [column, raw] of [
      ['actors_search_json', query.actors],
      ['director_search_json', query.directors],
    ] as const) {
      for (const person of raw
        ?.split(',')
        .map((x) => x.trim())
        .filter(Boolean) ?? []) {
        conditions.push(
          `EXISTS(SELECT 1 FROM json_each(t.${column}) WHERE value LIKE ? ESCAPE '\\')`,
        );
        args.push(substringPattern(person));
      }
    }

    if (query.kinds.length === 1) {
      conditions.push('t.kind=?');
      args.push(query.kinds[0]);
    }
    const libraryKinds = query.collections.flatMap((c) =>
      c === 'movies' ? ['movie'] : c === 'series' ? ['series'] : [],
    );
    // A Library membership wins only when its collection is in the requested scope.
    const libraryScope =
      libraryKinds.length === 2
        ? '1'
        : libraryKinds.length
          ? `t.kind='${libraryKinds[0]}'`
          : '0';
    const addedDate = 'COALESCE(l.added_date,w.added_date)';

    const from = `FROM titles t LEFT JOIN library_entries l ON l.title_id=t.id AND ${libraryScope} LEFT JOIN wishlist_entries w ON w.title_id=t.id AND ${query.collections.includes('wishlist') ? '1' : '0'} WHERE (l.title_id IS NOT NULL OR w.title_id IS NOT NULL) ${conditions.length ? `AND ${conditions.join(' AND ')}` : ''}`;
    const sorts: Record<string, string> = {
      name: 't.name',
      addedDate,
      rating: 't.rating',
      year: "CASE json_type(t.year_json) WHEN 'array' THEN json_extract(t.year_json,'$[0]') ELSE json_extract(t.year_json,'$') END",
      kpId: 'CAST(t.kp_id AS INTEGER)',
      ageRating: 't.age_rating',
      enName: 't.en_name',
      movieLength: 't.movie_length',
    };
    const tx = await this.database.readClient.transaction('read');
    try {
      const count = await tx.execute({
        sql: `SELECT COUNT(*) AS n ${from}`,
        args,
      });
      const page = await tx.execute({
        sql: `WITH page AS MATERIALIZED (SELECT t.id,${addedDate} AS added_date,l.title_id IS NOT NULL AS in_library,${sorts[query.key]} AS sort_value ${from} ORDER BY sort_value ${query.direction.toUpperCase()} NULLS LAST,t.id ASC LIMIT ? OFFSET ?) SELECT t.id,t.kind,t.kp_id,t.name,t.en_name,p.added_date,CASE WHEN p.in_library THEN CASE t.kind WHEN 'movie' THEN 'movies' ELSE 'series' END ELSE 'wishlist' END AS collection,t.year_json,t.rating,t.age_rating,t.movie_length,t.poster_url,t.compact_poster_url,t.genres_json,t.director_json FROM page p JOIN titles t ON t.id=p.id ORDER BY p.sort_value ${query.direction.toUpperCase()} NULLS LAST,p.id ASC`,
        args: [...args, query.pageSize, query.currentPage * query.pageSize],
      });
      const ids = page.rows.map((r) => String(r.id));
      const details = new Map<string, Row>();
      const qualities = new Map<string, string[]>();
      if (ids.length) {
        const placeholders = ids.map(() => '?').join(',');
        const [series, quality] = await tx.batch([
          {
            sql: `SELECT d.title_id,d.start_year,d.end_year,d.production_status,(SELECT COUNT(*) FROM seasons s WHERE s.series_id=d.title_id AND s.is_available=1 AND s.season_number>0) AS available_count,(SELECT COUNT(*) FROM seasons s WHERE s.series_id=d.title_id) AS recorded_count FROM series_details d WHERE d.title_id IN (${placeholders})`,
            args: ids,
          },
          {
            sql: `SELECT f.title_id,q.value FROM title_formats f JOIN titles t ON t.id=f.title_id JOIN qualities q ON q.id=f.quality_id WHERE t.kind='movie' AND f.title_id IN (${placeholders}) UNION SELECT s.series_id AS title_id,q.value FROM seasons s JOIN season_formats f ON f.season_id=s.id JOIN qualities q ON q.id=f.quality_id WHERE s.is_available=1 AND s.series_id IN (${placeholders}) ORDER BY title_id,value`,
            args: [...ids, ...ids],
          },
        ]);
        for (const row of series.rows) details.set(String(row.title_id), row);
        for (const row of quality.rows) {
          const id = String(row.title_id);
          qualities.set(id, [...(qualities.get(id) ?? []), String(row.value)]);
        }
      }
      const nullable = (value: Row[string]) =>
        value === null ? null : Number(value);
      const list: GalleryItem[] = page.rows.map((r) => {
        const id = String(r.id),
          d = details.get(id);
        if (r.kind === 'series' && !d)
          throw new Error('Missing series subtype');
        return {
          id,
          kind: r.kind as GalleryItem['kind'],
          collection: r.collection as GalleryItem['collection'],
          kpId: r.kp_id === null ? null : String(r.kp_id),
          name: String(r.name),
          enName: String(r.en_name),
          addedDate: String(r.added_date),
          year:
            r.kind === 'series'
              ? storedSeriesYear(r.year_json)
              : r.year_json === 'null'
                ? null
                : storedYear(r.year_json),
          rating: nullable(r.rating),
          ageRating: nullable(r.age_rating),
          movieLength: nullable(r.movie_length),
          posterUrl: String(r.poster_url),
          compactPosterUrl: String(r.compact_poster_url),
          genres: storedStringArray(r.genres_json, 'genres_json'),
          director: storedStringArray(r.director_json, 'director_json'),
          qualityValues: qualities.get(id) ?? [],
          series: d
            ? {
                startYear: nullable(d.start_year),
                endYear: nullable(d.end_year),
                productionStatus: d.production_status as NonNullable<
                  GalleryItem['series']
                >['productionStatus'],
                availableSeasonCount: Number(d.available_count),
                recordedSeasonCount: Number(d.recorded_count),
              }
            : null,
        };
      });
      return {
        list,
        totalCount: Number(count.rows[0].n),
        currentPage: query.currentPage,
      };
    } finally {
      tx.close();
    }
  }
}
