import {
  optionId,
  catalogValueMaxLength,
} from '../../shared/titles/catalog-options';
import { BadRequestException } from '@nestjs/common';
import { objectBody, strings, text } from '../../common/validation';
import { ExtensionOption, QualityOption, SettingsDto } from './dto';

export const legacySettingsId = '65e70d3e350be01cc7546abc';

function catalog(
  value: unknown,
  field: string,
  titleRequired: boolean,
): (QualityOption | ExtensionOption)[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 100) {
    throw new BadRequestException(`${field} must contain 1 to 100 options`);
  }
  const options = (value as unknown[]).map((entry) => {
    const item = objectBody(
      entry,
      titleRequired
        ? ['id', 'value', 'title', 'default']
        : ['id', 'value', 'default'],
    );
    const value = text(item.value, `${field}.value`, catalogValueMaxLength);
    const type = titleRequired ? 'quality' : 'extension';
    const legacyId = `${type}:${Buffer.from(value).toString('hex').toUpperCase()}`;
    if (
      item.id !== undefined &&
      item.id !== optionId(type, value) &&
      item.id !== legacyId
    )
      throw new BadRequestException('Catalog ID must match its value');
    if (item.default !== undefined && typeof item.default !== 'boolean') {
      throw new BadRequestException(`${field} defaults must be booleans`);
    }
    return {
      value: text(item.value, `${field}.value`, catalogValueMaxLength),
      ...(titleRequired
        ? { title: text(item.title, `${field}.title`, 200) }
        : {}),
      ...(item.default === undefined
        ? {}
        : { default: item.default as boolean }),
    };
  });
  if (
    new Set(options.map((option) => option.value.trim().toLowerCase())).size !==
    options.length
  ) {
    throw new BadRequestException(
      `${field} values must be unique ignoring case and whitespace`,
    );
  }
  if (options.filter((option) => option.default === true).length !== 1) {
    throw new BadRequestException(`${field} must have exactly one default`);
  }
  return options;
}

export function validateSettings(value: unknown): SettingsDto {
  // Clients may PUT the complete GET response, including the historical identifier.
  const body = objectBody(value, [
    'quality',
    'extension',
    'genresForFilters',
    '_id',
  ]);
  if (body._id !== undefined && body._id !== legacySettingsId) {
    throw new BadRequestException('Unsupported settings identifier');
  }
  return {
    quality: catalog(body.quality, 'quality', true) as QualityOption[],
    extension: catalog(body.extension, 'extension', false),
    genresForFilters: strings(body.genresForFilters, 'genresForFilters', 100),
  };
}
