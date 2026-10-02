# Catalog v3 (SQLite / Turso / libSQL)

The NestJS backend now integrates this schema through `npm run migrate` and
`DATABASE_AUTO_MIGRATE`. Movie/auth/settings repositories use the v3 tables;
series and wishlist routes are implemented. No live database was modified during
implementation. See [API and upgrade guide](../docs/catalog-v3.md).

## Model

| Table | Responsibility |
| --- | --- |
| `titles` | Common movie/series metadata, release date, original JSON payloads and search projections |
| `movie_details` | Movie subtype (reserved for future movie-specific fields) |
| `series_details` | First/last release year, production status, announced season count |
| `seasons` | Explicit season numbers and local availability; 0 means specials |
| `series_summary` | Derived available regular-season count, avoiding a stale stored counter |
| `library_entries` | Membership and original library added date |
| `wishlist_entries`, `wishlist_catalog` | Wishlist membership; view exposes the complete shared metadata including release date |
| `qualities`, `extensions` | Stable text IDs and display values; referenced options cannot be deleted |
| `title_formats`, `season_formats` | Multiple actual quality/extension pairs, at title or season scope |
| `app_settings`, `settings_qualities`, `settings_extensions` | Text singleton ID, ordered options, at most one default per catalog |
| `genres`, `title_genres` | Indexed genre projection for filtering without scanning JSON |
| `auth_credentials` | Original auth IDs and secret values, unchanged |
| `catalog_migrations` | Text migration ID and applied timestamp |
| `legacy_movie_values` | Original nullable is_series and numeric kp_id for exact recovery |

All **new** primary/foreign keys are TEXT. Existing movie/auth IDs stay unchanged.
New entities should use application-generated UUIDs. Migration catalog IDs are
deterministic `quality:<hex bytes>` / `extension:<hex bytes>` / `genre:<hex bytes>`;
the hex encoding preserves case, whitespace, and Unicode. The integrated backend
preserves these existing IDs and uses fixed-length SHA-256 digest IDs for new options.
Use returned IDs in API requests. Its catalog-v4-provider-index migration adds
canonical decimal provider indexing and the login-rate-limit support schema;
the standalone SQL package remains the v3 migration stage.
`kp_id` is an external text identifier, not a primary key. It is indexed but not
unique because the supplied old schema allows duplicates. Numeric counters,
years, durations, flags, and ratings retain their appropriate numeric types.

A title can belong to either or both memberships. A title must get its matching
subtype row in the same transaction as creation. Composite foreign keys prevent
attaching movie details to a series or changing kind while incompatible details
exist. The DB does not require a subtype row at every intermediate insertion;
the repositories enforce complete creation transactionally.

`production_status` supports `unknown`, `in_production`, and `finished`. Finished
series may have an unknown end year; known end years require a finished status
and a known start year. Cancelled series can be classified as finished unless a
separate cancellation status becomes a product requirement. Migration does not
invent season numbers or infer completion from the legacy year array.

`announced_season_count` is optional information, not the availability badge.
Count explicitly available regular seasons via `series_summary`; missing season
numbers are valid. Season formats describe local variants; wishlist/title formats
can describe expected variants. These do not implicitly mark a season available.

Release dates are calendar dates (`YYYY-MM-DD`), independent of wishlist membership,
so promotion preserves them. Evaluate `is_released` against today's date supplied
by the application in the user's timezone. NULL means unknown; a past date records
scheduled release, not independently verified distribution availability.

## Preservation and constraints

Migration keeps every original table, including optional v2 search columns and
login_attempts. All specified metadata fields and JSON strings are copied without
reserialization; array ordering, duplicates, and external relation references are
preserved. Optional v2 search projections are copied by the runner when present.
Backend metadata writes update search and genre projections atomically. JSON
remains the authoritative imported payload; genres provide a disposable query
projection. Other nested metadata remains JSON because stable actor/director IDs
and relation semantics are absent in the source model.

