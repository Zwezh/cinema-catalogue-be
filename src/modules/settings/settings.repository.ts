import { Injectable } from '@nestjs/common';
import { storedStringArray } from '../../database/json';
import { DatabaseService } from '../../database/database.service';
import { replaceCatalogStatements } from '../../database/schema';
import { SettingsDto } from './dto';
import { Settings } from './schemas';
import { legacySettingsId } from './settings-validation';

type SettingsRow = {
  genres_for_filters_json: string;
};

@Injectable()
export class SettingsRepository {
  constructor(private readonly database: DatabaseService) {}

  async getSettings(): Promise<Settings> {
    const results = await this.database.client.batch(
      [
        'SELECT genres_for_filters_json FROM settings WHERE id = 1',
        `SELECT value, title, is_default
         FROM quality_options WHERE settings_id = 1 ORDER BY sort_order`,
        `SELECT value, is_default
         FROM extension_options WHERE settings_id = 1 ORDER BY sort_order`,
      ],
      'read',
    );
    const row = results[0].rows[0] as unknown as SettingsRow | undefined;
    if (!row) {
      throw new SettingsMissingError();
    }

    return {
      _id: legacySettingsId,
      quality: results[1].rows.map((option) => ({
        title: String(option.title),
        value: String(option.value),
        ...(Boolean(option.is_default) ? { default: true } : {}),
      })),
      extension: results[2].rows.map((option) => ({
        value: String(option.value),
        ...(Boolean(option.is_default) ? { default: true } : {}),
      })),
      genresForFilters: storedStringArray(
        row.genres_for_filters_json,
        'genres_for_filters_json',
      ),
    };
  }

  async update(settingsDto: SettingsDto): Promise<Settings> {
    const transaction = await this.database.client.transaction('write');
    try {
      const existing = await transaction.execute(
        'SELECT 1 FROM settings WHERE id = 1',
      );
      if (!existing.rows.length) throw new SettingsMissingError();
      await transaction.batch([
        {
          sql: 'UPDATE settings SET genres_for_filters_json = ? WHERE id = 1',
          args: [JSON.stringify(settingsDto.genresForFilters)],
        },
        ...replaceCatalogStatements(settingsDto.quality, settingsDto.extension),
      ]);
      await transaction.commit();
      return { ...settingsDto, _id: legacySettingsId };
    } finally {
      transaction.close();
    }
  }
}

export class SettingsMissingError extends Error {
  constructor() {
    super('Settings not found');
  }
}
