import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  CreateMovieDto,
  MovieDto,
  MovieListDto,
  PaginationParamsDto,
} from './dto';
import { Movie } from './schemas';

@Injectable()
export class MoviesService {
  constructor(
    @InjectModel(Movie.name) private readonly movieModel: Model<Movie>,
  ) {}

  async create(movieDto: CreateMovieDto): Promise<Movie> {
    const movie = await this.movieModel.create(movieDto);
    return movie;
  }

  async findAll(params: PaginationParamsDto): Promise<MovieListDto> {
    const offset = params.currentPage * params.pageSize;
    const query = this.movieModel.find();
    if (params?.search) {
      query.where('name', new RegExp(params.search, 'i'));
    }
    if (params.rating) {
      query.where({ rating: { $gte: params.rating } });
    }
    if (params.fromYear) {
      query.where({ year: { $gte: params.fromYear } });
    }
    if (params.toYear) {
      query.where({ year: { $lte: params.toYear } });
    }
    if (params.genres) {
      query.where({ genres: { $all: params.genres } });
    }
    if (params.actors) {
      const actorsQuery = params.actors
        .split(',')
        .map((actor) => actor.trim())
        .map((actor) => new RegExp(actor, 'i'));
      query.where({ actors: { $elemMatch: { $all: actorsQuery } } });
    }
    if (params.directors) {
      const actorsQuery = params.directors
        .split(',')
        .map((director) => director.trim())
        .map((director) => new RegExp(director, 'i'));
      query.where({ director: { $elemMatch: { $all: actorsQuery } } });
    }
    query.sort({ [params.key]: params.direction });
    if (params.key !== 'name') {
      query.sort({ name: 'ascending' });
    }
    const totalCount = await this.movieModel.countDocuments(query);
    query.limit(params.pageSize).skip(offset);
    const list = await query.exec();

    return { list, totalCount, currentPage: params.currentPage };
  }

  async findOne(id: string): Promise<Movie> {
    return this.movieModel.findById(id).exec();
  }

  async update(id: string, movieDto: MovieDto): Promise<Movie> {
    const movie = await this.movieModel.findByIdAndUpdate(id, movieDto);
    if (!movie) {
      throw new NotFoundException(`Moive #${id} not found`);
    }
    return movie;
  }

  async delete(id: string): Promise<Movie> {
    const deletedMovie = await this.movieModel.findByIdAndDelete(id).exec();
    return deletedMovie;
  }

  async findAllGenres(): Promise<string[]> {
    return this.movieModel
      .find({}, { genres: 1, _id: 0 })
      .sort({ addedDate: 'descending' })
      .sort({ name: 'ascending' })
      .exec()
      .then((movies: Partial<Movie>[]) =>
        Array.from(new Set(movies.map((movie) => movie.genres).flat())),
      );
  }
}