An explicit `is_series = 1` migrates to series; false and NULL migrate to movies,
with the distinction retained in `legacy_movie_values`. Format values absent from
settings become inactive catalog entries, still selectable for existing records.
Options retain titles, order, and defaults. Equal legacy sort orders are preserved,
with ID as a deterministic ordering tie breaker. Partial unique indexes enforce
**at most** one default; require one default in the settings write transaction
when the UI needs it; the settings API enforces exactly one. Referenced catalogs use RESTRICT; retire via `is_active=0`.
The backend rejects inactive options for new assignments, but permits unchanged
retired pairs on existing records.

STRICT typing, explicit NOT NULL text keys, and WITHOUT ROWID are used throughout
new tables. Indexes cover membership ordering, kind, names, ratings, provider IDs,
releases, genre filters, available seasons, and reverse foreign-key lookups.
Large JSON documents do not appear in secondary indexes. FTS is deliberately not
introduced without product search requirements; preserve the existing Unicode
normalization logic, use indexed prefix matching where appropriate, and add FTS
separately if substring/ranked search becomes necessary.

Malformed JSON, null/missing IDs, invalid flags/defaults, unsupported source layout,
or foreign-key violations abort the entire migration. No invalid rows are silently
dropped or coerced into invented metadata. Original values for rating, runtime,
and age rating are intentionally not bounded by new checks that could reject
otherwise migratable legacy records; validate new writes in DTOs.

## Run safely

Back up the complete source database using the provider's backup mechanism first.
Stop application writes and keep the v2 app stopped throughout the upgrade. The
integrated backend adds version 3 to the original integer migration ledger so
older backends refuse startup. New migration tracking uses text IDs; the old
ledger remains solely for compatibility. Stop already-running v2 processes
explicitly before running the migration.

Place this directory inside `cinema-catalogue-be` so Node can resolve its existing
`@libsql/client` dependency. With TURSO_DATABASE_URL and optional TURSO_AUTH_TOKEN
provided through the process environment (the standalone runner does not read
`.env`; `npm run migrate` uses the existing Nest configuration workflow):

```sh
npm run migrate                     # integrated upgrade including repository view
node database-v3/migrate.cjs          # optional standalone preflight (v2 only)
node database-v3/migrate.cjs --apply  # standalone copy; npm run migrate then finishes integration
python3 database-v3/test_schema.py   # isolated SQLite tests
```

The runner uses one write transaction, verifies copied fields plus settings/auth
and row counts, checks foreign keys, and is idempotent after successful commit.
`schema.sql` alone creates an empty target schema. `migrate.sql` expects the source
tables shown in the request (or the inspected backend's normalized v2 layout).
It is not a migration from the backend's older `quality_json` settings layout.
Direct SQL execution must wrap BOTH files in a transaction and run validations;
prefer the runner, which also handles optional search columns and version fencing.

For fresh backend databases, use `npm run migrate`; it creates and seeds defaults.
`schema.sql` alone is only a standalone DDL artifact and needs explicit seeding.
The integrated migration renames old entity tables to `legacy_v2_*` snapshots;
it retains `schema_migrations` as an integer compatibility ledger for version
fencing. Enable `PRAGMA foreign_keys=ON` for every
connection before transactions. Preserve login_attempts as a separate auth concern.

Before applying to production, test on a restored copy using the same libSQL server
version. No claim is made that local SQLite testing proves every remote deployment
supports identical SQL features. For large catalogs, budget write-lock time and
temporary extra storage for copying; this is an offline upgrade, not an online
backfill. Do not drop legacy tables until field comparison, application acceptance,
and a verified backup/restore cycle are complete.

Before v3 receives new writes, rollback can use a restored pre-upgrade backup.
After new series/wishlist writes, restoring that backup loses new data: implement
a reverse exporter or recover the full v3 backup rather than pretending v2 can
represent every new field. Source tables are preserved snapshots, not synchronized
compatibility views.

See `queries.sql` for library pagination, series badges, format display, wishlist
release evaluation, genre filtering, and transactional wishlist promotion.

SQLite references: [STRICT tables](https://www.sqlite.org/stricttables.html),
[WITHOUT ROWID](https://www.sqlite.org/withoutrowid.html),
[foreign keys](https://www.sqlite.org/foreignkeys.html),
[partial indexes](https://www.sqlite.org/partialindex.html).
