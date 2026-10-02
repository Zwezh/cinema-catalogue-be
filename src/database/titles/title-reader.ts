import { membershipTable } from './membership-tables';
import type { Transaction, Row } from '@libsql/client';
import { storedStringArray, storedYear } from '../json';
import { TitleNotFoundError } from '../../shared/titles/title.errors';
import type {
  Title,
  Format,
  Membership,
  SeriesDetails,
} from '../../shared/titles/title.types';

export class TitleReader {
  async read(
    tx: Transaction,
    id: string,
    membership: Membership,
    seriesOnly = false,
  ): Promise<Title> {
    const titles = await this.readMany(tx, [id], membership, seriesOnly);
    if (!titles[0]) throw new TitleNotFoundError();
    return titles[0];
  }
  async readMany(
    tx: Transaction,
    ids: string[],
    membership: Membership,
    seriesOnly = false,
  ): Promise<Title[]> {
    if (!ids.length) return [];
    const placeholders = ids.map(() => '?').join(',');
    const [titles, formats, details, seasons, seasonFormatRows] =
      await tx.batch([
        {
          sql: `SELECT t.*,m.added_date FROM titles t JOIN ${membershipTable[membership]} m ON m.title_id=t.id WHERE t.id IN (${placeholders}) ${seriesOnly ? "AND t.kind='series'" : ''}`,
          args: ids,
        },
        {
          sql: `SELECT * FROM title_formats WHERE title_id IN (${placeholders}) ORDER BY quality_id,extension_id`,
          args: ids,
        },
        {
          sql: `SELECT * FROM series_summary WHERE title_id IN (${placeholders})`,
          args: ids,
        },
        {
          sql: `SELECT * FROM seasons WHERE series_id IN (${placeholders}) ORDER BY season_number`,
          args: ids,
        },
        {
          sql: `SELECT f.* FROM season_formats f JOIN seasons s ON s.id=f.season_id WHERE s.series_id IN (${placeholders}) ORDER BY f.quality_id,f.extension_id`,
          args: ids,
        },
      ]);
    const groupFormats = (rows: Row[], column: 'title_id' | 'season_id') => {
      const grouped = new Map<string, Format[]>();
      for (const row of rows) {
        const key = String(row[column]);
        const group = grouped.get(key) ?? [];
        group.push({
          qualityId: String(row.quality_id),
          extensionId: String(row.extension_id),
        });
        grouped.set(key, group);
      }
      return grouped;
    };
    const titleFormats = groupFormats(formats.rows, 'title_id');
    const seasonFormats = groupFormats(seasonFormatRows.rows, 'season_id');
    const groupedSeasons = new Map<string, SeriesDetails['seasons']>();
    for (const row of seasons.rows) {
      const key = String(row.series_id);
      const group = groupedSeasons.get(key) ?? [];
      group.push({
        seasonNumber: Number(row.season_number),
        releaseYear:
          row.release_year === null ? null : Number(row.release_year),
        isAvailable: Boolean(row.is_available),
        formats: seasonFormats.get(String(row.id)) ?? [],
      });
      groupedSeasons.set(key, group);
    }
    const seriesDetails = new Map(
      details.rows.map((row) => [String(row.title_id), row]),
    );
    const byId = new Map(titles.rows.map((row) => [String(row.id), row]));
    return ids
      .filter((id) => byId.has(id))
      .map((id) => {
        const r = byId.get(id)!;
        let series: SeriesDetails | null = null;
        let availableSeasonCount: number | null = null;
        if (r.kind === 'series') {
          const detail = seriesDetails.get(id);
          if (!detail) throw new Error('Missing series subtype');
          series = {
            startYear:
              detail.start_year === null ? null : Number(detail.start_year),
            endYear: detail.end_year === null ? null : Number(detail.end_year),
            productionStatus:
              detail.production_status as SeriesDetails['productionStatus'],
            announcedSeasonCount:
              detail.announced_season_count === null
                ? null
                : Number(detail.announced_season_count),
            seasons: groupedSeasons.get(id) ?? [],
          };
          availableSeasonCount = Number(detail.available_season_count);
        }
        return {
          id,
          kind: r.kind as Title['kind'],
          addedDate: String(r.added_date),
          kpId: r.kp_id === null ? null : String(r.kp_id),
          name: String(r.name),
          enName: String(r.en_name),
          description: String(r.description),
          releaseDate: r.release_date === null ? null : String(r.release_date),
          ageRating: r.age_rating === null ? null : Number(r.age_rating),
          rating: r.rating === null ? null : Number(r.rating),
          movieLength: r.movie_length === null ? null : Number(r.movie_length),
          posterUrl: String(r.poster_url),
          compactPosterUrl: String(r.compact_poster_url),
          backdropUrl: String(r.backdrop_url),
          countries: storedStringArray(r.countries_json, 'countries_json'),
          genres: storedStringArray(r.genres_json, 'genres_json'),
          director: storedStringArray(r.director_json, 'director_json'),
          actors: storedStringArray(r.actors_json, 'actors_json'),
          year: r.year_json === 'null' ? null : storedYear(r.year_json),
          sequelsAndPrequels: storedStringArray(
            r.sequels_and_prequels_json,
            'sequels_and_prequels_json',
          ),
          similarMovies: storedStringArray(
            r.similar_movies_json,
            'similar_movies_json',
          ),
          formats: titleFormats.get(id) ?? [],
          series,
          availableSeasonCount,
        };
      });
  }
}
