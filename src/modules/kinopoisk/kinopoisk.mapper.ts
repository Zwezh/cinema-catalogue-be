import {
  type KinopoiskFilmDto,
  type KinopoiskRelatedItemDto,
} from './kinopoisk.dto';
import { type MovieAutofill } from './movie-autofill.dto';

export function toMovieAutofill(film: KinopoiskFilmDto): MovieAutofill {
  return {
    actors: personNames(film, 'actor'),
    ageRating: nonNegativeNumber(film.ageRating),
    backdropUrl:
      film.backdrop?.url?.trim() || film.backdrop?.previewUrl?.trim() || '',
    compactPosterUrl: film.poster?.previewUrl?.trim() ?? '',
    countries: namedValues(film.countries),
    description: film.description?.trim() ?? '',
    directors: personNames(film, 'director'),
    enName: film.enName?.trim() || film.alternativeName?.trim() || '',
    genres: namedValues(film.genres),
    kpId: film.id,
    movieLength: positiveNumber(film.movieLength),
    name:
      film.name?.trim() ||
      film.alternativeName?.trim() ||
      film.enName?.trim() ||
      '',
    posterUrl: film.poster?.url?.trim() ?? '',
    rating: nonNegativeNumber(film.rating?.kp),
    sequelsAndPrequels: relatedNames(film.sequelsAndPrequels),
    similarMovies: relatedNames(film.similarMovies),
    year: positiveNumber(film.year),
  };
}

function namedValues(
  values: readonly { readonly name?: string | null }[],
): string[] {
  return unique(values.map((value) => value.name?.trim() ?? ''));
}

function personNames(
  film: KinopoiskFilmDto,
  profession: 'actor' | 'director',
): string[] {
  return unique(
    film.persons
      .filter(
        (person) => person.enProfession?.trim().toLowerCase() === profession,
      )
      .map((person) => person.name?.trim() || person.enName?.trim() || ''),
  );
}

function relatedNames(movies: readonly KinopoiskRelatedItemDto[]): string[] {
  return unique(
    movies.map(
      (movie) =>
        movie.name?.trim() ||
        movie.enName?.trim() ||
        movie.alternativeName?.trim() ||
        '',
    ),
  );
}

function positiveNumber(value: number | null | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : undefined;
}

function nonNegativeNumber(
  value: number | null | undefined,
): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}
