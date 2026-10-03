import { membershipTable } from './membership-tables';
import { saveSeasons, validateFormats } from './season-writer';
import { TitleReader } from './title-reader';
import { Injectable } from '@nestjs/common';
import { writeCatalogTransaction } from '../transaction';
import { randomUUID } from 'node:crypto';
import type { Transaction } from '@libsql/client';
import { DatabaseService } from '../database.service';
import { normalizeSearch, substringPattern } from '../search';
import type { PaginationParamsDto } from '../../common/pagination-params';
import {
  TitleInputError,
  LibraryConflictError,
} from '../../shared/titles/title.errors';
import { assertProviderId, syncGenres } from './title-writer';
import type {
  TitleInput,
  Title,
  Format,
  Membership,
} from '../../shared/titles/title.types';

@Injectable()
export class TitlesRepository {
  private readonly reader = new TitleReader();
  constructor(private readonly database: DatabaseService) {}

  async create(
    input: TitleInput,
    membership: Membership,
    seriesOnly = false,
  ): Promise<Title> {
    return this.write(async (tx) => {
      const id = randomUUID();
      await this.save(tx, id, input, membership);
      return this.reader.read(tx, id, membership, seriesOnly);
    });
  }
  async update(
    id: string,
    input: TitleInput,
    membership: Membership,
    seriesOnly = false,
  ): Promise<Title> {
    return this.write(async (tx) => {
      const prior = await this.reader.read(tx, id, membership, seriesOnly);
      if (prior.kind !== input.kind)
        throw new TitleInputError('Changing title kind is not supported');
      await this.save(tx, id, input, membership);
      return this.reader.read(tx, id, membership, seriesOnly);
    });
  }
  async findOne(
    id: string,
    membership: Membership,
    seriesOnly = false,
  ): Promise<Title> {
    const tx = await (
      this.database.readClient ?? this.database.client
    ).transaction('read');
    try {
      return await this.reader.read(tx, id, membership, seriesOnly);
    } finally {
      tx.close();
    }
  }
  async findAll(
    query: PaginationParamsDto,
    membership: Membership,
    seriesOnly = false,
  ) {
    if (
      ![
        'name',
        'addedDate',
        'rating',
        'year',
        'kpId',
        'ageRating',
        'enName',
        'movieLength',
      ].includes(query.key)
    )
      throw new TitleInputError('Unsupported catalog sort key');
    const args: (string | number)[] = [];
    const conditions = seriesOnly ? ["t.kind='series'"] : [];
    if (query.search) {
      conditions.push("t.name_search LIKE ? ESCAPE '\\'");
      args.push(substringPattern(query.search));
    }
    if (query.rating !== undefined) {
      conditions.push('t.rating>=?');
      args.push(query.rating);
    }
    if (query.ageRating?.length) {
      conditions.push(
        `t.age_rating IN (${query.ageRating.map(() => '?').join(',')})`,
      );
      args.push(...query.ageRating);
    }
    if (query.fromYear !== undefined || query.toYear !== undefined) {
      conditions.push(
        'EXISTS(SELECT 1 FROM json_each(t.year_json) WHERE CAST(value AS INTEGER) BETWEEN ? AND ?)',
      );
      args.push(query.fromYear ?? 1, query.toYear ?? 9999);
    }
    if (query.quality?.length) {
      conditions.push(`(EXISTS(SELECT 1 FROM title_formats f JOIN qualities q ON q.id=f.quality_id WHERE f.title_id=t.id AND q.value IN (${query.quality.map(() => '?').join(',')}))
        OR EXISTS(SELECT 1 FROM seasons s JOIN season_formats f ON f.season_id=s.id JOIN qualities q ON q.id=f.quality_id WHERE s.series_id=t.id AND s.is_available=1 AND q.value IN (${query.quality.map(() => '?').join(',')})))`);
      args.push(...query.quality, ...query.quality);
    }
    for (const genre of Array.isArray(query.genres) ? query.genres : []) {
      conditions.push(
        'EXISTS(SELECT 1 FROM title_genres tg JOIN genres g ON g.id=tg.genre_id WHERE tg.title_id=t.id AND g.value=?)',
      );
      args.push(genre);
    }
    for (const [column, raw] of [
      ['actors_search_json', query.actors],
      ['director_search_json', query.directors],
    ] as const) {
      for (const person of raw
        ?.split(',')
        .map((x) => x.trim())
        .filter(Boolean) ?? []) {
        conditions.push(
          `EXISTS(SELECT 1 FROM json_each(t.${column}) WHERE value LIKE ? ESCAPE '\\')`,
        );
        args.push(substringPattern(person));
      }
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const from = `FROM titles t JOIN ${membershipTable[membership]} m ON m.title_id=t.id ${where}`;
    const sort: Record<string, string> = {
      name: 't.name',
      addedDate: 'm.added_date',
      rating: 't.rating',
      year: "CASE json_type(t.year_json) WHEN 'array' THEN json_extract(t.year_json,'$[0]') ELSE json_extract(t.year_json,'$') END",
      kpId: 'CAST(t.kp_id AS INTEGER)',
      ageRating: 't.age_rating',
      enName: 't.en_name',
      movieLength: 't.movie_length',
    };
    const tx = await (
      this.database.readClient ?? this.database.client
    ).transaction('read');
    try {
      const count = await tx.execute({
        sql: `SELECT COUNT(*) AS n ${from}`,
        args,
      });
      const rows = await tx.execute({
        sql: `SELECT t.id ${from} ORDER BY ${sort[query.key]} ${query.direction === 'desc' ? 'DESC' : 'ASC'},t.id ASC LIMIT ? OFFSET ?`,
        args: [...args, query.pageSize, query.currentPage * query.pageSize],
      });
      const list = await this.reader.readMany(
        tx,
        rows.rows.map((row) => String(row.id)),
        membership,
        seriesOnly,
      );
      return {
        list,
        totalCount: Number(count.rows[0].n),
        currentPage: query.currentPage,
      };
    } finally {
      tx.close();
    }
  }
  async delete(
    id: string,
    membership: Membership,
    seriesOnly = false,
  ): Promise<Title> {
    return this.write(async (tx) => {
      const title = await this.reader.read(tx, id, membership, seriesOnly);
      await tx.execute({
        sql: `DELETE FROM ${membershipTable[membership]} WHERE title_id=?`,
        args: [id],
      });
      await tx.execute({
        sql: 'DELETE FROM titles WHERE id=? AND NOT EXISTS(SELECT 1 FROM library_entries WHERE title_id=?) AND NOT EXISTS(SELECT 1 FROM wishlist_entries WHERE title_id=?)',
        args: [id, id, id],
      });
      return title;
    });
  }
  async promote(
    id: string,
    addedDate: string,
    validate: (title: Title, options: unknown) => string | null,
  ): Promise<Title> {
    return this.write(async (tx) => {
      const title = await this.reader.read(tx, id, 'wishlist');
      const format = title.formats[0];
      const options = format
        ? await tx.execute({
            sql: 'SELECT q.value AS quality,e.value AS extension FROM qualities q CROSS JOIN extensions e WHERE q.id=? AND e.id=?',
            args: [format.qualityId, format.extensionId],
          })
        : null;
      const kpId = validate(title, options?.rows[0]);
      await assertProviderId(tx, id, kpId, false);
      const exists = await tx.execute({
        sql: 'SELECT 1 FROM library_entries WHERE title_id=?',
        args: [id],
      });
      if (exists.rows.length) throw new LibraryConflictError();
      await tx.execute({
        sql: 'INSERT INTO library_entries VALUES(?,?)',
        args: [id, addedDate],
      });
      await tx.execute({
        sql: 'DELETE FROM wishlist_entries WHERE title_id=?',
        args: [id],
      });
      return this.reader.read(tx, id, 'library');
    });
  }
  private async write<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
    return writeCatalogTransaction(this.database, work);
  }

