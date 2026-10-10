# Series, wishlist, and catalog v3

## Upgrade

1. Back up the complete SQLite/Turso database and stop all writers, including older backend processes.
2. Deploy this backend source with the `database-v3/` SQL directory included next to `dist/`. Run `npm run build`.
3. Run `npm run migrate` using your existing database environment configuration. This command loads `.env` through Nest ConfigModule. It does not import backup JSON automatically.
4. Start the backend with `DATABASE_AUTO_MIGRATE=false` in production. Startup checks the text `catalog_migrations` ledger and the repository view. Verify movies, settings, authentication, series, and wishlist before reopening writes.

The integrated command now applies `catalog-v4-provider-index` after v3. This
transactional step adds an index for canonical decimal provider lookups and ensures
the login rate-limit table/index exist, including after standalone v3 migrations.
It preserves title metadata and existing catalog IDs. The current backend requires
both text ledger entries; older v3 backend versions refuse the newer ledger.

Fresh databases use the same migration command and receive default catalogs.
Older settings JSON and search-column migrations remain supported. The v3 copy,
foreign-key check, subtype creation, version fencing, and source-table renames run
in a write transaction. Existing preparatory v1/v2 migrations retain their own
transactions. Invalid inputs abort rather than silently discard data.

The original entity tables are retained as `legacy_v2_movies`, `legacy_v2_settings`,
`legacy_v2_quality_options`, `legacy_v2_extension_options`, and `legacy_v2_auth`.
They are snapshots, not synchronized read/write tables. Original JSON, search
columns, nullable `is_series`, option order, and credentials remain recoverable.
`schema_migrations` retains its original integer version ledger with version 3
to fence older backends; active entity keys and new migration IDs are text.
`login_attempts` remains an independent auth table keyed by text.

Migration accepts duplicate legacy kpIds and preserves every title. New API writes
check provider ID conflicts under a write lock across movies, series, and wishlist.
Existing legacy duplicates may keep their old kpId during edits. The schema does
not introduce a unique index that would prevent their migration.

If the standalone `database-v3/migrate.cjs --apply` was already used, `npm run migrate`
finishes the repository integration without repeating the data copy. The standalone
runner defaults to a rolled-back preflight and does not replace the integrated
command. It reads environment variables directly, without automatically loading `.env`.

Restore the pre-upgrade backup to roll back before v3 writes. After new v3 writes,
restoring an old backup loses new data; retain a complete v3 backup or write a reverse
exporter. Do not delete archived tables as part of this upgrade.

## Routes

All routes use the existing `/api` prefix. GETs follow the current public catalog
policy. Every POST, PUT and DELETE requires an administrator bearer JWT
and honors credential revocation.

| Route | Behavior |
| --- | --- |
| `GET /series` | Paginated library series |
| `GET /series/:id` | Series metadata, formats, season details, and availability count |
| `POST /series` | Create library series |
| `PUT /series/:id` | Replace editable series fields and season list |
| `DELETE /series/:id` | Remove series from library; keep metadata if still in wishlist |
| `GET /wishlist` | Paginated wishlist movies and series |
| `GET /wishlist/:id` | Wishlist title with complete metadata and release date |
| `POST /wishlist/from-kinopoisk` | Import provider metadata from `{kpId}`; return `{id}` |
| `POST /wishlist/:id/refresh` | Refresh provider metadata from `{kpId}`; return title |
| `DELETE /wishlist/:id` | Remove wishlist membership; delete title if no memberships remain |

Existing `/movies`, `/settings`, `/auth`, and Kinopoisk autofill routes remain.
`/movies` accepts and returns the existing numeric kpId/scalar quality/scalar
extension DTO for frontend compatibility. New `isSeries:true` writes use `/series`
instead; migrated series are listed there. Movie metadata-only edits preserve
additional formats from Wishlist library transfer. Changing the legacy scalar quality or
extension explicitly replaces its title-format selection.

GET settings adds `id` to each quality and extension option.
`GET /settings/catalogs` returns all quality/extension options with `id`, `value`,
`isActive`, and quality `title`, including retired options for rendering existing
format labels. Use ordinary GET settings for ordered active selection menus. PUT settings accepts
those IDs or the original value-only shape. IDs cannot be forged/rebound to another
value. Removing an option retires it, preserving referenced formats. New assignments
require active options; unchanged retired pairs remain valid when editing a title.
PUT settings requires exactly one default in each catalog. Newly inserted options
use fixed-length digest IDs; existing hex IDs remain unchanged. Always use returned
IDs rather than constructing them. Legal Unicode values round trip through both
settings and catalog formats.

