import { catalogIdMaxLength } from './catalog-options';
import { providerId } from './provider-id';
import { BadRequestException } from '@nestjs/common';
import { numberValue, objectBody, text } from '../../common/validation';
import {
  validateTitleMetadata,
  validateYear,
} from '../../common/title-validation';
import type { TitleInput, Format, SeriesDetails } from './title.types';

function optionalNumber(
  value: unknown,
  field: string,
  max: number,
): number | null {
  return value === undefined || value === null
    ? null
    : numberValue(value, field, 0, max);
}
function optionalYear(value: unknown, field: string): number | null {
  return value === undefined || value === null
    ? null
    : numberValue(value, field, 1, 9999);
}
export function parseFormats(value: unknown): Format[] {
  if (!Array.isArray(value) || value.length > 100)
    throw new BadRequestException('formats must contain at most 100 pairs');
  const formats = (value as unknown[]).map((entry) => {
    const item = objectBody(entry, ['qualityId', 'extensionId']);
    return {
      qualityId: text(item.qualityId, 'qualityId', catalogIdMaxLength),
      extensionId: text(item.extensionId, 'extensionId', catalogIdMaxLength),
    };
  });
  if (
    new Set(formats.map((f) => JSON.stringify([f.qualityId, f.extensionId])))
      .size !== formats.length
  )
    throw new BadRequestException('Duplicate format pair');
  return formats;
}
function parseSeries(value: unknown): SeriesDetails {
  const body = objectBody(value, [
    'startYear',
    'endYear',
    'productionStatus',
    'announcedSeasonCount',
    'seasons',
  ]);
  const startYear = optionalYear(body.startYear, 'startYear');
  const endYear = optionalYear(body.endYear, 'endYear');
  const productionStatus = body.productionStatus ?? 'unknown';
  if (
    productionStatus !== 'unknown' &&
    productionStatus !== 'in_production' &&
    productionStatus !== 'finished'
  )
    throw new BadRequestException('Invalid productionStatus');
  if (
    endYear !== null &&
    (startYear === null ||
      endYear < startYear ||
      productionStatus !== 'finished')
  )
    throw new BadRequestException(
      'endYear requires a finished series and must not precede startYear',
    );
  const raw = body.seasons ?? [];
  if (!Array.isArray(raw) || raw.length > 1000)
    throw new BadRequestException('seasons must contain at most 1000 seasons');
  const seasons = (raw as unknown[]).map((entry) => {
    const s = objectBody(entry, [
      'seasonNumber',
      'releaseYear',
      'isAvailable',
      'formats',
    ]);
    if (typeof s.isAvailable !== 'boolean')
      throw new BadRequestException('isAvailable must be boolean');
    return {
      seasonNumber: numberValue(s.seasonNumber, 'seasonNumber', 0, 10000),
      releaseYear: optionalYear(s.releaseYear, 'releaseYear'),
      isAvailable: s.isAvailable,
      formats: parseFormats(s.formats ?? []),
    };
  });
  if (new Set(seasons.map((s) => s.seasonNumber)).size !== seasons.length)
    throw new BadRequestException('Duplicate season number');
  return {
    startYear,
    endYear,
    productionStatus,
    announcedSeasonCount: optionalNumber(
      body.announcedSeasonCount,
      'announcedSeasonCount',
      10000,
    ),
    seasons,
  };
}

const metadataKeys = [
  'addedDate',
  'ageRating',
  'backdropUrl',
  'compactPosterUrl',
  'countries',
  'description',
  'director',
  'enName',
  'genres',
  'posterUrl',
  'name',
  'movieLength',
  'actors',
  'rating',
  'year',
  'sequelsAndPrequels',
  'similarMovies',
] as const;
export function validateTitle(value: unknown, seriesOnly = false): TitleInput {
  const body = objectBody(value, [
    ...metadataKeys,
    'kind',
    'kpId',
    'formats',
    'releaseDate',
    'series',
  ]);
  const kind = seriesOnly ? 'series' : body.kind;
  if (
    (kind !== 'movie' && kind !== 'series') ||
    (seriesOnly && body.kind !== undefined && body.kind !== 'series')
  )
    throw new BadRequestException('kind must be movie or series');
  const defaults: Record<string, unknown> = {
    ageRating: null,
    backdropUrl: '',
    compactPosterUrl: '',
    countries: [],
    description: '',
    director: [],
    enName: '',
    genres: [],
    posterUrl: '',
    movieLength: 0,
    actors: [],
    rating: 0,
    year: 1,
    sequelsAndPrequels: [],
    similarMovies: [],
  };
  for (const key of metadataKeys)
    if (body[key] !== undefined) defaults[key] = body[key];
  const rating =
    body.rating === undefined || body.rating === null
      ? null
      : numberValue(body.rating, 'rating', 0, 10, false);
  const movieLength = optionalNumber(body.movieLength, 'movieLength', 100000);
  const metadata = validateTitleMetadata(defaults);
  const releaseDate =
    body.releaseDate === undefined || body.releaseDate === null
      ? null
      : text(body.releaseDate, 'releaseDate', 10);
  if (
    releaseDate !== null &&
    (!/^\d{4}-\d{2}-\d{2}$/.test(releaseDate) ||
      !Number.isFinite(Date.parse(releaseDate)) ||
      new Date(releaseDate).toISOString().slice(0, 10) !== releaseDate)
  )
    throw new BadRequestException(
      'releaseDate must be a valid YYYY-MM-DD date',
    );
  if (kind === 'movie' && body.series != null)
    throw new BadRequestException('Movies cannot contain series details');
  return {
    ...metadata,
    kind,
    kpId: providerId(body.kpId),
    year: body.year == null ? null : validateYear(body.year),
    rating,
    movieLength,
    releaseDate,
    formats: parseFormats(body.formats ?? []),
    series: kind === 'series' ? parseSeries(body.series ?? {}) : null,
  };
}
