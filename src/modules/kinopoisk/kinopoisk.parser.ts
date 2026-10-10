import type {
  KinopoiskFilmDto,
  KinopoiskImageDto,
  KinopoiskNamedValue,
  KinopoiskPersonDto,
  KinopoiskRelatedItemDto,
} from './kinopoisk.dto';

export function parseKinopoiskFilm(value: unknown): KinopoiskFilmDto {
  const record = asRecord(value, 'movie');
  return {
    ageRating: optionalNumber(record['ageRating'], 'ageRating'),
    alternativeName: optionalString(
      record['alternativeName'],
      'alternativeName',
    ),
    backdrop: optionalImage(record['backdrop'], 'backdrop'),
    countries: namedValues(record['countries'], 'countries'),
    description: optionalString(record['description'], 'description'),
    enName: optionalString(record['enName'], 'enName'),
    genres: namedValues(record['genres'], 'genres'),
    isSeries: optionalBoolean(record['isSeries'], 'isSeries'),
    type: optionalString(record['type'], 'type'),
    status: optionalString(record['status'], 'status'),
    seriesLength: optionalNumber(record['seriesLength'], 'seriesLength'),
    premiere: premiere(record['premiere']),
    releaseYears: releaseYears(record['releaseYears']),
    seasonsInfo: seasonsInfo(record['seasonsInfo']),
    id: requiredId(record['id']),
    movieLength: optionalNumber(record['movieLength'], 'movieLength'),
    name: optionalString(record['name'], 'name'),
    persons: people(record['persons']),
    poster: optionalImage(record['poster'], 'poster'),
    rating: rating(record['rating']),
    sequelsAndPrequels: relatedMovies(
      record['sequelsAndPrequels'],
      'sequelsAndPrequels',
    ),
    similarMovies: relatedMovies(record['similarMovies'], 'similarMovies'),
    year: optionalNumber(record['year'], 'year'),
  };
}

function namedValues(
  value: unknown,
  field: string,
): readonly KinopoiskNamedValue[] {
  return optionalArray(value, field).map((item, index) => {
    const record = asRecord(item, `${field}.${index}`);
    return { name: optionalString(record['name'], `${field}.${index}.name`) };
  });
}

function people(value: unknown): readonly KinopoiskPersonDto[] {
  return optionalArray(value, 'persons').map((item, index) => {
    const record = asRecord(item, `persons.${index}`);
    return {
      enName: optionalString(record['enName'], `persons.${index}.enName`),
      enProfession: optionalString(
        record['enProfession'],
        `persons.${index}.enProfession`,
      ),
      name: optionalString(record['name'], `persons.${index}.name`),
    };
  });
}

function relatedMovies(
  value: unknown,
  field: string,
): readonly KinopoiskRelatedItemDto[] {
  return optionalArray(value, field).map((item, index) => {
    const record = asRecord(item, `${field}.${index}`);
    return {
      alternativeName: optionalString(
        record['alternativeName'],
        `${field}.${index}.alternativeName`,
      ),
      enName: optionalString(record['enName'], `${field}.${index}.enName`),
      name: optionalString(record['name'], `${field}.${index}.name`),
    };
  });
}

function optionalImage(
  value: unknown,
  field: string,
): KinopoiskImageDto | undefined {
  const record = optionalRecord(value, field);
  return record
    ? {
        previewUrl: optionalString(record['previewUrl'], `${field}.previewUrl`),
        url: optionalString(record['url'], `${field}.url`),
      }
    : undefined;
}

function rating(value: unknown): KinopoiskFilmDto['rating'] {
  const record = optionalRecord(value, 'rating');
  return record ? { kp: optionalNumber(record['kp'], 'rating.kp') } : undefined;
}

function asRecord(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw invalid(field);
  return value as Record<string, unknown>;
}

function optionalRecord(
  value: unknown,
  field: string,
): Record<string, unknown> | undefined {
  return value === null || value === undefined
    ? undefined
    : asRecord(value, field);
}

function optionalArray(value: unknown, field: string): readonly unknown[] {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) throw invalid(field);
  return value;
}

function optionalNumber(
  value: unknown,
  field: string,
): number | null | undefined {
  if (value === null || value === undefined) return value;
  const number = requiredNumber(value, field);
  const limits: Record<string, readonly [number, number, boolean]> = {
    ageRating: [0, 21, true],
    year: [1, 9999, true],
    movieLength: [0, 100000, true],
    seriesLength: [0, 100000, true],
    start: [1, 9999, true],
    end: [1, 9999, true],
    number: [0, 10000, true],
    'rating.kp': [0, 10, false],
  };
  const range = limits[field];
  if (
    range &&
    (number < range[0] ||
      number > range[1] ||
      (range[2] && !Number.isSafeInteger(number)))
  )
    throw invalid(field);
  return number;
}

function requiredNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value))
    throw invalid(field);
  return value;
}

function optionalString(
  value: unknown,
  field: string,
): string | null | undefined {
  if (value === null || value === undefined) return value;
  if (typeof value !== 'string') throw invalid(field);
  return value;
}

function invalid(field: string): TypeError {
  return new TypeError(`Invalid PoiskKino response field: ${field}`);
}

function requiredId(value: unknown): number {
  const id = requiredNumber(value, 'id');
  if (!Number.isSafeInteger(id) || id <= 0) throw invalid('id');
  return id;
}

function optionalBoolean(
  value: unknown,
  field: string,
): boolean | null | undefined {
  if (value === null || value === undefined) return value;
  if (typeof value !== 'boolean') throw invalid(field);
  return value;
}

function premiere(value: unknown): KinopoiskFilmDto['premiere'] {
  const record = optionalRecord(value, 'premiere');
  return record
    ? { world: optionalString(record['world'], 'premiere.world') }
    : undefined;
}

function releaseYears(value: unknown): KinopoiskFilmDto['releaseYears'] {
  const ranges = optionalArray(value, 'releaseYears');
  if (ranges.length > 200) throw invalid('releaseYears');
  return ranges.map((item) => {
    const record = asRecord(item, 'releaseYears');
    // Provider uses zero for either unknown range boundary, not a calendar year.
    const start =
      record['start'] === 0 ? null : optionalNumber(record['start'], 'start');
    const end =
      record['end'] === 0 ? null : optionalNumber(record['end'], 'end');
    if (start != null && end != null && end < start)
      throw invalid('releaseYears');
    return { start, end };
  });
}

function seasonsInfo(value: unknown): KinopoiskFilmDto['seasonsInfo'] {
  const seasons = optionalArray(value, 'seasonsInfo');
  if (seasons.length > 1000) throw invalid('seasonsInfo');
  return seasons.map((item) => {
    const record = asRecord(item, 'seasonsInfo');
    return { number: optionalNumber(record['number'], 'number') };
  });
}
