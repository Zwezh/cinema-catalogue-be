import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-guard';
import {
  CreateMovieDto,
  MovieDto,
  MovieListDto,
  PaginationParamsDto,
} from './dto';
import { MoviesService } from './movies.service';
import { Movie } from './schemas';

@Controller('movies')
export class MoviesController {
  constructor(private readonly moviesService: MoviesService) {}

  @UseGuards(JwtAuthGuard)
  @Post()
  async create(@Body() movieDto: CreateMovieDto): Promise<Movie> {
    return await this.moviesService.create(movieDto);
  }

  @Get()
  findAll(@Query() params: PaginationParamsDto): Promise<MovieListDto> {
    return this.moviesService.findAll(params);
  }

  @Get(':id')
  async findOne(@Param('id') id: string): Promise<Movie> {
    return this.moviesService.findOne(id);
  }

  @Get('genres')
  async findGenres(): Promise<Partial<string[]>> {
    return this.moviesService.findAllGenres();
  }

  @UseGuards(JwtAuthGuard)
  @Put(':id')
  async put(@Param('id') id: string, @Body() movieDto: MovieDto) {
    return this.moviesService.update(id, movieDto);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  async delete(@Param('id') id: string): Promise<Movie> {
    return this.moviesService.delete(id);
  }
}
