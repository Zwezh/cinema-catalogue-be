import { Client } from '@libsql/client';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { objectBody, strings, text } from '../src/common/validation';
import { saveMovie } from '../src/database/movies/movie-writer';
import {
  defaultExtensions,
  defaultQuality,
  initializeDatabase,
  replaceCatalogStatements,
} from '../src/database/schema';
import { validateCreateMovie } from '../src/modules/movies/movie-validation';
import { Movie } from '../src/modules/movies/schemas';
import { SettingsDto } from '../src/modules/settings/dto';
import { validateSettings } from '../src/modules/settings/settings-validation';

type ImportOptions = {
  directory: string;
  movies: string;
  auth: string;
  settings: string;
  repairMovies: boolean;
  resetCatalogs: boolean;
};
export type ImportData = {
  auth: { id: string; secretKey: string }[];
  movies: Movie[];
  genres: string[];
  catalogs?: Pick<SettingsDto, 'quality' | 'extension'>;
};

export function parseImportArguments(args: string[]): ImportOptions {
  const options: ImportOptions = {
    directory: '../backups',
    movies: 'movies-sep-26.json',
    auth: 'auths-sep-26.json',
    settings: 'settings-sep-26.json',
    repairMovies: false,
    resetCatalogs: false,
  };
  let directorySet = false;
  for (let i = 0; i < args.length; i++) {
    const argument = args[i];
    if (argument === '--repair-movies') options.repairMovies = true;
    else if (argument === '--reset-catalogs') options.resetCatalogs = true;
    else if (
      argument === '--movies' ||
      argument === '--auth' ||
      argument === '--settings'
    ) {
      const value = args[++i];
      if (!value || value.startsWith('--'))
        throw new Error(`${argument} requires a filename`);
      options[argument.slice(2) as 'movies' | 'auth' | 'settings'] = value;
    } else if (!argument.startsWith('--') && !directorySet) {
      options.directory = argument;
      directorySet = true;
    } else throw new Error(`Unsupported import argument: ${argument}`);
  }
  return options;
}

function records(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value))
    throw new Error(`${field} backup must be an array`);
  return value as unknown[];
}
function mongoId(value: unknown): string {
  const record = objectBody(value, ['$oid']);
  const id = text(record.$oid, '_id.$oid', 24);
  if (!/^[a-f\d]{24}$/i.test(id))
    throw new Error('Backup ID must be a Mongo ObjectId');
  return id;
}
export function validateImportData(
  authValue: unknown,
  settingsValue: unknown,
  moviesValue: unknown,
): ImportData {
  const auth = records(authValue, 'auth').map((value) => {
    const row = objectBody(value, ['_id', 'secretKey', '__v']);
    const hash = text(row.secretKey, 'secretKey', 60);
    if (!/^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(hash))
      throw new Error('Auth backup must contain a bcrypt hash');
    return { id: mongoId(row._id), secretKey: hash };
  });
  if (auth.length !== 1)
    throw new Error('A single administrator auth record is required');
  const settingsRows = records(settingsValue, 'settings');
  if (settingsRows.length !== 1)
    throw new Error('Exactly one settings record is required');
  const settings = objectBody(settingsRows[0], [
    '_id',
    '__v',
    'quality',
    'extension',
    'genresForFilters',
  ]);
  const genres = strings(
    settings.genresForFilters ?? [],
    'genresForFilters',
    100,
  );
  let catalogs: ImportData['catalogs'];
  if (settings.quality !== undefined || settings.extension !== undefined) {
    const parsed = validateSettings({
      quality: settings.quality,
      extension: settings.extension,
      genresForFilters: genres,
    });
    catalogs = { quality: parsed.quality, extension: parsed.extension };
  }
  const movies = records(moviesValue, 'movies').map((value) => {
    if (typeof value !== 'object' || value === null || Array.isArray(value))
      throw new Error('Invalid movie backup record');
    const { _id, __v, ...fields } = value as Record<string, unknown>;
    void __v; // Known Mongo export metadata is not part of the application contract.
    for (const key of [
      'actors',
      'director',
      'countries',
      'genres',
      'sequelsAndPrequels',
      'similarMovies',
    ]) {
      if (fields[key] === undefined) fields[key] = [];
    }
    if (fields.ageRating === undefined) fields.ageRating = null;
    if (fields.isSeries === undefined) fields.isSeries = null;
    return { ...validateCreateMovie(fields), id: mongoId(_id) };
  });
  if (
    new Set(movies.map((movie) => movie.kpId)).size !== movies.length ||
    new Set(movies.map((movie) => movie.id)).size !== movies.length
  ) {
    throw new Error('Movie backup contains duplicate IDs or kpIds');
  }
  return { auth, movies, genres, catalogs };
}

export function readImportFiles(
  directory: string,
  options: ImportOptions,
): ImportData {
  const read = (filename: string, repair = false): unknown => {
    let contents = readFileSync(resolve(directory, filename), 'utf8');
    if (repair) contents = contents.replace('"Мэтт Росс"f', '"Мэтт Росс"');
    return JSON.parse(contents) as unknown;
  };
  return validateImportData(
    read(options.auth),
    read(options.settings),
    read(options.movies, options.repairMovies),
  );
}

export async function importBackups(
  client: Client,
  data: ImportData,
  resetCatalogs = false,
): Promise<void> {
  await initializeDatabase(client);
  const transaction = await client.transaction('write');
  try {
    const existingAuth = await transaction.execute(
      'SELECT id FROM auth_credentials',
    );
    if (existingAuth.rows.some((row) => row.id !== data.auth[0].id))
      throw new Error(
        'Existing administrator ID differs from backup; import aborted',
      );
    await transaction.batch(
      data.auth.map((auth) => ({
        sql: 'INSERT INTO auth_credentials (id, secret_key) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET secret_key = excluded.secret_key',
        args: [auth.id, auth.secretKey],
      })),
    );
    await transaction.execute({
      sql: "UPDATE app_settings SET genres_for_filters_json = ? WHERE id = 'settings:default'",
      args: [JSON.stringify(data.genres)],
    });
    const catalogs = resetCatalogs
      ? { quality: defaultQuality, extension: defaultExtensions }
      : data.catalogs;
    if (catalogs)
      await transaction.batch(
        replaceCatalogStatements(catalogs.quality, catalogs.extension),
      );
    for (const movie of data.movies) await saveMovie(transaction, movie, true);
    await transaction.commit();
  } finally {
    transaction.close();
  }
}
