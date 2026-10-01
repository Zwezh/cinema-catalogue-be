import { substringPattern } from '../../database/search';
import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import {
  movieColumns,
  movieValues,
  movieFromRow,
  MovieRow,
} from '../../database/movie-record';
import { MovieDto, MovieListDto, PaginationParamsDto } from './dto';
import { Movie } from './schemas';

export class CatalogOptionError extends Error {
  constructor() {
    super('quality and extension must reference configured options');
  }
}

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
export class MoviesRepository {
  constructor(private readonly database: DatabaseService) {}

  async findAll(params: PaginationParamsDto): Promise<MovieListDto> {
    const conditions: string[] = [];
    const args: (string | number)[] = [];
    if (params.search) {
      conditions.push("name_search LIKE ? ESCAPE '\\'");
      args.push(substringPattern(params.search));
    }
    if (params.rating !== undefined) {
      conditions.push('rating >= ?');
      args.push(Number(params.rating));
    }
    if (params.fromYear !== undefined || params.toYear !== undefined) {
      conditions.push(
        'EXISTS (SELECT 1 FROM json_each(movies.year_json) WHERE CAST(value AS INTEGER) BETWEEN ? AND ?)',
      );
      args.push(params.fromYear ?? 1, params.toYear ?? 9999);
    }
    for (const [column, values] of [
      ['quality', params.quality],
      ['age_rating', params.ageRating],
    ] as const) {
      if (values?.length) {
        conditions.push(`${column} IN (${values.map(() => '?').join(', ')})`);
        args.push(...values);
      }
    }
    for (const genre of this.asArray(params.genres)) {
      conditions.push(
        'EXISTS (SELECT 1 FROM json_each(movies.genres_json) WHERE value = ?)',
      );
      args.push(genre);
    }
    this.addPeopleConditions(
      conditions,
      args,
      'actors_search_json',
      params.actors,
    );
    this.addPeopleConditions(
      conditions,
      args,
      'director_search_json',
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
      list: result.rows.map((row) => movieFromRow(row as MovieRow)),
      totalCount: Number(countResult.rows[0].count),
      currentPage,
    };
  }

  async findOne(id: string): Promise<Movie | undefined> {
    const result = await this.database.client.execute({
      sql: 'SELECT * FROM movies WHERE id = ?',
      args: [id],
    });
    const row = result.rows[0];
    return row ? movieFromRow(row) : undefined;
  }

  async update(movieDto: MovieDto): Promise<Movie | undefined> {
    const [quality, extension, result] = await this.database.client.batch(
      [
        {
          sql: 'SELECT 1 FROM quality_options WHERE settings_id = 1 AND value = ?',
          args: [movieDto.quality],
        },
        {
          sql: 'SELECT 1 FROM extension_options WHERE settings_id = 1 AND value = ?',
          args: [movieDto.extension],
        },
        {
          sql: `UPDATE movies SET ${movieColumns.map((column) => `${column} = ?`).join(', ')}
          WHERE id = ? AND EXISTS (SELECT 1 FROM quality_options WHERE settings_id = 1 AND value = ?)
          AND EXISTS (SELECT 1 FROM extension_options WHERE settings_id = 1 AND value = ?) RETURNING *`,
          args: [
            ...movieValues(movieDto),
            movieDto.id,
            movieDto.quality,
            movieDto.extension,
          ],
        },
      ],
      'write',
    );
    if (!quality.rows.length || !extension.rows.length)
      throw new CatalogOptionError();
    return result.rows[0] ? movieFromRow(result.rows[0]) : undefined;
  }

  async delete(id: string): Promise<Movie | undefined> {
    const result = await this.database.client.execute({
      sql: 'DELETE FROM movies WHERE id = ? RETURNING *',
      args: [id],
    });
    return result.rows[0] ? movieFromRow(result.rows[0]) : undefined;
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

  async insert(movie: Movie): Promise<Movie> {
    const result = await this.database.client.execute({
      sql: `INSERT INTO movies (id, ${movieColumns.join(', ')})
        SELECT ${Array(movieColumns.length + 1)
          .fill('?')
          .join(', ')}
        WHERE EXISTS (SELECT 1 FROM quality_options WHERE settings_id = 1 AND value = ?)
          AND EXISTS (SELECT 1 FROM extension_options WHERE settings_id = 1 AND value = ?) RETURNING *`,
      args: [movie.id, ...movieValues(movie), movie.quality, movie.extension],
    });
    if (!result.rows.length) throw new CatalogOptionError();
    return movieFromRow(result.rows[0]);
  }

  private asArray(value: string[] | string | undefined): string[] {
    if (!value) return [];
    return Array.isArray(value) ? value : value.split(',');
  }

  private addPeopleConditions(
    conditions: string[],
    args: (string | number)[],
    column: 'actors_search_json' | 'director_search_json',
    value?: string,
  ): void {
    for (const person of value?.split(',').map((item) => item.trim()) ?? []) {
      if (!person) continue;
      conditions.push(
        `EXISTS (SELECT 1 FROM json_each(movies.${column}) WHERE value LIKE ? ESCAPE '\\')`,
      );
      args.push(substringPattern(person));
    }
  }
}
