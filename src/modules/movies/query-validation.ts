import { BadRequestException } from '@nestjs/common';
import { PaginationParamsDto } from './dto';

export const movieSortKeys = [
  'addedDate',
  'ageRating',
  'enName',
  'extension',
  'isSeries',
  'kpId',
  'movieLength',
  'name',
  'quality',
  'rating',
  'year',
] as const;

export function validateMovieQuery(value: unknown): PaginationParamsDto {
  if (typeof value !== 'object' || value === null) {
    throw new BadRequestException('Query must be an object');
  }
  const query = value as Record<string, unknown>;
  const number = (
    key: string,
    fallback: number | undefined,
    min: number,
    max: number,
    integer = true,
  ): number | undefined => {
    const raw = query[key];
    if (raw === undefined) return fallback;
    if (
      (typeof raw !== 'string' && typeof raw !== 'number') ||
      (typeof raw === 'string' && !raw.trim())
    ) {
      throw new BadRequestException(`${key} must be a number`);
    }
    const result = Number(raw);
    if (
      !Number.isFinite(result) ||
      result < min ||
      result > max ||
      (integer && !Number.isSafeInteger(result))
    ) {
      throw new BadRequestException(`${key} is outside the supported range`);
    }
    return result;
  };
  const text = (key: string): string | undefined => {
    const raw = query[key];
    if (raw === undefined) return undefined;
    if (typeof raw !== 'string' || raw.length > 1000) {
      throw new BadRequestException(
        `${key} must be a string of at most 1000 characters`,
      );
    }
    return raw;
  };
  const key = text('key') ?? 'name';
  if (!movieSortKeys.some((candidate) => candidate === key)) {
    throw new BadRequestException('Unsupported sort key');
  }
  const direction = text('direction') ?? 'asc';
  if (direction !== 'asc' && direction !== 'desc') {
    throw new BadRequestException('direction must be asc or desc');
  }
  const genres = query.genres;
  if (
    genres !== undefined &&
    typeof genres !== 'string' &&
    !Array.isArray(genres)
  ) {
    throw new BadRequestException(
      'genres must be a string or array of strings',
    );
  }
  const genreList: unknown[] =
    typeof genres === 'string'
      ? genres.split(',')
      : ((genres ?? []) as unknown[]);
  if (
    genreList.length > 50 ||
    genreList.some(
      (genre) =>
        typeof genre !== 'string' || !genre.trim() || genre.length > 100,
    )
  ) {
    throw new BadRequestException('Invalid genres');
  }
  const fromYear = number('fromYear', undefined, 1, 9999);
  const toYear = number('toYear', undefined, 1, 9999);
  if (fromYear !== undefined && toYear !== undefined && fromYear > toYear) {
    throw new BadRequestException('fromYear must not exceed toYear');
  }
  const pageSize = number('pageSize', 20, 1, 100)!;
  const currentPage = number('currentPage', 0, 0, Number.MAX_SAFE_INTEGER)!;
  if (!Number.isSafeInteger(currentPage * pageSize)) {
    throw new BadRequestException('Pagination offset is too large');
  }
  return {
    key,
    direction,
    pageSize,
    currentPage,
    genres: genreList as string[],
    fromYear,
    toYear,
    rating: number('rating', undefined, 0, 10, false),
    actors: text('actors'),
    directors: text('directors'),
    search: text('search'),
  };
}
