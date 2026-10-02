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
  LibraryConflictError,
  TitleConflictError,
} from './title.errors';
import { validateTitle } from './title-validation';
import { validateTitleQuery } from '../../common/title-query-validation';
import { validateAddedDate } from '../../common/title-validation';
import type { Title, Membership } from './title.types';

@Injectable()
export class TitlesService {
  constructor(private readonly repository: TitlesRepository) {}
  async create(value: unknown, membership: Membership, seriesOnly = false) {
    const input = validateTitle(value, seriesOnly);
    return this.execute(() =>
      this.repository.create(input, membership, seriesOnly),
    );
  }
  async update(
    id: string,
    value: unknown,
    membership: Membership,
    seriesOnly = false,
  ) {
    const input = validateTitle(value, seriesOnly);
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
  delete(id: string, membership: Membership, seriesOnly = false) {
    return this.execute(() =>
      this.repository.delete(id, membership, seriesOnly),
    );
  }
  async promote(
    id: string,
    value: unknown,
    validate: (
      title: Title,
      options: unknown,
      addedDate: string,
    ) => string | null,
  ) {
    const addedDate = validateAddedDate(value);
    return this.execute(() =>
      this.repository.promote(id, addedDate, (title, options) =>
        validate(title, options, addedDate),
      ),
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
      if (
        error instanceof TitleConflictError ||
        error instanceof LibraryConflictError
      )
        throw new ConflictException(error.message);
      throw error;
    }
  }
}