  private async save(
    tx: Transaction,
    id: string,
    input: TitleInput,
    membership: Membership,
  ): Promise<void> {
    await assertProviderId(tx, id, input.kpId);
    const priorFormats = await this.formats(
      tx,
      'title_formats',
      'title_id',
      id,
    );
    await validateFormats(tx, [
      { formats: input.formats, prior: priorFormats },
    ]);
    const values = [
      input.kpId,
      input.name,
      input.enName,
      input.description,
      input.releaseDate,
      input.ageRating,
      input.rating,
      input.movieLength,
      input.posterUrl,
      input.compactPosterUrl,
      input.backdropUrl,
      JSON.stringify(input.countries),
      JSON.stringify(input.genres),
      JSON.stringify(input.director),
      JSON.stringify(input.actors),
      JSON.stringify(input.year),
      JSON.stringify(input.sequelsAndPrequels),
      JSON.stringify(input.similarMovies),
      normalizeSearch(input.name),
      JSON.stringify(input.actors.map(normalizeSearch)),
      JSON.stringify(input.director.map(normalizeSearch)),
    ];
    const columns = [
      'kp_id',
      'name',
      'en_name',
      'description',
      'release_date',
      'age_rating',
      'rating',
      'movie_length',
      'poster_url',
      'compact_poster_url',
      'backdrop_url',
      'countries_json',
      'genres_json',
      'director_json',
      'actors_json',
      'year_json',
      'sequels_and_prequels_json',
      'similar_movies_json',
      'name_search',
      'actors_search_json',
      'director_search_json',
    ];
    await tx.execute({
      sql: `INSERT INTO titles(id,kind,${columns.join(',')}) VALUES(?,?,${columns.map(() => '?').join(',')}) ON CONFLICT(id) DO UPDATE SET ${columns.map((c) => `${c}=excluded.${c}`).join(',')}`,
      args: [id, input.kind, ...values],
    });
    await tx.execute({
      sql: `INSERT INTO ${membershipTable[membership]} VALUES(?,?) ON CONFLICT(title_id) DO UPDATE SET added_date=excluded.added_date`,
      args: [id, input.addedDate],
    });
    const formatKey = (format: Format) =>
      JSON.stringify([format.qualityId, format.extensionId]);
    const priorKeys = new Set(priorFormats.map(formatKey));
    const nextKeys = new Set(input.formats.map(formatKey));
    const formatStatements = [
      ...priorFormats
        .filter((format) => !nextKeys.has(formatKey(format)))
        .map((format) => ({
          sql: 'DELETE FROM title_formats WHERE title_id=? AND quality_id=? AND extension_id=?',
          args: [id, format.qualityId, format.extensionId],
        })),
      ...input.formats
        .filter((format) => !priorKeys.has(formatKey(format)))
        .map((format) => ({
          sql: 'INSERT INTO title_formats VALUES(?,?,?)',
          args: [id, format.qualityId, format.extensionId],
        })),
    ];
    if (formatStatements.length) await tx.batch(formatStatements);
    await syncGenres(tx, id, input.genres);
    if (input.series) await saveSeasons(tx, id, input.series);
    else
      await tx.execute({
        sql: 'INSERT INTO movie_details(title_id) VALUES(?) ON CONFLICT DO NOTHING',
        args: [id],
      });
  }
  private async formats(
    tx: Transaction,
    table: 'title_formats' | 'season_formats',
    column: 'title_id' | 'season_id',
    id: string,
  ): Promise<Format[]> {
    const rows = await tx.execute({
      sql: `SELECT quality_id,extension_id FROM ${table} WHERE ${column}=? ORDER BY quality_id,extension_id`,
      args: [id],
    });
    return rows.rows.map((r) => ({
      qualityId: String(r.quality_id),
      extensionId: String(r.extension_id),
    }));
  }
}
