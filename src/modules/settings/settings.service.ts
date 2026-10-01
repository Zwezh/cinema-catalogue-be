import { Injectable, NotFoundException } from '@nestjs/common';
import { SettingsDto } from './dto';
import { Settings } from './schemas';
import { validateSettings } from './settings-validation';
import {
  SettingsMissingError,
  SettingsRepository,
} from './settings.repository';

@Injectable()
export class SettingsService {
  constructor(private readonly repository: SettingsRepository) {}
  async getSettings(): Promise<Settings> {
    try {
      return await this.repository.getSettings();
    } catch (error: unknown) {
      this.rethrow(error);
    }
  }
  async update(value: SettingsDto): Promise<Settings> {
    const dto = validateSettings(value);
    try {
      return await this.repository.update(dto);
    } catch (error: unknown) {
      this.rethrow(error);
    }
  }
  private rethrow(error: unknown): never {
    if (error instanceof SettingsMissingError)
      throw new NotFoundException(error.message);
    throw error;
  }
}
