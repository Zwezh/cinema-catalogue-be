import { randomUUID } from 'node:crypto';
import type { InStatement, Transaction } from '@libsql/client';
import { TitleInputError } from '../../shared/titles/title.errors';
import type { Format, SeriesDetails } from '../../shared/titles/title.types';

const key = (format: Format) =>
  JSON.stringify([format.qualityId, format.extensionId]);
export async function validateFormats(
  tx: Transaction,
  groups: { formats: Format[]; prior: Format[] }[],
): Promise<void> {
  if (!groups.some((group) => group.formats.length)) return;
  const [quality, extension] = await tx.batch([
    'SELECT id,is_active FROM qualities',
    'SELECT id,is_active FROM extensions',
  ]);
  const qualities = new Map(
    quality.rows.map((row) => [String(row.id), Boolean(row.is_active)]),
  );
  const extensions = new Map(
    extension.rows.map((row) => [String(row.id), Boolean(row.is_active)]),
  );
  for (const group of groups) {
    const prior = new Set(group.prior.map(key));
    for (const format of group.formats) {
      if (
        !qualities.has(format.qualityId) ||
        !extensions.has(format.extensionId) ||
        ((!qualities.get(format.qualityId) ||
          !extensions.get(format.extensionId)) &&
          !prior.has(key(format)))
      )
        throw new TitleInputError(
          'Formats must reference active configured options',
        );
    }
  }
}

export async function saveSeasons(
  tx: Transaction,
  id: string,
  details: SeriesDetails,
): Promise<void> {
  const [seasons, formats] = await tx.batch([
    { sql: 'SELECT * FROM seasons WHERE series_id=?', args: [id] },
    {
      sql: 'SELECT f.* FROM season_formats f JOIN seasons s ON s.id=f.season_id WHERE s.series_id=?',
      args: [id],
    },
  ]);
  const prior = new Map(
    seasons.rows.map((row) => [Number(row.season_number), row]),
  );
  const priorFormats = new Map<string, Format[]>();
  for (const row of formats.rows) {
    const seasonId = String(row.season_id);
    const group = priorFormats.get(seasonId) ?? [];
    group.push({
      qualityId: String(row.quality_id),
      extensionId: String(row.extension_id),
    });
    priorFormats.set(seasonId, group);
  }
  await validateFormats(
    tx,
    details.seasons.map((season) => ({
      formats: season.formats,
      prior: priorFormats.get(String(prior.get(season.seasonNumber)?.id)) ?? [],
    })),
  );
  const statements: InStatement[] = [
    {
      sql: `INSERT INTO series_details(title_id,start_year,end_year,production_status,announced_season_count) VALUES(?,?,?,?,?)
      ON CONFLICT(title_id) DO UPDATE SET start_year=excluded.start_year,end_year=excluded.end_year,production_status=excluded.production_status,announced_season_count=excluded.announced_season_count`,
      args: [
        id,
        details.startYear,
        details.endYear,
        details.productionStatus,
        details.announcedSeasonCount,
      ],
    },
  ];
  const retained = new Set(
    details.seasons.map((season) => season.seasonNumber),
  );
  for (const [number, row] of prior)
    if (!retained.has(number))
      statements.push({
        sql: 'DELETE FROM seasons WHERE id=?',
        args: [String(row.id)],
      });
  for (const season of details.seasons) {
    const old = prior.get(season.seasonNumber);
    const seasonId = old ? String(old.id) : randomUUID();
    if (
      !old ||
      old.release_year !== season.releaseYear ||
      Boolean(old.is_available) !== season.isAvailable
    )
      statements.push({
        sql: `INSERT INTO seasons VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET release_year=excluded.release_year,is_available=excluded.is_available`,
        args: [
          seasonId,
          id,
          season.seasonNumber,
          season.releaseYear,
          Number(season.isAvailable),
        ],
      });
    const oldFormats = priorFormats.get(seasonId) ?? [];
    const oldKeys = new Set(oldFormats.map(key));
    const newKeys = new Set(season.formats.map(key));
    for (const format of oldFormats)
      if (!newKeys.has(key(format)))
        statements.push({
          sql: 'DELETE FROM season_formats WHERE season_id=? AND quality_id=? AND extension_id=?',
          args: [seasonId, format.qualityId, format.extensionId],
        });
    for (const format of season.formats)
      if (!oldKeys.has(key(format)))
        statements.push({
          sql: 'INSERT INTO season_formats VALUES(?,?,?)',
          args: [seasonId, format.qualityId, format.extensionId],
        });
  }
  // Bound remote request sizes while retaining one atomic transaction.
  for (let offset = 0; offset < statements.length; offset += 200)
    await tx.batch(statements.slice(offset, offset + 200));
}
