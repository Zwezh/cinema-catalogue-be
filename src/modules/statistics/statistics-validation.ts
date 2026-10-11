import type { StatisticsSnapshot, QualityBucket } from './statistics.types';

function invalid(): never {
  throw new TypeError('Invalid statistics data');
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return invalid();
  return value as Record<string, unknown>;
}
function count(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    return invalid();
  return value;
}
function label(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 1000)
    return invalid();
  return value;
}
function list<T>(value: unknown, parse: (item: unknown) => T): T[] {
  if (!Array.isArray(value) || value.length > 10000) return invalid();
  return value.map(parse);
}
function rating(value: unknown): number | null {
  if (value === null) return null;
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 10
  )
    return invalid();
  return value;
}
function unique(values: readonly string[]): void {
  if (new Set(values).size !== values.length) invalid();
}
export function parseStatisticsSnapshot(value: unknown): StatisticsSnapshot {
  const raw = object(value),
    t = object(raw['totals']),
    r = object(raw['ratings']);
  if (
    raw['version'] !== 1 ||
    typeof raw['scannedAt'] !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T.*Z$/.test(raw['scannedAt']) ||
    !Number.isFinite(Date.parse(raw['scannedAt']))
  )
    invalid();
  const totals = {
    titles: count(t['titles']),
    movies: count(t['movies']),
    series: count(t['series']),
    movieRuntimeMinutes: count(t['movieRuntimeMinutes']),
    knownMovieRuntimes: count(t['knownMovieRuntimes']),
    recordedSeasons: count(t['recordedSeasons']),
    availableSeasons: count(t['availableSeasons']),
    titlesWithoutGenres: count(t['titlesWithoutGenres']),
  };
  const genres = list(raw['genres'], (item) => {
    const v = object(item);
    return { label: label(v['label']), count: count(v['count']) };
  });
  const qualities = list<QualityBucket>(raw['qualities'], (item) => {
    const v = object(item),
      kind = v['kind'];
    if (kind !== 'quality' && kind !== 'none' && kind !== 'multiple')
      return invalid();
    if (kind !== 'quality' && v['value'] !== null) return invalid();
    return {
      kind,
      value: kind === 'quality' ? label(v['value']) : null,
      count: count(v['count']),
    };
  });
  const decades = list(raw['decades'], (item) => {
    const v = object(item),
      start = count(v['start']);
    if (start > 9990 || start % 10 !== 0) invalid();
    return { start, count: count(v['count']) };
  });
  const unknownYears = count(raw['unknownYears']);
  const bins = list(r['bins'], (item) => {
    const v = object(item);
    return {
      from: count(v['from']),
      to: count(v['to']),
      count: count(v['count']),
    };
  });
  const ratings = {
    bins,
    knownCount: count(r['knownCount']),
    unknownCount: count(r['unknownCount']),
    mean: rating(r['mean']),
    median: rating(r['median']),
    highRatedCount: count(r['highRatedCount']),
  };
  unique(genres.map((v) => v.label));
  unique(qualities.map((v) => `${v.kind}:${v.value}`));
  unique(decades.map((v) => String(v.start)));
  if (
    totals.titles !== totals.movies + totals.series ||
    totals.knownMovieRuntimes > totals.movies ||
    totals.availableSeasons > totals.recordedSeasons ||
    totals.titlesWithoutGenres > totals.titles ||
    genres.some((v) => !v.count || v.count > totals.titles) ||
    qualities.some((v) => !v.count) ||
    decades.some((v) => !v.count) ||
    qualities.reduce((n, v) => n + v.count, 0) !== totals.titles ||
    decades.reduce((n, v) => n + v.count, unknownYears) !== totals.titles ||
    ratings.knownCount + ratings.unknownCount !== totals.titles ||
    ratings.highRatedCount > ratings.knownCount ||
    bins.length !== 10 ||
    bins.some((v, i) => v.from !== i || v.to !== i + 1) ||
    bins.reduce((n, v) => n + v.count, 0) !== ratings.knownCount ||
    (ratings.knownCount === 0
      ? ratings.mean !== null || ratings.median !== null
      : ratings.mean === null || ratings.median === null)
  )
    invalid();
  return {
    version: 1,
    scannedAt: raw['scannedAt'],
    totals,
    genres,
    qualities,
    decades,
    unknownYears,
    ratings,
  };
}
