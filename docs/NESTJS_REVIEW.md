# Backend review and fixes — 2026-10-02

Reviewed the existing Node.js/NestJS backend: controllers, modules, services,
repositories, validation, auth/JWT/rate limiting, settings, movies, series,
wishlist, Kinopoisk client/parser/mapper, environment configuration, import scripts,
and database migrations. Applied the imported project instructions and
`.agents/skills/nestjs-best-practices/`, with particular attention to SOLID, KISS,
DRY, transactional integrity, input validation, and database round trips.

## Verified problems and solution choices

| Priority | Problem | Options considered | Applied solution | Verification |
| --- | --- | --- | --- | --- |
| P2 | Provider IDs `1`, `01`, and whitespace aliases bypassed conflicts; historic aliases could be promoted into duplicates. | Reject noncanonical IDs; normalize decimal IDs. | Normalize positive safe decimal text at the application boundary; compare historical aliases under the write lock; recheck promotion conflicts. Preserve historical records and allow existing duplicate records to be edited without creating another membership conflict. | Alias creation/update and conflicting historical promotion regressions; rollback and record-count checks. |
| P2 | Legal Unicode catalog values generated IDs longer than format validation accepted. Settings ID validation also depended on the old hex encoding. | UUID IDs; fixed-length digests; enlarge legacy bounds only. | Fixed-length SHA-256 catalog IDs for newly inserted values; accept old UTF-8 hex IDs and returned new IDs. Upserts preserve existing IDs. Shared identifier limits and generator. | Unicode settings GET/PUT/create round trip, legacy long-ID format assignment, migration preservation. |
| P2 | Season writes loaded formats per season, validated each pair with a query, and deleted/recreated unchanged rows. | Batch complete replacement; batch reads and apply a diff. | Batch relation/catalog reads, use maps/sets, write only changed seasons and pairs, retain season IDs; bounded batches in the same transaction. Title format writes and genre projection updates also avoid unchanged rewrites. | 100-season metadata update: fewer than 30 SQL statements and 20 calls, zero season inserts/updates/deletes; explicit changed/removed season checks and FK checks. |
| P2 | TitlesRepository mixed request parsing, promotion policy, HTTP errors, SQL, and response mapping. | One application service; separate feature services and shared persistence. | SeriesService/WishlistService expose feature operations; TitlesService owns validation, promotion readiness, and HTTP error translation. TitlesRepository accepts parsed types and owns atomic persistence; TitleReader and season-writer isolate relation mapping and season persistence. | Existing CRUD, conflict, rollback, promotion, and HTTP tests. |
| P3 | Two controllers were in one generic controller file, with feature selection flags in handlers. | Separate files only; focused feature modules sharing catalog providers. | Separate series/wishlist feature folders with controller, service, and module files; shared TitlesModule exports one TitlesService provider. Controllers no longer select membership through positional flags. Promotion body parsing uses the existing validation pipe. | Typecheck/build and real HTTP auth/route regression. |
| P2 | Movie quality filtering inspected only the compatibility view's first format. | Restrict movies to one format; query all format relationships. | EXISTS query across title_formats and qualities; genre filtering uses the relational genre projection. | Promoted movie with 1080p and 2160p appears under both filters. |
| P2 | Catalog kpId sorting used lexical ordering of text IDs (`100,20,3`). | Lexical ordering; numeric expression for decimal provider IDs. | Numeric sorting while keeping stored IDs as text. | Sort regression expects `3,20,100`. |
| P3 | Catalog metadata validation constructed fake movie IDs/quality/extension fields to reuse the movie validator. | Duplicate validators; extract common metadata/year parsing. | Shared validateTitleMetadata and validateYear; no synthetic movie fields needed. Promotion uses the same metadata validation. | Catalog nested validation and existing movie body/parser regressions. |
| P2 | Comparing historical provider aliases through CAST would scan titles despite the existing plain text kp_id index. | Canonical shadow column; indexed numeric expression. | Transactional catalog-v4-provider-index migration creates a partial expression index; historical values and duplicate titles remain unchanged. | EXPLAIN QUERY PLAN confirms the canonical provider index; v4 upgrade preservation/idempotence test. |
| P2 | A standalone v3 upgrade from the supplied schema could lack login_attempts, breaking the login rate limiter. | Require a legacy bootstrap; create shared auth support schema in the catalog upgrade. | Same v4 migration ensures login_attempts and its expiration index; legacy bootstrap reuses that schema definition. Startup requires the complete migration ledger and required structures. | Standalone integration fixture removes the table first, then verifies the rate-limit guard works after migration. |

All confirmed findings in this table are fixed in source. The review does not
claim that every possible defect has been discovered.

## Architecture and scope decisions

Feature controllers delegate to services. Shared catalog orchestration avoids
copying validation and promotion policy; SQL and transaction boundaries remain
in persistence. Read mapping and season reconciliation have focused helpers.
Small cohesive types/errors/constants remain together; splitting each tiny type
or introducing generic base repositories would add navigation and abstraction
without solving a demonstrated problem.

Existing manual validators, typed DTOs, libSQL repositories, and node:test/Supertest
remain. The imported guide recommends class-validator, TypeORM, Jest, and Nest
TestingModule; these are stack differences, not defects by themselves. No new ORM,
Redis cache, event bus, or microservice infrastructure was introduced. Constructor
injection, JWT guards, revocation, parameterized SQL, bounded pagination, provider
timeouts/response limits, explicit serialization, graceful shutdown, and local
migration rollback tests are already present.

Library/wishlist reads retain the existing public-access policy. The previously
documented migration of legacy isSeries=true records to /series remains a frontend
rollout consideration. Shared movie_length metadata and the movie subtype scaffold
remain for source compatibility; a distinct episode-runtime product requirement
can drive that model change separately.

## Verification

- `npm run typecheck`: passed.
- `npm run lint:check`: passed.
- `npm run build`: passed.
- `npm run test`: 49 tests passed, including real Nest HTTP/JWT behavior.
- `python3 database-v3/test_schema.py`: six standalone SQL tests passed.
- Tests use disposable local databases and a temporary localhost HTTP server.
- No live database, application credentials, external provider API, or deployment
  was used or modified.

The backend requires the text ledger entries catalog-v3 and
catalog-v4-provider-index. Run `npm run migrate` during the documented upgrade
before production startup with DATABASE_AUTO_MIGRATE=false. The v4 step adds
indexes/auth support only; it does not rewrite title metadata or existing option IDs.


## Ownership and feature folders

- `src/modules/series/`: series controller, service, and feature module.
- `src/modules/wishlist/`: wishlist controller/service/module, promotion request
  parsing, and promotion readiness policy.
- `src/shared/titles/`: shared title orchestration, models/errors, catalog option
  identities, provider-ID parsing, and title-input validation. TitlesModule
  registers/exports the providers once for both feature modules.
- `src/database/titles/`: title repository, batched relation reader, season writes,
  membership table names, and provider/genre persistence.
- `src/database/movies/`: movie-specific write SQL.
- `src/common/`: reusable descriptive metadata types/validation, date/year parsing,
  bounded query parsing and pagination types, and primitive validation helpers.

The former `src/modules/catalog/` folder is removed. Shared title code has no
imports from feature modules. Wishlist policy deliberately reuses the legacy movie
validator to enforce the movie API contract during promotion; it remains outside
shared orchestration. Only transport input parsing and policies move; the promotion
callback still runs inside the repository's atomic transaction. Existing routes,
DTO response shapes, and schema version remain unchanged by this reorganization.
