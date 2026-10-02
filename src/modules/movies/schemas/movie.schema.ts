import { CreateMovieDto } from '../dto/create-movie.dto';

export type Movie = CreateMovieDto & { readonly id: string };
