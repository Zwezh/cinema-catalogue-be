import { LibsqlError } from '@libsql/client';
import { validateMovieQuery } from './query-validation';
import { randomUUID } from 'crypto';
import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import {
  CreateMovieDto,
  MovieDto,
  MovieListDto,
  PaginationParamsDto,
} from './dto';
import { Movie } from './schemas';

type MovieRow = Record<string, unknown>;

const sortColumns: Record<string, string> = {
  addedDate: 'added_date',
  ageRating: 'age_rating',
  enName: 'en_name',
  extension: 'extension',
  isSeries: 'is_series',
  kpId: 'kp_id',
  movieLength: 'movie_length',
  name: 'name',
  quality: 'quality',
  rating: 'rating',
  year: `CASE json_type(year_json)
    WHEN 'array' THEN CAST(json_extract(year_json, '$[0]') AS INTEGER)
    ELSE CAST(year_json AS INTEGER)
  END`,
};

@Injectable()
export class MoviesService {
  constructor(private readonly database: DatabaseService) {}

  async create(movieDto: CreateMovieDto): Promise<Movie> {
    const movie: Movie = { ...movieDto, id: randomUUID() };
    try {
      await this.insert(movie);
    } catch (error: unknown) {
      this.rethrowWriteError(error);
    }
    return movie;
  }

  async findAll(params: PaginationParamsDto): Promise<MovieListDto> {
    params = validateMovieQuery(params);
    const conditions: string[] = [];
    const args: (string | number)[] = [];
    if (params.search) {
      conditions.push('LOWER(name) LIKE LOWER(?)');
      args.push(`%${params.search}%`);
    }
    if (params.rating !== undefined) {
      conditions.push('rating >= ?');
      args.push(Number(params.rating));
    }
    if (params.fromYear !== undefined) {
      conditions.push(
        'EXISTS (SELECT 1 FROM json_each(movies.year_json) WHERE CAST(value AS INTEGER) >= ?)',
      );
      args.push(Number(params.fromYear));
    }
    if (params.toYear !== undefined) {
      conditions.push(
        'EXISTS (SELECT 1 FROM json_each(movies.year_json) WHERE CAST(value AS INTEGER) <= ?)',
      );
      args.push(Number(params.toYear));
    }
    for (const genre of this.asArray(params.genres)) {
      conditions.push(
        'EXISTS (SELECT 1 FROM json_each(movies.genres_json) WHERE value = ?)',
      );
      args.push(genre);
    }
    this.addPeopleConditions(conditions, args, 'actors_json', params.actors);
    this.addPeopleConditions(
      conditions,
      args,
      'director_json',
      params.directors,
    );

    const where =
      conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const { pageSize, currentPage } = params;
    const direction = params.direction === 'desc' ? 'DESC' : 'ASC';
    const sortColumn = Object.prototype.hasOwnProperty.call(
      sortColumns,
      params.key,
    )
      ? sortColumns[params.key]
      : 'name';
    const secondarySort = params.key === 'name' ? '' : ', name ASC';
    const [countResult, result] = await this.database.client.batch(
      [
        { sql: `SELECT COUNT(*) AS count FROM movies ${where}`, args },
        {
          sql: `SELECT * FROM movies ${where}
          ORDER BY ${sortColumn} ${direction}${secondarySort}, id ASC LIMIT ? OFFSET ?`,
          args: [...args, pageSize, currentPage * pageSize],
        },
      ],
      'read',
    );
    return {
      list: result.rows.map((row) => this.toMovie(row as MovieRow)),
      totalCount: Number(countResult.rows[0].count),
      currentPage,
    };
  }

  async findOne(id: string): Promise<Movie> {
    const result = await this.database.client.execute({
      sql: 'SELECT * FROM movies WHERE id = ?',
      args: [id],
    });
    const row = result.rows[0];
    if (!row) {
      throw new NotFoundException(`Movie #${id} not found`);
    }
    return this.toMovie(row as MovieRow);
  }

