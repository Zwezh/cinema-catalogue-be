import { Movie } from '../schemas';

export type MovieListDto = {
  list: Movie[];
  currentPage: number;
  totalCount: number;
};
