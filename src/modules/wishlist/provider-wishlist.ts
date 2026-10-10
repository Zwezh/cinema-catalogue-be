import { BadRequestException, BadGatewayException } from '@nestjs/common';
import { validateTitle } from '../../shared/titles/title-validation';
import { objectBody } from '../../common/validation';
import { providerId } from '../../shared/titles/provider-id';
import type { TitleAutofill } from '../kinopoisk/title-autofill.dto';
import type { Title } from '../../shared/titles/title.types';

export function wishlistProviderId(value: unknown): string {
  const body = objectBody(value, ['kpId']);
  const id = providerId(body.kpId);
  if (id === null) throw new BadRequestException('Missing Kinopoisk ID');
  return id;
}
export function providerWishlist(data: TitleAutofill, prior?: Title) {
  if (!data.kind || !data.name.trim())
    throw new BadGatewayException('Provider title kind or name is unavailable');
  const seasons = new Map(
    prior?.series?.seasons.map((season) => [season.seasonNumber, season]) ?? [],
  );
  for (const season of data.series?.seasons ?? [])
    seasons.set(season.seasonNumber, {
      ...seasons.get(season.seasonNumber),
      ...season,
      isAvailable: seasons.get(season.seasonNumber)?.isAvailable ?? false,
      formats: seasons.get(season.seasonNumber)?.formats ?? [],
    });
  const { directors, ...metadata } = data;
  const draft = {
    ...metadata,
    director: directors,
    addedDate: prior?.addedDate ?? new Date().toISOString().slice(0, 10),
    formats: prior?.formats ?? [],
    series: data.series
      ? {
          ...data.series,
          seasons: [...seasons.values()].sort(
            (a, b) => a.seasonNumber - b.seasonNumber,
          ),
        }
      : null,
  };
  try {
    return validateTitle(draft);
  } catch {
    throw new BadGatewayException(
      'Provider returned invalid Wishlist metadata',
    );
  }
}