  async update(movieDto: MovieDto): Promise<Movie> {
    try {
      const result = await this.database.client.execute({
        sql: `UPDATE movies SET
        added_date = ?, age_rating = ?, backdrop_url = ?, compact_poster_url = ?,
        countries_json = ?, description = ?, director_json = ?, en_name = ?,
        extension = ?, genres_json = ?, is_series = ?, kp_id = ?, poster_url = ?,
        name = ?, movie_length = ?, actors_json = ?, quality = ?, rating = ?,
        year_json = ?, sequels_and_prequels_json = ?, similar_movies_json = ?
        WHERE id = ? RETURNING *`,
        args: [...this.values(movieDto), movieDto.id],
      });
      if (result.rows.length === 0) {
        throw new NotFoundException(`Movie #${movieDto.id} not found`);
      }
      return this.toMovie(result.rows[0] as MovieRow);
    } catch (error: unknown) {
      this.rethrowWriteError(error);
    }
  }

  async delete(id: string): Promise<Movie> {
    const result = await this.database.client.execute({
      sql: 'DELETE FROM movies WHERE id = ? RETURNING *',
      args: [id],
    });
    if (!result.rows[0]) throw new NotFoundException(`Movie #${id} not found`);
    return this.toMovie(result.rows[0] as MovieRow);
  }

  private rethrowWriteError(error: unknown): never {
    if (
      error instanceof LibsqlError &&
      error.message.includes('UNIQUE constraint failed: movies.kp_id')
    ) {
      throw new ConflictException('A movie with the same kpId already exists.');
    }
    throw error;
  }

  async findDistinctGenres(): Promise<string[]> {
    const result = await this.database.client.execute(
      `SELECT DISTINCT TRIM(CAST(value AS TEXT)) AS genre
       FROM movies, json_each(movies.genres_json)
       WHERE TRIM(CAST(value AS TEXT)) <> ''
       ORDER BY genre COLLATE NOCASE ASC`,
    );
    return result.rows.map((row) => String(row.genre));
  }

  private async insert(movie: Movie): Promise<void> {
    await this.database.client.execute({
      sql: `INSERT INTO movies (
        id, added_date, age_rating, backdrop_url, compact_poster_url,
        countries_json, description, director_json, en_name, extension,
        genres_json, is_series, kp_id, poster_url, name, movie_length,
        actors_json, quality, rating, year_json, sequels_and_prequels_json,
        similar_movies_json
      ) VALUES (${Array(22).fill('?').join(', ')})`,
      args: [movie.id, ...this.values(movie)],
    });
  }

  private values(movie: CreateMovieDto): (string | number | null)[] {
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
    ];
  }

  private toMovie(row: MovieRow): Movie {
    return {
      id: String(row.id),
      addedDate: String(row.added_date),
      ageRating: row.age_rating == null ? null : Number(row.age_rating),
      backdropUrl: String(row.backdrop_url),
      compactPosterUrl: String(row.compact_poster_url),
      countries: JSON.parse(String(row.countries_json)),
      description: String(row.description),
      director: JSON.parse(String(row.director_json)),
      enName: String(row.en_name),
      extension: String(row.extension),
      genres: JSON.parse(String(row.genres_json)),
      isSeries: row.is_series == null ? null : Boolean(row.is_series),
      kpId: Number(row.kp_id),
      posterUrl: String(row.poster_url),
      name: String(row.name),
      movieLength: Number(row.movie_length),
      actors: JSON.parse(String(row.actors_json)),
      quality: String(row.quality),
      rating: Number(row.rating),
      year: JSON.parse(String(row.year_json)),
      sequelsAndPrequels: JSON.parse(String(row.sequels_and_prequels_json)),
      similarMovies: JSON.parse(String(row.similar_movies_json)),
    };
  }

  private asArray(value: string[] | string | undefined): string[] {
    if (!value) return [];
    return Array.isArray(value) ? value : value.split(',');
  }

  private addPeopleConditions(
    conditions: string[],
    args: (string | number)[],
    column: 'actors_json' | 'director_json',
    value?: string,
  ): void {
    for (const person of value?.split(',').map((item) => item.trim()) ?? []) {
      if (!person) continue;
      conditions.push(
        `EXISTS (SELECT 1 FROM json_each(movies.${column}) WHERE LOWER(value) LIKE LOWER(?))`,
      );
      args.push(`%${person}%`);
    }
  }
}
