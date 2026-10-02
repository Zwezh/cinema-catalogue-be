import type { Transaction } from '@libsql/client';
import { writeTransaction } from '../../database/transaction';
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

  async getCatalogs() {
    const [quality, extension] = await this.database.client.batch(
      [
        'SELECT id,value,title,is_active FROM qualities ORDER BY value,id',
        'SELECT id,value,is_active FROM extensions ORDER BY value,id',
      ],
      'read',
    );
    return {
      quality: quality.rows.map((q) => ({
        id: String(q.id),
        value: String(q.value),
        title: String(q.title),
        isActive: Boolean(q.is_active),
      })),
      extension: extension.rows.map((e) => ({
        id: String(e.id),
        value: String(e.value),
        isActive: Boolean(e.is_active),
      })),
    };
  }

  async getSettings(transaction?: Transaction): Promise<Settings> {
    const statements = [
      "SELECT genres_for_filters_json FROM app_settings WHERE id = 'settings:default'",
      `SELECT q.id, q.value, q.title, s.is_default FROM settings_qualities s JOIN qualities q ON q.id=s.quality_id WHERE s.settings_id='settings:default' ORDER BY s.sort_order,q.id`,
      `SELECT e.id, e.value, s.is_default FROM settings_extensions s JOIN extensions e ON e.id=s.extension_id WHERE s.settings_id='settings:default' ORDER BY s.sort_order,e.id`,
    ];
    const results = transaction
      ? await transaction.batch(statements)
      : await this.database.client.batch(statements, 'read');
    const row = results[0].rows[0] as unknown as SettingsRow | undefined;
    if (!row) {
      throw new SettingsMissingError();
    }

    return {
      _id: legacySettingsId,
      quality: results[1].rows.map((option) => ({
        id: String(option.id),
        title: String(option.title),
        value: String(option.value),
        ...(Boolean(option.is_default) ? { default: true } : {}),
      })),
      extension: results[2].rows.map((option) => ({
        id: String(option.id),
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
    return writeTransaction(this.database.client, async (transaction) => {
      const existing = await transaction.execute(
        "SELECT 1 FROM app_settings WHERE id = 'settings:default'",
      );
      if (!existing.rows.length) throw new SettingsMissingError();
      await transaction.batch([
        {
          sql: "UPDATE app_settings SET genres_for_filters_json = ? WHERE id = 'settings:default'",
          args: [JSON.stringify(settingsDto.genresForFilters)],
        },
        ...replaceCatalogStatements(settingsDto.quality, settingsDto.extension),
      ]);
      return this.getSettings(transaction);
    });
  }
}

export class SettingsMissingError extends Error {
  constructor() {
    super('Settings not found');
  }
}
