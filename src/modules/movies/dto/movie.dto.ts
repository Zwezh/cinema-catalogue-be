import { CreateMovieDto } from './create-movie.dto';

export type MovieDto = CreateMovieDto & { readonly id: string };
