import {
  validateTitleMetadata,
  validateYear,
} from '../../common/title-validation';
import { BadRequestException } from '@nestjs/common';
import { numberValue, objectBody, text } from '../../common/validation';
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

function parseMovie(body: Record<string, unknown>): CreateMovieDto {
  const year = validateYear(body.year);
  if (body.isSeries !== null && typeof body.isSeries !== 'boolean') {
    throw new BadRequestException('isSeries must be boolean or null');
  }
  return {
    ...validateTitleMetadata(body),
    extension: text(body.extension, 'extension', 100),
    quality: text(body.quality, 'quality', 100),
    isSeries: body.isSeries as boolean | null,
    kpId: numberValue(body.kpId, 'kpId', 1, Number.MAX_SAFE_INTEGER),
    movieLength: numberValue(body.movieLength, 'movieLength', 0, 100000),
    rating: numberValue(body.rating, 'rating', 0, 10, false),
    year,
  };
}
export function validateCreateMovie(value: unknown): CreateMovieDto {
  return parseMovie(objectBody(value, fields));
}
export function validateUpdateMovie(value: unknown): MovieDto {
  const body = objectBody(value, [...fields, 'id']);
  return { ...parseMovie(body), id: text(body.id, 'id', 100) };
}
