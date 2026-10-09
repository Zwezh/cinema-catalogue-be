# Cinema catalogue backend

NestJS 12 API with a libSQL/Turso database and one administrator credential. Read endpoints are public; movie and settings writes require a Bearer token.

## Setup

Use Node.js 22.22.3+, 24.15+, or 26+. Node 24 LTS is recommended. Install dependencies with `npm ci`. Configure these variables in the environment or a local `.env` file:

| Variable                | Required/default                                 | Purpose                                                      |
| ----------------------- | ------------------------------------------------ | ------------------------------------------------------------ |
| `TURSO_DATABASE_URL`    | Required                                         | `file:./cinema.db` locally, or a supported remote libSQL URL |
| `TURSO_AUTH_TOKEN`      | Required for remote production DB                | Database access token                                        |
| `KINOPOISK_API_TOKEN` | Required for movie autofill; otherwise endpoint returns 503 | Server-only PoiskKino provider key |
| `JWT_KEY`               | Required, at least 32 bytes                      | Random signing secret; changing it invalidates all tokens    |
| `NODE_ENV`              | `development`, `test`, or `production`          | Select production migration/token safeguards                 |
| `PORT`                  | `3000`                                           | HTTP listening port                                          |
| `CORS_ORIGINS`          | `https://cinema-catalogue.web.app`               | Comma-separated explicit HTTP(S) origins, without paths      |
| `DATABASE_AUTO_MIGRATE` | `true` outside production; `false` in production | Run migrations at startup, or check schema version only      |
| `TRUST_PROXY_HOPS`      | `0`                                              | Fixed number of trusted proxy hops for client IP detection   |

Keep `TRUST_PROXY_HOPS=0` for direct traffic. Behind a proxy, use the actual fixed topology and prevent clients from reaching the app through a shorter path. IP-based login throttling relies on this configuration. Instances must share the same primary database for a shared login limit; local database files or independent replicas do not share counters.

```sh
npm run migrate
npm run start:dev
```

Run migrations once in a deployment job with development dependencies installed before starting production instances. Production startup checks the schema version and does not modify the schema unless explicitly configured to migrate. Startup fails on missing migrations, an incompatible schema, or invalid configuration. Shutdown closes the database client.

## Authentication

The `auth` table must contain exactly one administrator record with a bcrypt hash in `secret_key`. Use the validated backup importer to initialize it. Multiple administrator records fail authentication explicitly rather than silently selecting one.

`POST /api/auth` accepts `{ "secretKey": "..." }` and returns `{ "access_token": "..." }`. Access JWTs expire after 15 minutes. A rotating HttpOnly refresh cookie restores sessions for up to 30 days from sign-in. `POST /api/auth/refresh` issues a replacement access token and cookie; `POST /api/auth/logout` revokes the session and clears the cookie. All three routes require an allowed `Origin` and `X-MediaShelf-Request: 1`. Replacing the credential hash or removing the administrator invalidates sessions. Old JWTs without a session ID require signing in again. See [refresh authentication and deployment](docs/refresh-auth.md).

Login accepts nonempty strings up to 72 UTF-8 bytes without trimming or changing the secret. Invalid bodies return 400; wrong credentials return 401. All login attempts, including malformed and successful requests, count toward the shared limit of ten attempts per client IP per 60-second window. Exceeding it returns 429 with `Retry-After`; denied attempts do not extend the window.

## API compatibility and validation

