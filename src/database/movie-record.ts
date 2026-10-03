import { normalizeSearch } from './search';
import { storedStringArray, storedYear } from './json';
import { CreateMovieDto } from '../modules/movies/dto';
import { Movie } from '../modules/movies/schemas';
export type MovieRow = Record<string, unknown>;
export const movieColumns = [
  'added_date',
  'age_rating',
  'backdrop_url',
  'compact_poster_url',
  'countries_json',
  'description',
  'director_json',
  'en_name',
  'extension',
  'genres_json',
  'is_series',
  'kp_id',
  'poster_url',
  'name',
  'movie_length',
  'actors_json',
  'quality',
  'rating',
  'year_json',
  'sequels_and_prequels_json',
  'similar_movies_json',
  'name_search',
  'actors_search_json',
  'director_search_json',
] as const;
export function movieValues(movie: CreateMovieDto): (string | number | null)[] {
  return [
    movie.addedDate,
    movie.ageRating ?? null,
    movie.backdropUrl,
    movie.compactPosterUrl,
    JSON.stringify(movie.countries),
    movie.description,
    JSON.stringify(movie.director),
    movie.enName,
    movie.extension,
    JSON.stringify(movie.genres),
    movie.isSeries == null ? null : Number(movie.isSeries),
    movie.kpId,
    movie.posterUrl,
    movie.name,
    movie.movieLength,
    JSON.stringify(movie.actors),
    movie.quality,
    movie.rating,
    JSON.stringify(movie.year),
    JSON.stringify(movie.sequelsAndPrequels),
    JSON.stringify(movie.similarMovies),
    normalizeSearch(movie.name),
    JSON.stringify(movie.actors.map(normalizeSearch)),
    JSON.stringify(movie.director.map(normalizeSearch)),
  ];
}

function storedText(value: unknown, field: string): string {
  if (typeof value !== 'string')
    throw new Error(`Invalid stored movie field: ${field}`);
  return value;
}
function storedNumber(
  value: unknown,
  field: string,
  min: number,
  max: number,
  integer = true,
): number {
  if (typeof value !== 'number' && typeof value !== 'bigint')
    throw new Error(`Invalid stored movie field: ${field}`);
  const number = Number(value);
  if (
    !Number.isFinite(number) ||
    number < min ||
    number > max ||
    (integer && !Number.isSafeInteger(number))
  )
    throw new Error(`Invalid stored movie field: ${field}`);
  return number;
}

export function movieFromRow(row: MovieRow): Movie {
  if (row.is_series !== null && row.is_series !== 0 && row.is_series !== 1) {
    throw new Error('Invalid stored movie boolean: is_series');
  }
  return {
    id: storedText(row.id, 'id'),
    addedDate: storedText(row.added_date, 'added_date'),
    ageRating:
      row.age_rating == null
        ? null
        : storedNumber(row.age_rating, 'age_rating', 0, 21),
    backdropUrl: storedText(row.backdrop_url, 'backdrop_url'),
    compactPosterUrl: storedText(row.compact_poster_url, 'compact_poster_url'),
    countries: storedStringArray(row.countries_json, 'countries_json'),
    description: storedText(row.description, 'description'),
    director: storedStringArray(row.director_json, 'director_json'),
    enName: storedText(row.en_name, 'en_name'),
    extension: storedText(row.extension, 'extension'),
    genres: storedStringArray(row.genres_json, 'genres_json'),
    isSeries: row.is_series == null ? null : Boolean(row.is_series),
    kpId: storedNumber(row.kp_id, 'kp_id', 1, Number.MAX_SAFE_INTEGER),
    posterUrl: storedText(row.poster_url, 'poster_url'),
    name: storedText(row.name, 'name'),
    movieLength: storedNumber(row.movie_length, 'movie_length', 0, 100000),
    actors: storedStringArray(row.actors_json, 'actors_json'),
    quality: storedText(row.quality, 'quality'),
    rating: storedNumber(row.rating, 'rating', 0, 10, false),
    year: storedYear(row.year_json),
    sequelsAndPrequels: storedStringArray(
      row.sequels_and_prequels_json,
      'sequels_and_prequels_json',
    ),
    similarMovies: storedStringArray(
      row.similar_movies_json,
      'similar_movies_json',
    ),
  };
}
