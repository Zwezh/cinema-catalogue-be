import { BadRequestException } from '@nestjs/common';
import { objectBody } from '../../common/validation';
import { validateTitleQuery } from '../../common/title-query-validation';
import type { PaginationParamsDto } from '../../common/pagination-params';
import type { SeriesDetails } from './title.types';

export type TitleListParams = PaginationParamsDto & {
  productionStatus?: SeriesDetails['productionStatus'];
  seasonAvailability?: 'incomplete';
};

export function validateTitleListQuery(
  value: unknown,
  seriesOnly: boolean,
): TitleListParams {
  const query = validateTitleQuery(value);
  if (!seriesOnly) return query;
  const body = objectBody(value, [
    'currentPage',
    'direction',
    'key',
    'pageSize',
    'actors',
    'ageRating',
    'quality',
    'directors',
    'fromYear',
    'genres',
    'rating',
    'search',
    'toYear',
    'productionStatus',
    'seasonAvailability',
  ]);
  const productionStatus = body.productionStatus;
  const seasonAvailability = body.seasonAvailability;
  if (
    productionStatus !== undefined &&
    productionStatus !== 'unknown' &&
    productionStatus !== 'in_production' &&
    productionStatus !== 'finished'
  )
    throw new BadRequestException('Invalid productionStatus');
  if (seasonAvailability !== undefined && seasonAvailability !== 'incomplete')
    throw new BadRequestException('Invalid seasonAvailability');
  return { ...query, productionStatus, seasonAvailability };
}
