import { normalizeSearch } from './search';
import { validateCreateMovie } from '../modules/movies/movie-validation';
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

export function movieFromRow(row: MovieRow): Movie {
  if (row.is_series !== null && row.is_series !== 0 && row.is_series !== 1) {
    throw new Error('Invalid stored movie boolean: is_series');
  }
  const movie = {
    id: String(row.id),
    addedDate: String(row.added_date),
    ageRating: row.age_rating == null ? null : Number(row.age_rating),
    backdropUrl: String(row.backdrop_url),
    compactPosterUrl: String(row.compact_poster_url),
    countries: storedStringArray(row.countries_json, 'countries_json'),
    description: String(row.description),
    director: storedStringArray(row.director_json, 'director_json'),
    enName: String(row.en_name),
    extension: String(row.extension),
    genres: storedStringArray(row.genres_json, 'genres_json'),
    isSeries: row.is_series == null ? null : Boolean(row.is_series),
    kpId: Number(row.kp_id),
    posterUrl: String(row.poster_url),
    name: String(row.name),
    movieLength: Number(row.movie_length),
    actors: storedStringArray(row.actors_json, 'actors_json'),
    quality: String(row.quality),
    rating: Number(row.rating),
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
  const { id, ...fields } = movie;
  try {
    return {
      ...validateCreateMovie(fields),
      id,
    };
  } catch {
    throw new Error('Invalid stored movie fields');
  }
}
