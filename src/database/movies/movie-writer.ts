import type { Transaction } from '@libsql/client';
import { movieColumns, movieValues } from '../movie-record';
import { optionId } from '../../shared/titles/catalog-options';
import type { MovieDto } from '../../modules/movies/dto';
import {
  CatalogOptionError,
  TitleConflictError,
} from '../../shared/titles/title.errors';
import { assertProviderId, syncGenres } from '../titles/title-writer';

export async function saveMovie(
  tx: Transaction,
  movie: MovieDto,
  importing = false,
): Promise<void> {
  if (movie.isSeries === true && !importing)
    throw new Error('Series must use the series repository');
  const kind = movie.isSeries === true ? 'series' : 'movie';
  await assertProviderId(tx, movie.id, String(movie.kpId));
  const columns = movieColumns.filter(
    (c) => !['added_date', 'is_series', 'quality', 'extension'].includes(c),
  );
  const allValues = movieValues(movie);
  const values = columns.map((c) =>
    c === 'kp_id' ? String(movie.kpId) : allValues[movieColumns.indexOf(c)],
  );
  const prior = await tx.execute({
    sql: 'SELECT kind FROM titles WHERE id=?',
    args: [movie.id],
  });
  if (prior.rows[0] && prior.rows[0].kind !== kind)
    throw new TitleConflictError();
  const format = await tx.execute({
    sql: `SELECT q.id AS quality_id,e.id AS extension_id FROM qualities q CROSS JOIN extensions e
    WHERE q.value=? AND e.value=? AND ((q.is_active=1 AND e.is_active=1)
    OR EXISTS(SELECT 1 FROM title_formats f WHERE f.title_id=? AND f.quality_id=q.id AND f.extension_id=e.id))`,
    args: [movie.quality, movie.extension, movie.id],
  });
  if (!format.rows.length && !importing) throw new CatalogOptionError();
  if (!format.rows.length) {
    await tx.execute({
      sql: 'INSERT INTO qualities(id,value,title,is_active) VALUES(?,?,?,0) ON CONFLICT(value) DO NOTHING',
      args: [optionId('quality', movie.quality), movie.quality, movie.quality],
    });
    await tx.execute({
      sql: 'INSERT INTO extensions(id,value,is_active) VALUES(?,?,0) ON CONFLICT(value) DO NOTHING',
      args: [optionId('extension', movie.extension), movie.extension],
    });
  }
  await tx.execute({
    sql: `INSERT INTO titles(id,kind,${columns.join(',')}) VALUES(?,?,${columns.map(() => '?').join(',')})
    ON CONFLICT(id) DO UPDATE SET ${columns.map((c) => `${c}=excluded.${c}`).join(',')}`,
    args: [movie.id, kind, ...values],
  });
  await tx.execute({
    sql: `INSERT INTO ${kind === 'movie' ? 'movie_details' : 'series_details'}(title_id) VALUES(?) ON CONFLICT DO NOTHING`,
    args: [movie.id],
  });
  await tx.execute({
    sql: 'INSERT INTO library_entries VALUES(?,?) ON CONFLICT(title_id) DO UPDATE SET added_date=excluded.added_date',
    args: [movie.id, movie.addedDate],
  });
  await tx.execute({
    sql: 'INSERT INTO legacy_movie_values VALUES(?,?,?) ON CONFLICT(title_id) DO UPDATE SET is_series=excluded.is_series,kp_id=excluded.kp_id',
    args: [
      movie.id,
      movie.isSeries === null ? null : Number(movie.isSeries),
      movie.kpId,
    ],
  });
  // A legacy movie PUT carries one format. Preserve additional formats on
  // metadata-only edits instead of silently discarding wishlist details.
  const current = await tx.execute({
    sql: `SELECT q.value AS quality,e.value AS extension FROM title_formats f
    JOIN qualities q ON q.id=f.quality_id JOIN extensions e ON e.id=f.extension_id
    WHERE f.title_id=? ORDER BY f.quality_id,f.extension_id LIMIT 1`,
    args: [movie.id],
  });
  if (
    current.rows[0]?.quality !== movie.quality ||
    current.rows[0]?.extension !== movie.extension
  ) {
    await tx.execute({
      sql: 'DELETE FROM title_formats WHERE title_id=?',
      args: [movie.id],
    });
    await tx.execute({
      sql: 'INSERT INTO title_formats SELECT ?,q.id,e.id FROM qualities q CROSS JOIN extensions e WHERE q.value=? AND e.value=?',
      args: [movie.id, movie.quality, movie.extension],
    });
  }
  await syncGenres(tx, movie.id, movie.genres);
}
