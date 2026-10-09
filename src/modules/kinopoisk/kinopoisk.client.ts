import {
  BadGatewayException,
  GatewayTimeoutException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export const KINOPOISK_FETCH = Symbol('KINOPOISK_FETCH');
const providerUrl = 'https://api.poiskkino.dev';
const maxResponseBytes = 2 * 1024 * 1024;

@Injectable()
export class KinopoiskClient {
  constructor(
    private readonly config: ConfigService,
    @Inject(KINOPOISK_FETCH) private readonly fetcher: typeof fetch,
  ) {}

  async getMovie(id: number): Promise<unknown> {
    return this.request(
      `${providerUrl}/v1.4/movie/${id}`,
      AbortSignal.timeout(10_000),
    );
  }

  getSeasonPage(
    id: number,
    next: string | null,
    signal: AbortSignal,
  ): Promise<unknown> {
    const url = new URL('/v1.5/season', providerUrl);
    url.searchParams.set('movieId', String(id));
    url.searchParams.set('limit', '250');
    for (const field of ['movieId', 'number', 'airDate'])
      url.searchParams.append('selectFields', field);
    if (next !== null) url.searchParams.set('next', next);
    return this.request(url.toString(), signal);
  }

  private async request(url: string, signal: AbortSignal): Promise<unknown> {
    const token = this.config.get<string>('KINOPOISK_API_TOKEN');
    if (!token)
      throw new ServiceUnavailableException('Movie autofill is not configured');
    try {
      const response = await this.fetcher(url, {
        headers: { 'X-API-KEY': token, Accept: 'application/json' },
        redirect: 'error',
        signal,
      });
      if (!response.ok) {
        await response.body?.cancel();
        if (response.status === 404)
          throw new NotFoundException('Kinopoisk movie not found');
        // Provider credentials/quota failures must never masquerade as a user's expired JWT.
        throw new BadGatewayException('Movie metadata provider is unavailable');
      }
      return await this.readJson(response);
    } catch (error: unknown) {
      if (
        signal.aborted ||
        (error instanceof Error &&
          ['TimeoutError', 'AbortError'].includes(error.name))
      ) {
        throw new GatewayTimeoutException('Movie metadata request timed out');
      }
      if (
        error instanceof NotFoundException ||
        error instanceof BadGatewayException
      )
        throw error;
      // Do not propagate provider bodies, URLs, headers or raw network errors to clients/logs.
      throw new BadGatewayException(
        'Movie metadata provider returned an invalid response',
      );
    }
  }

  private async readJson(response: Response): Promise<unknown> {
    if (!response.body)
      throw new BadGatewayException(
        'Movie metadata provider returned an empty response',
      );
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxResponseBytes)
          throw new BadGatewayException('Movie metadata response is too large');
        chunks.push(value);
      }
      return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    } finally {
      await reader.cancel();
      reader.releaseLock();
    }
  }
}
