import { BadGatewayException, Injectable } from '@nestjs/common';
import { KinopoiskClient } from './kinopoisk.client';
import { parseKinopoiskFilm } from './kinopoisk.parser';
import { toTitleAutofill, titleKind } from './title-autofill.mapper';
import type { TitleAutofill } from './title-autofill.dto';
import type { KinopoiskFilmDto } from './kinopoisk.dto';
import { parseSeasonPage } from './kinopoisk-seasons.parser';

@Injectable()
export class KinopoiskService {
  constructor(private readonly client: KinopoiskClient) {}

  async getTitleAutofill(id: number): Promise<TitleAutofill> {
    const film = await this.getFilm(id);
    const seasons =
      titleKind(film) === 'series' ? await this.getSeasons(id) : [];
    const autofill = toTitleAutofill(film, seasons);
    if (autofill.series && autofill.series.seasons.length > 1000)
      throw new BadGatewayException(
        'Movie metadata provider returned too many seasons',
      );
    return autofill;
  }

  private async getSeasons(
    id: number,
  ): Promise<NonNullable<TitleAutofill['series']>['seasons']> {
    const seasons = new Map<number, number | null>();
    const cursors = new Set<string>();
    const signal = AbortSignal.timeout(10_000);
    let next: string | null = null;
    for (let page = 0; page < 4; page++) {
      const response = await this.client.getSeasonPage(id, next, signal);
      try {
        const parsed = parseSeasonPage(response, id);
        for (const season of parsed.seasons) {
          const existing = seasons.get(season.seasonNumber);
          if (
            existing != null &&
            season.releaseYear !== null &&
            existing !== season.releaseYear
          )
            throw new Error('Conflicting season years');
          seasons.set(
            season.seasonNumber,
            season.releaseYear ?? existing ?? null,
          );
        }
        if (parsed.next === null)
          return [...seasons].map(([seasonNumber, releaseYear]) => ({
            seasonNumber,
            releaseYear,
          }));
        if (cursors.has(parsed.next)) throw new Error('Repeated cursor');
        cursors.add(parsed.next);
        next = parsed.next;
      } catch {
        throw new BadGatewayException(
          'Movie metadata provider returned invalid season data',
        );
      }
    }
    throw new BadGatewayException(
      'Movie metadata provider returned too many season pages',
    );
  }

  private async getFilm(id: number): Promise<KinopoiskFilmDto> {
    const response = await this.client.getMovie(id);
    try {
      const film = parseKinopoiskFilm(response);
      if (film.id !== id) throw new Error('Mismatched title ID');
      return film;
    } catch {
      throw new BadGatewayException(
        'Movie metadata provider returned invalid movie data',
      );
    }
  }
}
