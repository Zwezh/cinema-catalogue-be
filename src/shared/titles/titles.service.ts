import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { TitlesRepository } from '../../database/titles/titles.repository';
import {
  TitleInputError,
  TitleNotFoundError,
  TitleConflictError,
} from './title.errors';
import { text } from '../../common/validation';
import { validateTitle } from './title-validation';
import { validateTitleQuery } from '../../common/title-query-validation';
import type { Membership } from './title.types';

@Injectable()
export class TitlesService {
  constructor(private readonly repository: TitlesRepository) {}
  async create(value: unknown, membership: Membership, seriesOnly = false) {
    const input = validateTitle(value, seriesOnly);
    const rawSource = (value as Record<string, unknown>).wishlistId;
    const source =
      rawSource === undefined ? undefined : text(rawSource, 'wishlistId', 100);
    return this.execute(() =>
      this.repository.create(input, membership, seriesOnly, source),
    );
  }
  async update(
    id: string,
    value: unknown,
    membership: Membership,
    seriesOnly = false,
  ) {
    const input = validateTitle(value, seriesOnly);
    if ((value as Record<string, unknown>).wishlistId !== undefined)
      throw new BadRequestException(
        'wishlistId is only supported for creation',
      );
    return this.execute(() =>
      this.repository.update(id, input, membership, seriesOnly),
    );
  }
  findAll(value: unknown, membership: Membership, seriesOnly = false) {
    const query = validateTitleQuery(value);
    return this.execute(() =>
      this.repository.findAll(query, membership, seriesOnly),
    );
  }
  findOne(id: string, membership: Membership, seriesOnly = false) {
    return this.execute(() =>
      this.repository.findOne(id, membership, seriesOnly),
    );
  }
  wishlistSnapshot(id: string) {
    return this.execute(() => this.repository.wishlistSnapshot(id));
  }
  refreshWishlist(id: string, value: unknown, revision: number) {
    const input = validateTitle(value);
    return this.execute(() =>
      this.repository.refreshWishlist(id, input, revision),
    );
  }
  delete(id: string, membership: Membership, seriesOnly = false) {
    return this.execute(() =>
      this.repository.delete(id, membership, seriesOnly),
    );
  }
  private async execute<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error: unknown) {
      if (error instanceof TitleNotFoundError)
        throw new NotFoundException(error.message);
      if (error instanceof TitleInputError)
        throw new BadRequestException(error.message);
      if (error instanceof TitleConflictError)
        throw new ConflictException(error.message);
      throw error;
    }
  }
}
