import { BadGatewayException, Injectable } from '@nestjs/common';
import { KinopoiskClient } from './kinopoisk.client';
import { parseKinopoiskFilm } from './kinopoisk.parser';
import { toMovieAutofill } from './kinopoisk.mapper';
import { MovieAutofill } from './movie-autofill.dto';

@Injectable()
export class KinopoiskService {
  constructor(private readonly client: KinopoiskClient) {}

  async getMovieAutofill(id: number): Promise<MovieAutofill> {
    const response = await this.client.getMovie(id);
    try {
      const film = parseKinopoiskFilm(response);
      if (film.id !== id) throw new Error('Mismatched movie ID');
      return toMovieAutofill(film);
    } catch {
      throw new BadGatewayException(
        'Movie metadata provider returned invalid movie data',
      );
    }
  }
}
