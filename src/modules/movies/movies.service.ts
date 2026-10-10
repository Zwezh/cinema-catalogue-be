import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  TitleNotFoundError,
  TitleConflictError,
} from '../../shared/titles/title.errors';
import { randomUUID } from 'node:crypto';
import { validateCreateMovie, validateUpdateMovie } from './movie-validation';
import { validateTitleQuery } from '../../common/title-query-validation';
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
    const dto = validateCreateMovie(value);
    if (dto.isSeries)
      throw new BadRequestException('Use the series endpoint for series');
    const movie: Movie & { wishlistId?: string } = { ...dto, id: randomUUID() };
    try {
      return await this.repository.insert(movie);
    } catch (error: unknown) {
      this.rethrowWriteError(error);
    }
  }
  findAll(value: PaginationParamsDto): Promise<MovieListDto> {
    return this.repository.findAll(validateTitleQuery(value));
  }
  async findOne(id: string): Promise<Movie> {
    const movie = await this.repository.findOne(id);
    if (!movie) throw new NotFoundException(`Movie #${id} not found`);
    return movie;
  }
  async update(value: MovieDto): Promise<Movie> {
    const dto = validateUpdateMovie(value);
    if (dto.isSeries)
      throw new BadRequestException('Use the series endpoint for series');
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
    if (error instanceof TitleNotFoundError)
      throw new NotFoundException(error.message);
    if (error instanceof TitleConflictError)
      throw new ConflictException(error.message);
    if (error instanceof CatalogOptionError)
      throw new BadRequestException(error.message);
    throw error;
  }
}
