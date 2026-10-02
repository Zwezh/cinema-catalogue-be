import { BadRequestException } from '@nestjs/common';
import { providerId } from '../../shared/titles/provider-id';
import type { Title } from '../../shared/titles/title.types';
import { validateCreateMovie } from '../movies/movie-validation';
import { validateTitleMetadata } from '../../common/title-validation';

export function assertWishlistPromotion(
  title: Title,
  options: unknown,
  addedDate: string,
): string | null {
  const kpId = providerId(title.kpId);
  if (title.kind !== 'movie') return kpId;
  if (
    !title.formats.length ||
    title.kpId === null ||
    title.year === null ||
    title.movieLength === null ||
    title.rating === null
  )
    throw new BadRequestException(
      'Complete movie metadata and at least one format before promotion',
    );
  validateCreateMovie({
    ...validateTitleMetadata(title),
    year: title.year,
    movieLength: title.movieLength,
    rating: title.rating,
    addedDate,
    kpId: Number(title.kpId),
    isSeries: false,
    ...(options as object),
  });
  return kpId;
}