- `GET /api/movies`, `GET /api/movies/:id`, `GET /api/movies/genres`, and `GET /api/settings` are public.
- Movie `POST`, `PUT`, `DELETE`, and settings `PUT` require authentication.
- Movie writes require the complete DTO. Unknown fields, wrong types and invalid nested values return 400. `PUT /api/movies` uses the body `id`.
- `ageRating` and `isSeries` accept null. Empty artwork URLs are allowed; populated URLs require HTTP(S). Blank descriptions and English names are allowed. Dates accept valid ISO dates or timezone-qualified ISO timestamps. Ratings are 0–10, years are integers 1–9999, and `kpId` is a positive safe integer.
- Movie quality/extension must exactly match configured catalog values at write time. Removing an option does not rewrite historical movies. Update those movies to a configured option when editing them.
- Settings catalogs contain 1–100 options, exactly one default, and values unique ignoring case/whitespace. Optional `default` values must be booleans. Clients may PUT the full settings GET response, including the historical `_id`; this identifier is an API compatibility value, while database settings use singleton ID 1.
- Pagination remains zero-based. Page size defaults to 20 and must be an integer from 1–100. Sort direction is `asc` or `desc`; unknown sort keys return 400. Ordering includes a unique ID tie-breaker. Count and list share a read transaction.
- Search uses Unicode NFKC normalization and lowercase matching. `%`, `_`, and backslash are literal characters. Actor/director filters are comma-separated strings; genres, quality and ageRating support comma-separated strings or repeated query values. Quality and ageRating selections use OR within each filter, with AND between filters; genres retain AND matching. A year range must contain at least one stored release year.
- Conflicting movie `kpId` values return 409 for creates and updates. Mutations return the row from their own database operation.

## Backup import and recovery

Back up the database before deploying migrations. Existing duplicate `kp_id` values abort unique-index creation without deleting movies. Inspect them with:

```sql
SELECT kp_id, COUNT(*) AS copies FROM movies GROUP BY kp_id HAVING COUNT(*) > 1;
```

Resolve duplicates explicitly, then retry `npm run migrate`. Invalid legacy catalog JSON aborts settings migration without dropping legacy settings. Fix or restore the source data and retry; custom catalogs are preserved. Search migration backfills normalized fields and records schema version 2.

```sh
npm run import:backups -- ../backups \
  --movies movies-sep-26.json \
  --auth auths-sep-26.json \
  --settings settings-sep-26.json
```

All backup records are validated before opening the database. The import preserves Mongo ObjectIds, checks duplicate IDs/kpIds, shares movie serialization with API writes, and uses ID-based upserts rather than replacement deletes. Exported Mongo `__v` metadata is ignored. Missing legacy collection arrays become empty arrays; missing nullable fields become null.

Data updates run in one transaction, with statement batches of 100. Any failure rolls back the entire import's auth, settings and movie changes; schema migrations are separate and may already have committed. Existing movies not present in the backup are retained. An administrator ID different from the backup aborts import rather than replacing an unrelated administrator.

Catalogs supplied in the settings backup are restored. If absent, existing catalogs remain unchanged. `--reset-catalogs` explicitly replaces them with application defaults. `--repair-movies` enables the known accidental-byte repair for the legacy export; repairs are not applied automatically. Validate historical movie fields even when their catalog option has been retired.

The import loads the backup into memory and holds one write transaction. For substantially larger datasets, use a staging/resumable import workflow after measuring transaction limits.

## Verification

```sh
npm run typecheck
npm run lint:check
npm test
npm run build
```

See [CODE_REVIEW.md](CODE_REVIEW.md) for verified findings and [DEPENDENCY_UPGRADE.md](DEPENDENCY_UPGRADE.md) for version/compatibility details.

Tests use temporary databases, and the HTTP integration test binds a temporary loopback port. CI runs the same checks. Lint checking does not modify files; `npm run lint` applies fixes.

## Scaling follow-up

Page size is bounded, but substring/JSON filtering and large offsets still scan entries. Benchmark representative data and production latency before selecting full-text search, indexed relationship tables, or a versioned cursor API. Those changes are conditional on measured needs and are not silently introduced into the existing pagination contract. Concurrent full-document edits currently use last-write-wins; introduce a version/ETag API with frontend support if edit conflict prevention is required.

## Kinopoisk autofill

Authenticated `GET /api/kinopoisk/titles/:id/autofill` returns normalized editor metadata (`kpId`, titles, artwork, actors/directors, genres/countries, relationships, and nullable numeric rating/year/duration/age rating). It does not write the movie collection. The browser sends only its administrator JWT. Configure `KINOPOISK_API_TOKEN` in the ignored server `.env` or deployment secret environment; never put it in frontend environment files. A `.env.example` contains placeholders only.

The focused Kinopoisk module owns the fixed `https://api.poiskkino.dev/v1.4/movie/{id}` request with `X-API-KEY`, provider parsing and mapping. It disallows redirects, times out after ten seconds, and limits JSON responses to 2 MiB. IDs must be positive safe integers. Empty/null optional metadata maps to empty strings/arrays or nullable numbers; the frontend preserves its current draft when metadata is absent. Unknown provider fields are excluded from the response.

