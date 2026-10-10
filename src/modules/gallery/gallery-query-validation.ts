import { BadRequestException } from '@nestjs/common';
import { validateTitleQuery } from '../../common/title-query-validation';
import {
  galleryCollections,
  galleryKinds,
  gallerySortKeys,
  type GalleryQuery,
} from './gallery.types';
export function validateGalleryQuery(value: unknown): GalleryQuery {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new BadRequestException('Query must be an object');
  const raw = value as Record<string, unknown>;
  const allowed = [
    'currentPage',
    'pageSize',
    'key',
    'direction',
    'search',
    'genres',
    'quality',
    'ageRating',
    'rating',
    'actors',
    'directors',
    'fromYear',
    'toYear',
    'collections',
    'kinds',
  ];
  if (Object.keys(raw).some((key) => !allowed.includes(key)))
    throw new BadRequestException('Unsupported Gallery query parameter');
  const list = <T extends string>(key: string, values: readonly T[]): T[] => {
    if (raw[key] === undefined) return [...values];
    const input = Array.isArray(raw[key]) ? raw[key] : [raw[key]];
    if (input.length > 50 || input.some((x) => typeof x !== 'string'))
      throw new BadRequestException(`Invalid ${key}`);
    const entries = (input as string[]).flatMap((x) =>
      x.split(',').map((v) => v.trim()),
    );
    if (!entries.length || entries.some((x) => !values.some((v) => v === x)))
      throw new BadRequestException(`Invalid ${key}`);
    return values.filter((v) => entries.includes(v));
  };
  const query = validateTitleQuery({
    key: 'addedDate',
    direction: 'desc',
    ...raw,
  });
  if (!gallerySortKeys.some((key) => key === query.key))
    throw new BadRequestException('Unsupported Gallery sort key');
  return {
    ...query,
    collections: list('collections', galleryCollections),
    kinds: list('kinds', galleryKinds),
  };
}
