import { LibsqlError } from '@libsql/client';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { validateCreateMovie, validateUpdateMovie } from './movie-validation';
import { validateMovieQuery } from './query-validation';
import { CatalogOptionError, MoviesRepository } from './movies.repository';
import {
  CreateMovieDto,
  MovieDto,
  MovieListDto,
  PaginationParamsDto,
} from './dto';
import { Movie } from './schemas';

@Injectable()
export class MoviesService {
  constructor(private readonly repository: MoviesRepository) {}
  async create(value: CreateMovieDto): Promise<Movie> {
    const movie: Movie = { ...validateCreateMovie(value), id: randomUUID() };
    try {
      return await this.repository.insert(movie);
    } catch (error: unknown) {
      this.rethrowWriteError(error);
    }
  }
  findAll(value: PaginationParamsDto): Promise<MovieListDto> {
    return this.repository.findAll(validateMovieQuery(value));
  }
  async findOne(id: string): Promise<Movie> {
    const movie = await this.repository.findOne(id);
    if (!movie) throw new NotFoundException(`Movie #${id} not found`);
    return movie;
  }
  async update(value: MovieDto): Promise<Movie> {
    const dto = validateUpdateMovie(value);
    try {
      const movie = await this.repository.update(dto);
      if (!movie) throw new NotFoundException(`Movie #${dto.id} not found`);
      return movie;
    } catch (error: unknown) {
      this.rethrowWriteError(error);
    }
  }
  async delete(id: string): Promise<Movie> {
    const movie = await this.repository.delete(id);
    if (!movie) throw new NotFoundException(`Movie #${id} not found`);
    return movie;
  }
  findDistinctGenres(): Promise<string[]> {
    return this.repository.findDistinctGenres();
  }
  private rethrowWriteError(error: unknown): never {
    if (error instanceof CatalogOptionError)
      throw new BadRequestException(error.message);
    if (
      error instanceof LibsqlError &&
      error.message.includes('UNIQUE constraint failed: movies.kp_id')
    ) {
      throw new ConflictException('A movie with the same kpId already exists.');
    }
    throw error;
  }
}
