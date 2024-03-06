import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { Movie } from './schemas';
import { MoviesService } from './movies.service';
import { CreateMovieDto, MovieDto } from './dto';

@Controller('movies')
export class MoviesController {
  constructor(private readonly moviesService: MoviesService) {}

  @Post()
  async create(@Body() movieDto: CreateMovieDto) {
    await this.moviesService.create(movieDto);
  }

  @Get()
  findAll(): Promise<Movie[]> {
    return this.moviesService.findAll();
  }

  @Get(':id')
  async findOne(@Param('id') id: string): Promise<Movie> {
    return this.moviesService.findOne(id);
  }

  @Put(':id')
  async put(@Param('id') id: string, @Body() movieDto: MovieDto) {
    return this.moviesService.update(id, movieDto);
  }

  @Delete(':id')
  async delete(@Param('id') id: string): Promise<Movie> {
    return this.moviesService.delete(id);
  }
}
