import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Movie } from './schemas';
import { Model } from 'mongoose';
import { CreateMovieDto, MovieDto } from './dto';

@Injectable()
export class MoviesService {
  constructor(
    @InjectModel(Movie.name) private readonly movieModel: Model<Movie>,
  ) {}

  async create(movieDto: CreateMovieDto): Promise<Movie> {
    const movie = await this.movieModel.create(movieDto);
    return movie;
  }

  async findAll(): Promise<Movie[]> {
    return this.movieModel
      .find()
      .sort({ addedDate: 'descending' })
      .sort({ name: 'ascending' })
      .exec();
  }

  async findOne(id: string): Promise<Movie> {
    return this.movieModel.findOne({ id }).exec();
  }

  async update(id: string, movieDto: MovieDto): Promise<Movie> {
    const movie = await this.movieModel.findOneAndUpdate({ id }, movieDto);
    if (!movie) {
      throw new NotFoundException(`Moive #${id} not found`);
    }
    return movie;
  }

  async delete(id: string): Promise<Movie> {
    const deletedMovie = await this.movieModel.findOneAndDelete({ id }).exec();
    return deletedMovie;
  }
}
