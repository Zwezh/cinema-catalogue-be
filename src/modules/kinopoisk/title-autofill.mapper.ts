import type {
  KinopoiskFilmDto,
  KinopoiskRelatedItemDto,
} from './kinopoisk.dto';
import type { TitleAutofill } from './title-autofill.dto';

export function titleKind(film: KinopoiskFilmDto): TitleAutofill['kind'] {
  if (film.isSeries != null) return film.isSeries ? 'series' : 'movie';
  if (['tv-series', 'animated-series', 'tv-show'].includes(film.type ?? ''))
    return 'series';
  if (['movie', 'cartoon'].includes(film.type ?? '')) return 'movie';
  return null;
}

export function toTitleAutofill(
  film: KinopoiskFilmDto,
  seasons: NonNullable<TitleAutofill['series']>['seasons'] = [],
): TitleAutofill {
  const common = commonMetadata(film);
  const kind = titleKind(film);
  const starts = film.releaseYears.flatMap((range) =>
    range.start == null ? [] : [range.start],
  );
  const ends = film.releaseYears.flatMap((range) =>
    range.end == null ? [] : [range.end],
  );
  const startYear = starts.length ? Math.min(...starts) : (common.year ?? null);
  const knownEnd =
    ends.length && ends.length === film.releaseYears.length
      ? Math.max(...ends)
      : null;
  const active = [
    'filming',
    'pre-production',
    'announced',
    'post-production',
  ].includes(film.status ?? '');
  const openRange = film.releaseYears.some(
    (range) => range.start != null && range.end == null,
  );
  const productionStatus =
    active || (film.status == null && openRange)
      ? 'in_production'
      : film.status === 'completed' ||
          (film.status == null && knownEnd !== null)
        ? 'finished'
        : 'unknown';
  const endYear =
    productionStatus === 'finished' &&
    startYear !== null &&
    knownEnd !== null &&
    knownEnd >= startYear
      ? knownEnd
      : null;
  const seasonYears = new Map<number, number | null>();
  for (const season of film.seasonsInfo) {
    if (season.number != null) seasonYears.set(season.number, null);
  }
  for (const season of seasons)
    seasonYears.set(season.seasonNumber, season.releaseYear);
  return {
    ...common,
    kind,
    kpId: String(film.id),
    ageRating: common.ageRating ?? null,
    year:
      kind === 'series'
        ? startYear === null
          ? null
          : endYear !== null && endYear !== startYear
            ? [startYear, endYear]
            : startYear
        : (common.year ?? null),
    movieLength:
      kind === 'series'
        ? film.seriesLength && film.seriesLength > 0
          ? film.seriesLength
          : (common.movieLength ?? null)
        : (common.movieLength ?? null),
    rating: common.rating ?? null,
    releaseDate: releaseDate(film.premiere?.world),
    series:
      kind === 'series'
        ? {
            startYear,
            endYear,
            productionStatus,
            // seasonsInfo enumerates known seasons, not an authoritative announced total.
            announcedSeasonCount: null,
            seasons: [...seasonYears]
              .sort(([a], [b]) => a - b)
              .map(([seasonNumber, releaseYear]) => ({
                seasonNumber,
                releaseYear,
              })),
          }
        : null,
  };
}

function releaseDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = value.slice(0, 10);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(date).toISOString().slice(0, 10) !== date
  )
    return null;
  return date;
}

function commonMetadata(film: KinopoiskFilmDto) {
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