Series and wishlist list responses are `{list, totalCount, currentPage}`. Supported
query parameters: `currentPage` (zero-based), `pageSize` (1–100), `search`, `genres`,
`quality` (catalog display values, comma-separated or repeated), `ageRating`,
`fromYear`, `toYear`, `rating`, `actors`, and `directors`. Supported sort keys are
`name`, `addedDate`, `rating`, `year`, `kpId`, `ageRating`, `enName`, `movieLength`,
with `direction=asc|desc`. Genre/people filters combine with AND; quality/age lists
use OR. Year ranges require one actual stored year to match. Season quality filters
include formats of available seasons. List/detail reads use a transaction snapshot.

## Request examples

Get `/api/settings` first and use the actual returned quality/extension IDs:

```json
{
  "name": "Example series",
  "addedDate": "2026-10-01",
  "kpId": "12345",
  "year": [2020, 2025],
  "genres": ["Drama"],
  "releaseDate": "2020-03-01",
  "formats": [
    { "qualityId": "quality:3130383070", "extensionId": "extension:4D4B56" },
    { "qualityId": "quality:3231363070", "extensionId": "extension:4D5034" }
  ],
  "series": {
    "startYear": 2020,
    "endYear": 2025,
    "productionStatus": "finished",
    "announcedSeasonCount": 3,
    "seasons": [
      { "seasonNumber": 1, "releaseYear": 2020, "isAvailable": true },
      { "seasonNumber": 2, "releaseYear": 2023, "isAvailable": true },
      { "seasonNumber": 3, "releaseYear": 2025, "isAvailable": false }
    ]
  }
}
```

POST this to `/api/series`. It returns an opaque text `id`, complete defaulted
metadata, and `availableSeasonCount: 2`. Wishlist accepts only provider-backed
creation via `/api/wishlist/from-kinopoisk` with `{ "kpId": "915196" }`.
See [Wishlist workflow](wishlist-workflow.md) for refresh and library transfer.

`name` and a valid ISO `addedDate` are required. Wishlist `kind` is required;
the series endpoint fixes it to series. The remaining common fields are optional:
`enName`, `description`, `ageRating`, artwork URLs, `countries`, `genres`, `director`,
`actors`, `sequelsAndPrequels`, `similarMovies`, `kpId`, `year`, `movieLength`,
`rating`, `formats`, `releaseDate`. Unknown provider ID/year/runtime/rating/release
date use NULL; other metadata defaults to empty strings/arrays. New kpIds are positive safe decimal integers represented as text. Leading zeros
and surrounding whitespace are normalized; zero, signs, fractions, and unsafe
integers are rejected. Conflicts also recognize historical decimal aliases.
Sorting by kpId uses numeric ordering.
Arrays contain strings; year is an integer or distinct integer array. Artwork
uses HTTP(S) URLs or empty strings. The existing field limits remain enforced.

For movies, `series` must be absent or null. Series defaults to an unknown production
status, unknown years/count, and an empty season list. Status is `unknown`,
`in_production`, or `finished`. A known end year requires finished status and a
start year no later than end year. Finished status can still have an unknown end year.
Season numbers may be sparse. Season 0 means specials and is excluded from the
regular-season badge. Every submitted season must have a boolean `isAvailable`;
`releaseYear` and its own `formats` array are optional. Repeated season numbers or
format pairs are rejected. Unchanged season numbers retain internal text IDs. Metadata-only updates preserve
unchanged season rows and format relationships; changed relations are reconciled
in bounded batches within one transaction.

PUT replaces editable metadata, formats, and seasons; omitted optional fields
reset to defaults. Remove response-only `id` and `availableSeasonCount` before PUT.
Changing kind in place is rejected. All metadata/projection/format changes roll
back together on an invalid nested value or catalog reference.

Move a Wishlist title through the normal Movie or Series create endpoint with
complete editor data and optional `wishlistId`. The backend also finds matching
Wishlist titles automatically by canonical kpId. The transfer is atomic, retains
the title ID, and rolls back if validation fails. The old generic Wishlist POST,
PUT and date-only promotion routes are removed.

Release dates are validated `YYYY-MM-DD` calendar dates. The frontend can evaluate
`releaseDate <= today` using the user's timezone; NULL means unknown. This indicates
the recorded scheduled release, not independently verified availability.

## Verification

`npm test` covers existing movie/settings/auth/Kinopoisk behavior plus new repository
and HTTP scenarios. `npm run typecheck`, `npm run lint:check`, and `npm run build`
validate the implementation. `python3 database-v3/test_schema.py` exercises the
standalone SQL constraints and preservation. Tests use isolated local databases;
verify a restored copy against the actual Turso deployment before production upgrade.


