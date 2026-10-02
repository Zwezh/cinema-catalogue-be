import { BadRequestException } from '@nestjs/common';
import { numberValue, strings, text } from './validation';
import type { TitleMetadata } from './title-metadata';

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

export function validateAddedDate(value: unknown): string {
  const addedDate = text(value, 'addedDate', 40);
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
  return addedDate;
}

export function validateTitleMetadata(
  body: Record<string, unknown>,
): TitleMetadata {
  return {
    addedDate: validateAddedDate(body.addedDate),
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
    genres: strings(body.genres, 'genres', 50),
    name: text(body.name, 'name'),
    actors: strings(body.actors, 'actors'),
    sequelsAndPrequels: strings(body.sequelsAndPrequels, 'sequelsAndPrequels'),
    similarMovies: strings(body.similarMovies, 'similarMovies'),
  };
}

export function validateYear(value: unknown): number | number[] {
  const year = Array.isArray(value)
    ? (value as unknown[]).map((item) => numberValue(item, 'year', 1, 9999))
    : numberValue(value, 'year', 1, 9999);
  if (
    Array.isArray(year) &&
    (year.length === 0 ||
      year.length > 200 ||
      new Set(year).size !== year.length)
  ) {
    throw new BadRequestException('year must contain 1 to 200 distinct years');
  }
  return year;
}
