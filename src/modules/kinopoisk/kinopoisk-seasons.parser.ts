import type { TitleAutofill } from './title-autofill.dto';

type Season = NonNullable<TitleAutofill['series']>['seasons'][number];

/** Poiskkino v1.5 cursor response; request selects only identity, number and airDate. */
export function parseSeasonPage(
  value: unknown,
  movieId: number,
): { seasons: Season[]; next: string | null } {
  const page = record(value);
  if (
    !Array.isArray(page.docs) ||
    page.docs.length > 250 ||
    typeof page.hasNext !== 'boolean'
  )
    throw new Error('Invalid season page');
  if (
    page.hasNext &&
    (typeof page.next !== 'string' || !page.next || page.next.length > 4096)
  )
    throw new Error('Invalid season cursor');
  const seasons = page.docs.flatMap((value: unknown): Season[] => {
    const season = record(value);
    if (season.movieId !== movieId) throw new Error('Mismatched season title');
    if (season.number == null) return [];
    if (
      typeof season.number !== 'number' ||
      !Number.isInteger(season.number) ||
      season.number < 0 ||
      season.number > 10000
    )
      throw new Error('Invalid season number');
    let releaseYear: number | null = null;
    if (season.airDate != null) {
      if (typeof season.airDate !== 'string')
        throw new Error('Invalid season air date');
      if (season.airDate) {
        const date = season.airDate.slice(0, 10);
        if (
          !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
          !Number.isFinite(Date.parse(season.airDate)) ||
          new Date(date).toISOString().slice(0, 10) !== date ||
          Number(date.slice(0, 4)) < 1
        )
          throw new Error('Invalid season air date');
        releaseYear = Number(date.slice(0, 4));
      }
    }
    return [{ seasonNumber: season.number, releaseYear }];
  });
  return { seasons, next: page.hasNext ? (page.next as string) : null };
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error('Invalid season data');
  return value as Record<string, unknown>;
}