## Pagination performance migrations

Run `npm run migrate` before deploying the current backend. Following v4,
`catalog-v5-page-indexes` adds ascending/descending `(kind, name, id)` indexes;
`catalog-v6-sort-indexes` adds matching rating/year indexes with stable name/ID
tie breakers. These migrations add indexes only; no metadata or memberships are
rewritten. Previously applied v3/v4 databases upgrade in order and repeated runs
are idempotent.

Movie lists count against titles/library membership, then materialize only page
IDs. A page-driven CROSS JOIN retrieves full movie records through primary-key
lookups. This deliberately fixes the join order: an IN subquery allowed SQLite
to scan every movie through a sorting index again. The final sort covers only the
selected page, rather than all descriptions, artwork and JSON arrays.

On 2026-10-02 the live original 30-row view query exceeded a 30-second diagnostic
limit (users reported approximately five minutes and timeouts). Its plan selected
`titles_kind`, then a temporary sort. The old archived table returned 30 rows in
1.95 seconds. After the migrations and page-driven query, eight live repository
calls completed without timeouts: first name read 12.54 seconds while index
installation finished; subsequent name/date/rating/year/quality and second-page
reads 2.65–6.41 seconds. These are end-to-end Turso driver timings from this host,
not SQLite CPU timings or a production latency guarantee.

Regression tests check page materialization, primary-key hydration, sort index
usage in both directions, stable order, pagination and unchanged total counts.

Two subsequent real HTTP requests to the rebuilt NestJS app returned 200 with
30 records and total 2,116: added-date descending in 7.99 seconds, name ascending
in 11.91 seconds. The timeout regression is removed for the measured unfiltered
pages, but remote latency remains material; these results do not establish an
instantaneous response or performance for every filter combination.


## Local catalogue read replica

Further profiling showed that SQL plans were only part of the latency problem.
Using Turso's Hrana response statistics, a trivial `SELECT 1` took 2,036.9 ms
server-side; an indexed ID page took 688.7 ms, the old flat table 2,116.0 ms,
and the normalized view page 19,876.4 ms. HTTP transfer added roughly 0.1–0.5
seconds. The SDK used one HTTP request per page, and decoding was under 100 ms.
The measured remote server behavior cannot provide a reliable sub-second read
SLA just by changing the NestJS controller or adding more indexes.

For this Node backend with persistent disk, the existing libSQL SDK supports an
embedded replica. Configure:

```
TURSO_REPLICA_PATH=.tmp/read-replica/catalog.sqlite
TURSO_REPLICA_SYNC_MS=30000
```

The primary `TURSO_DATABASE_URL` and token stay unchanged. On startup the backend
synchronizes the replica before selecting it for public movie, series, wishlist
and settings reads. A separate local connection pool supports concurrent read
transactions. No response cache or replacement SQL engine is introduced, and no
remote metadata/schema changes are needed. Indexes remain useful locally.

All writes, login throttling and JWT credential checks use the remote primary.
Catalogue writes refresh the replica **after commit** before returning; rollback
never refreshes. A post-write refresh queues behind a background sync rather
than joining it, so it includes the newly committed write. If synchronization
fails, catalogue reads fall back to the primary and periodic retries recover.

Changes made through another backend instance or a database tool become visible
on the next background sync (30 seconds plus sync duration by default). This is
an explicit consistency tradeoff, not a stale response cache. Authentication
never uses replicated credentials, so credential revocation remains immediate.
The first bootstrap is a startup cost; it is not repeated for page requests.

The local file is mode 0600 in a dedicated protected directory, and is kept out
of Git. Persistent storage is required; leave the path empty/absent on hosts
without writable persistent disk. Do not point it at the primary database file.

A replica bootstrapped from the actual remote catalogue in 7.68 seconds. Reading
30 complete movies with name/date/rating/year ordering took 10–18 ms with total
2,116; ten concurrent reads also succeeded. The same response contract, original
metadata and normalized write model are retained.


HTTP verification with the configured replica returned 200 for every endpoint:
30-item movie pages with name/date/rating/year ordering, quality and year/rating
filters and second-page pagination took 28–247 ms; settings 9 ms, series 12 ms,
wishlist 8 ms and genres 30 ms. Ten concurrent movie/series/wishlist HTTP requests
completed in 118 ms total. All 59 isolated tests passed, including authoritative
write/auth routing, post-commit refresh ordering, failed-sync fallback/recovery,
configuration validation and existing API contracts.
