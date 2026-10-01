import { BadRequestException } from '@nestjs/common';
import {
  numberValue,
  objectBody,
  strings,
  text,
} from '../../common/validation';
import { CreateMovieDto, MovieDto } from './dto';

const fields = [
  'addedDate',
  'ageRating',
  'backdropUrl',
  'compactPosterUrl',
  'countries',
  'description',
  'director',
  'enName',
  'extension',
  'genres',
  'isSeries',
  'kpId',
  'posterUrl',
  'name',
  'movieLength',
  'actors',
  'quality',
  'rating',
  'year',
  'sequelsAndPrequels',
  'similarMovies',
] as const;

function imageUrl(value: unknown, field: string): string {
  const url = text(value, field, 2048, true);
  if (!url) return url; // Missing artwork is represented as an empty string.
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') return url;
  } catch {
    /* Return the same validation error for all invalid URLs. */
  }
  throw new BadRequestException(`${field} must be an HTTP or HTTPS URL`);
}

function parseMovie(body: Record<string, unknown>): CreateMovieDto {
  const addedDate = text(body.addedDate, 'addedDate', 40);
  // Accept ISO dates and timestamps, rejecting rollover dates such as February 30.
  const match =
    /^(\d{4}-\d{2}-\d{2})(?:T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2}))?$/.exec(
      addedDate,
    );
  if (
    !match ||
    !Number.isFinite(Date.parse(addedDate)) ||
    new Date(`${match[1]}T00:00:00Z`).toISOString().slice(0, 10) !== match[1]
  ) {
    throw new BadRequestException(
      'addedDate must be a valid ISO date or timestamp',
    );
  }
  const year = Array.isArray(body.year)
    ? (body.year as unknown[]).map((item) => numberValue(item, 'year', 1, 9999))
    : numberValue(body.year, 'year', 1, 9999);
  if (
    Array.isArray(year) &&
    (year.length === 0 ||
      year.length > 200 ||
      new Set(year).size !== year.length)
  ) {
    throw new BadRequestException('year must contain 1 to 200 distinct years');
  }
  if (body.isSeries !== null && typeof body.isSeries !== 'boolean') {
    throw new BadRequestException('isSeries must be boolean or null');
  }
  return {
    addedDate,
    ageRating:
      body.ageRating === null
        ? null
        : numberValue(body.ageRating, 'ageRating', 0, 21),
    backdropUrl: imageUrl(body.backdropUrl, 'backdropUrl'),
    compactPosterUrl: imageUrl(body.compactPosterUrl, 'compactPosterUrl'),
    posterUrl: imageUrl(body.posterUrl, 'posterUrl'),
    countries: strings(body.countries, 'countries'),
    description: text(body.description, 'description', 50000, true),
    director: strings(body.director, 'director'),
    enName: text(body.enName, 'enName', 1000, true),
    extension: text(body.extension, 'extension', 100),
    genres: strings(body.genres, 'genres', 50),
    isSeries: body.isSeries as boolean | null,
    kpId: numberValue(body.kpId, 'kpId', 1, Number.MAX_SAFE_INTEGER),
    name: text(body.name, 'name'),
    movieLength: numberValue(body.movieLength, 'movieLength', 0, 100000),
    actors: strings(body.actors, 'actors'),
    quality: text(body.quality, 'quality', 100),
    rating: numberValue(body.rating, 'rating', 0, 10, false),
    year,
    sequelsAndPrequels: strings(body.sequelsAndPrequels, 'sequelsAndPrequels'),
    similarMovies: strings(body.similarMovies, 'similarMovies'),
  };
}
export function validateCreateMovie(value: unknown): CreateMovieDto {
  return parseMovie(objectBody(value, fields));
}
export function validateUpdateMovie(value: unknown): MovieDto {
  const body = objectBody(value, [...fields, 'id']);
  return { ...parseMovie(body), id: text(body.id, 'id', 100) };
}