An invalid user JWT returns 401; invalid IDs return 400; missing provider configuration returns 503; provider 404 returns 404; timeout returns 504; provider credentials/quota/network/JSON/schema failures return sanitized 502 responses. Provider 401 responses never sign the frontend user out. Keys, provider error bodies and raw network exceptions are not logged or returned. Tests mock provider requests and use temporary databases.

Release the backend and frontend together: the removed `/api/kinopoisk/movies/:id/autofill` URL returns 404. Keys previously embedded in frontend source/bundles need rotation at the provider; Git history removal is not performed automatically. Replace the server environment value with the rotated key and restart the process. Restrict `.env` access to the deployment owner (`chmod 600 .env`) and keep it out of backups shared with others.

## Catalog v3: series and wishlist

The backend now uses text entity IDs, common title metadata, separate movie/series
subtypes, explicit seasons, catalog-backed formats, and wishlist membership.
`npm run migrate` upgrades v1/v2 databases or creates a fresh database. Existing
movie endpoints retain their scalar movie DTO; new series/wishlist endpoints use
text provider IDs and format IDs returned by settings.

Read the [API and upgrade guide](docs/catalog-v3.md) before upgrading. It documents
new routes, request examples, archived legacy tables, and deployment sequencing.
No frontend changes or live database migration are included in this implementation.

The backend review fixes and solution choices are documented in
[docs/NESTJS_REVIEW.md](docs/NESTJS_REVIEW.md). Run `npm run migrate` before
production startup to apply the additive `catalog-v4-provider-index` upgrade.

### Series and wishlist autofill

Authenticated `GET /api/kinopoisk/titles/:id/autofill` returns provider-only `TitleAutofill` metadata for movies or series. It is the sole autofill endpoint for all editors and uses server-only provider credentials, JWT guard, timeout, bounded response reader, and sanitized errors. The redundant movie endpoint has been removed; frontend and backend must be released together.

The title response uses a string `kpId`, nullable numbers and release date, a nullable detected `kind`, and optional subtype metadata in `series`. Provider `isSeries` takes priority over `type`; absent ambiguous type remains null. Series years come from `releaseYears` with `year` as fallback; provider `releaseYears.end: 0` is normalized to null (unknown end), without treating the series as finished. When production status is absent, an open-ended release range with a known start maps to `in_production`; a fully bounded range maps to `finished`; missing ranges stay `unknown`. Explicit provider statuses take precedence. Episode duration uses `seriesLength`, and `premiere.world` becomes a valid date-only release date. Active provider statuses map to `in_production`; completed maps to `finished`; unrecognized statuses remain `unknown`. End years are emitted only for finished series. Season zero is valid and repeated season numbers are deduplicated.

Provider season lists do not establish local file availability or an authoritative announced total. Series enrichment requests `GET https://api.poiskkino.dev/v1.5/season?movieId=ID` with selected `movieId`, `number`, and `airDate` fields. Cursor pagination follows at most four pages of 250 records under one ten-second timeout; cursors are encoded query values on the fixed provider host. Invalid data, repeated cursors or excess pages fail without partial metadata. Known air dates supply the existing season release year; exact season dates are not persisted. Undated `seasonsInfo` numbers are retained. See the [provider schema](https://api.poiskkino.dev/documentation-json). Returned season entries contain only `seasonNumber` and nullable `releaseYear`; no formats, availability flags, membership date, server entity ID, or derived available count is returned. Media-shelf validates this separate DTO and merges it into the latest user draft before sending a normal collection write DTO. New imported seasons default to unavailable with no formats, and existing local season data is preserved. No collection is written by autofill.

Provider schema reference: https://api.poiskkino.dev/documentation-json


Autofill troubleshooting: the movie response can omit `seasonsInfo` even for a known series. The separate season request is therefore required. A live check for ID `915196` on 2026-10-06 returned seasons 1–5 with release years 2016, 2017, 2019, 2022, and 2025 through the current service. If an API instance returns an empty list for that ID, compare its deployed version and provider configuration with the current build; rebuilding source does not restart an already running server. A deterministic regression covers the missing-`seasonsInfo` case without live provider calls.
