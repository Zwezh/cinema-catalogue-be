import { createClient, InStatement } from '@libsql/client';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  defaultExtensions,
  defaultQuality,
  initializeDatabase,
  replaceCatalogStatements,
} from '../src/database/schema';
import { CreateMovieDto } from '../src/modules/movies/dto';

type MongoId = { $oid: string };
type AuthBackup = { _id: MongoId; secretKey: string };
type SettingsBackup = {
  genresForFilters?: string[];
};
type MovieBackup = CreateMovieDto & { _id: MongoId };

const databaseUrl = process.env.TURSO_DATABASE_URL;
if (!databaseUrl) {
  throw new Error('TURSO_DATABASE_URL is required');
}

const backupDirectory = resolve(process.argv[2] ?? '../backups');
const client = createClient({
  url: databaseUrl,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

function readBackup<T>(name: string, repairMovies = false): T {
  let contents = readFileSync(resolve(backupDirectory, name), 'utf8');
  if (repairMovies) {
    // The supplied export contains one accidental byte after this array item.
    contents = contents.replace('"Мэтт Росс"f', '"Мэтт Росс"');
  }
  return JSON.parse(contents) as T;
}

function movieStatement(movie: MovieBackup): InStatement {
  return {
    sql: `INSERT OR REPLACE INTO movies (
      id, added_date, age_rating, backdrop_url, compact_poster_url,
      countries_json, description, director_json, en_name, extension,
      genres_json, is_series, kp_id, poster_url, name, movie_length,
      actors_json, quality, rating, year_json, sequels_and_prequels_json,
      similar_movies_json
    ) VALUES (${Array(22).fill('?').join(', ')})`,
    args: [
      movie._id.$oid,
      movie.addedDate,
      movie.ageRating ?? null,
      movie.backdropUrl,
      movie.compactPosterUrl,
      JSON.stringify(movie.countries ?? []),
      movie.description,
      JSON.stringify(movie.director ?? []),
      movie.enName,
      movie.extension,
      JSON.stringify(movie.genres ?? []),
      movie.isSeries == null ? null : Number(movie.isSeries),
      movie.kpId,
      movie.posterUrl,
      movie.name,
      movie.movieLength,
      JSON.stringify(movie.actors ?? []),
      movie.quality,
      movie.rating,
      JSON.stringify(movie.year),
      JSON.stringify(movie.sequelsAndPrequels ?? []),
      JSON.stringify(movie.similarMovies ?? []),
    ],
  };
}

async function importBackups(): Promise<void> {
  const auth = readBackup<AuthBackup[]>('auths-sep-26.json');
  const settings = readBackup<SettingsBackup[]>('settings-sep-26.json');
  const movies = readBackup<MovieBackup[]>('movies-sep-26.json', true);

  await initializeDatabase(client);
  await client.batch(
    auth.map((record) => ({
      sql: `INSERT INTO auth (id, secret_key) VALUES (?, ?)
        ON CONFLICT(id) DO UPDATE SET secret_key = excluded.secret_key`,
      args: [record._id.$oid, record.secretKey],
    })),
    'write',
  );

  await client.batch(
    [
      {
        sql: `UPDATE settings SET genres_for_filters_json = ? WHERE id = 1`,
        args: [JSON.stringify(settings[0]?.genresForFilters ?? [])],
      },
      ...replaceCatalogStatements(defaultQuality, defaultExtensions),
    ],
    'write',
  );

  const chunkSize = 100;
  for (let index = 0; index < movies.length; index += chunkSize) {
    await client.batch(
      movies.slice(index, index + chunkSize).map(movieStatement),
      'write',
    );
  }
  console.log(
    `Imported ${auth.length} auth record(s), ${settings.length} settings record(s), and ${movies.length} movie(s).`,
  );
}

importBackups().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
