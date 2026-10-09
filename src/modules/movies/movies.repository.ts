import { writeCatalogTransaction } from '../../database/transaction';
import { saveMovie } from '../../database/movies/movie-writer';
import { substringPattern } from '../../database/search';
import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { movieFromRow, MovieRow } from '../../database/movie-record';
import { MovieDto, MovieListDto, PaginationParamsDto } from './dto';
import { Movie } from './schemas';

export { CatalogOptionError } from '../../shared/titles/title.errors';

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
        'EXISTS (SELECT 1 FROM json_each(movie_catalog.year_json) WHERE CAST(value AS INTEGER) BETWEEN ? AND ?)',
      );
      args.push(params.fromYear ?? 1, params.toYear ?? 9999);
    }
    if (params.quality?.length) {
      conditions.push(
        `EXISTS(SELECT 1 FROM title_formats f JOIN qualities q ON q.id=f.quality_id WHERE f.title_id=movie_catalog.id AND q.value IN (${params.quality.map(() => '?').join(',')}))`,
      );
      args.push(...params.quality);
    }
    if (params.ageRating?.length) {
      conditions.push(
        `age_rating IN (${params.ageRating.map(() => '?').join(',')})`,
      );
      args.push(...params.ageRating);
    }
    for (const genre of this.asArray(params.genres)) {
      conditions.push(
        'EXISTS (SELECT 1 FROM title_genres tg JOIN genres g ON g.id=tg.genre_id WHERE tg.title_id=movie_catalog.id AND g.value=?)',
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
    const order = `${sortColumn} ${direction}${secondarySort}, id ASC`;
    const countWhere = where.replaceAll('movie_catalog.', 't.');
    const [countResult, result] = await (
      this.database.readClient ?? this.database.client
    ).batch(
      [
        {
          sql: `SELECT COUNT(*) AS count FROM titles t
          JOIN library_entries l ON l.title_id=t.id
          WHERE t.kind='movie' ${countWhere ? `AND ${countWhere.slice(6)}` : ''}`,
          args,
        },
        {
          sql: `WITH page AS MATERIALIZED (
            SELECT id AS page_id FROM movie_catalog ${where}
            ORDER BY ${order} LIMIT ? OFFSET ?
          )
          SELECT movie_catalog.* FROM page CROSS JOIN movie_catalog
          WHERE id=page.page_id
          ORDER BY ${order}`,
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
    const result = await (
      this.database.readClient ?? this.database.client
    ).execute({
      sql: 'SELECT * FROM movie_catalog WHERE id = ?',
      args: [id],
    });
    const row = result.rows[0];
    return row ? movieFromRow(row) : undefined;
  }

  async update(movie: MovieDto): Promise<Movie | undefined> {
    return writeCatalogTransaction(this.database, async (tx) => {
      const existing = await tx.execute({
        sql: 'SELECT * FROM movie_catalog WHERE id=?',
        args: [movie.id],
      });
      if (!existing.rows.length) return undefined;
      await saveMovie(tx, movie);
      const row = await tx.execute({
        sql: 'SELECT * FROM movie_catalog WHERE id=?',
        args: [movie.id],
      });
      const result = movieFromRow(row.rows[0]);
      return result;
    });
  }

  async delete(id: string): Promise<Movie | undefined> {
    return writeCatalogTransaction(this.database, async (tx) => {
      const row = await tx.execute({
        sql: 'SELECT * FROM movie_catalog WHERE id=?',
        args: [id],
      });
      if (!row.rows.length) return undefined;
      const result = movieFromRow(row.rows[0]);
      await tx.execute({
        sql: 'DELETE FROM library_entries WHERE title_id=?',
        args: [id],
      });
      await tx.execute({
        sql: 'DELETE FROM titles WHERE id=? AND NOT EXISTS(SELECT 1 FROM wishlist_entries WHERE title_id=?)',
        args: [id, id],
      });
      return result;
    });
  }

  async findDistinctGenres(): Promise<string[]> {
    const result = await (
      this.database.readClient ?? this.database.client
    ).execute(
      `SELECT DISTINCT TRIM(g.value) AS genre FROM genres g
       JOIN title_genres tg ON tg.genre_id=g.id JOIN movie_catalog m ON m.id=tg.title_id
       WHERE TRIM(g.value)<>'' ORDER BY genre COLLATE NOCASE`,
    );
    return result.rows.map((row) => String(row.genre));
  }

  async insert(movie: Movie): Promise<Movie> {
    return writeCatalogTransaction(this.database, async (tx) => {
      await saveMovie(tx, movie);
      const row = await tx.execute({
        sql: 'SELECT * FROM movie_catalog WHERE id=?',
        args: [movie.id],
      });
      const result = movieFromRow(row.rows[0]);
      return result;
    });
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
        `EXISTS (SELECT 1 FROM json_each(movie_catalog.${column}) WHERE value LIKE ? ESCAPE '\\')`,
      );
      args.push(substringPattern(person));
    }
  }
}
