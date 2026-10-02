import { BadRequestException } from '@nestjs/common';
import { PaginationParamsDto } from './pagination-params';

export const titleSortKeys = [
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

export function validateTitleQuery(value: unknown): PaginationParamsDto {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
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
  if (!titleSortKeys.some((candidate) => candidate === key)) {
    throw new BadRequestException('Unsupported sort key');
  }
  const direction = text('direction') ?? 'asc';
  if (direction !== 'asc' && direction !== 'desc') {
    throw new BadRequestException('direction must be asc or desc');
  }
  const list = (key: string): string[] => {
    const raw = query[key];
    if (raw === undefined) return [];
    const entries: unknown[] =
      typeof raw === 'string'
        ? raw.split(',')
        : Array.isArray(raw)
          ? raw
          : [raw];
    const values =
      key === 'ageRating'
        ? entries.map((item) =>
            typeof item === 'number' ? String(item) : item,
          )
        : entries;
    if (
      values.length > 50 ||
      values.some(
        (item) => typeof item !== 'string' || !item.trim() || item.length > 100,
      )
    ) {
      throw new BadRequestException(
        `${key} must contain at most 50 nonempty strings`,
      );
    }
    return [...new Set((values as string[]).map((item) => item.trim()))];
  };
  const genreList = list('genres');
  const quality = list('quality');
  const ageRating = list('ageRating').map((item) => {
    if (!/^\d+$/.test(item) || Number(item) > 21) {
      throw new BadRequestException(
        'ageRating must contain integers between 0 and 21',
      );
    }
    return Number(item);
  });
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
    genres: genreList,
    quality,
    ageRating,
    fromYear,
    toYear,
    rating: number('rating', undefined, 0, 10, false),
    actors: text('actors'),
    directors: text('directors'),
    search: text('search'),
  };
}
