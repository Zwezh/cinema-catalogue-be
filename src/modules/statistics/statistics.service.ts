import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { StatisticsRepository } from '../../database/statistics/statistics.repository';
@Injectable()
export class StatisticsService {
  constructor(private readonly repository: StatisticsRepository) {}
  async get() {
    return this.execute(() => this.repository.getSnapshot());
  }
  async scan() {
    return this.execute(() => this.repository.scan());
  }
  private async execute(
    work: () => ReturnType<StatisticsRepository['getSnapshot']>,
  ) {
    try {
      return { snapshot: await work() };
    } catch {
      throw new InternalServerErrorException(
        'Statistics could not be loaded or calculated',
      );
    }
  }
}
