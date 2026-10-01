import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { replaceCatalogStatements } from '../../database/schema';
import { ExtensionOption, QualityOption, SettingsDto } from './dto';
import { Settings } from './schemas';

type SettingsRow = {
  genres_for_filters_json: string;
};

const legacySettingsId = '65e70d3e350be01cc7546abc';

@Injectable()
export class SettingsService {
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
      throw new NotFoundException('Settings not found');
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
      genresForFilters: JSON.parse(row.genres_for_filters_json),
    };
  }

  async update(settingsDto: SettingsDto): Promise<Settings> {
    this.validateCatalog(settingsDto.quality, 'quality', true);
    this.validateCatalog(settingsDto.extension, 'extension', false);
    if (
      !Array.isArray(settingsDto.genresForFilters) ||
      settingsDto.genresForFilters.some(
        (genre) => typeof genre !== 'string' || !genre.trim(),
      )
    ) {
      throw new BadRequestException('genresForFilters must contain strings');
    }

    const results = await this.database.client.batch(
      [
        {
          sql: `UPDATE settings SET genres_for_filters_json = ? WHERE id = 1`,
          args: [JSON.stringify(settingsDto.genresForFilters)],
        },
        ...replaceCatalogStatements(settingsDto.quality, settingsDto.extension),
      ],
      'write',
    );
    if (results[0].rowsAffected === 0) {
      throw new NotFoundException('Settings not found');
    }
    return this.getSettings();
  }

  private validateCatalog(
    options: readonly (QualityOption | ExtensionOption)[],
    field: 'quality' | 'extension',
    requiresTitle: boolean,
  ): void {
    if (!Array.isArray(options) || options.length === 0) {
      throw new BadRequestException(`${field} must not be empty`);
    }
    const values = new Set<string>();
    let defaultCount = 0;
    for (const option of options) {
      if (!option || typeof option.value !== 'string' || !option.value.trim()) {
        throw new BadRequestException(
          `${field} values must be non-empty strings`,
        );
      }
      if (option.default !== undefined && typeof option.default !== 'boolean') {
        throw new BadRequestException(`${field} defaults must be booleans`);
      }
      if (values.has(option.value)) {
        throw new BadRequestException(`${field} values must be unique`);
      }
      values.add(option.value);
      if (option.default === true) defaultCount += 1;
      if (
        requiresTitle &&
        (!('title' in option) ||
          typeof option.title !== 'string' ||
          !option.title.trim())
      ) {
        throw new BadRequestException(
          'quality titles must be non-empty strings',
        );
      }
    }
    if (defaultCount !== 1) {
      throw new BadRequestException(`${field} must have exactly one default`);
    }
  }
}
