# Backend remediation plan

Implement in small, independently verified batches. Preserve existing working-tree changes and the public API's legacy IDs and zero-based pagination.

1. **Data integrity and immediate runtime defects** (first batch)
   - Preserve quality/extension options during legacy migration, rolling back on invalid legacy data.
   - Seed missing catalogs independently inside a write transaction.
   - Enforce unique movie kpId; fail safely on existing duplicates without deleting records.
   - Translate create/update uniqueness violations to HTTP 409.
   - Validate pagination/filter input, bound page size, and use safe sort lookup and stable ordering.
   - Fix JWT principal shape and nullable movie contracts; enable strict TypeScript.
   - Add repeatable isolated regression tests.
2. **Request validation and authentication**
   - Validate login, movie, and settings bodies with runtime schemas/pipes; reject unknown fields and invalid nested data.
   - Validate dates, URLs, numbers, arrays and catalog membership with documented compatibility rules.
   - Add login rate limiting appropriate to deployment topology.
   - Introduce stable subject claims and choose a documented token lifetime/revocation policy.
3. **Persistence and concurrency**
   - Extract focused repositories and share movie serialization with the importer.
   - Use mutation RETURNING and transactional reads; introduce optimistic locking where needed.
   - Validate stored JSON and imported records; parameterize imports and make repairs/resets explicit.
   - Introduce versioned deployment migrations and resumable or atomic imports.
4. **Search and scaling**
   - Define Unicode-normalized search and literal wildcard behavior.
   - Benchmark representative datasets before adding full-text search, normalized relationship tables, or cursor pagination.
5. **Operations and maintenance**
   - Validate environment configuration, parameterize port/CORS, and close clients on shutdown.
   - Remove dead code, document setup/import/recovery, and add CI for typecheck, lint, tests, and build.

## First batch status

Implemented: transactional legacy catalog preservation and rollback; independent seeding under a write lock; unique kpId index and HTTP 409 mapping; bounded runtime query validation; snapshot count/list reads and stable ordering; atomic update/delete responses; boolean settings defaults; typed JWT principal compatible with existing tokens; strict TypeScript and nullable contracts. Regression tests cover these behaviors.

Remaining: complete body validation, login throttling and token revocation, repository/import refactoring, Unicode search, deployment migrations, and operational configuration. These remain the next planned batches; first-batch completion does not resolve the full review.

## Validation and rollout

Use temporary or in-memory databases only for verification. Test migration preservation/rollback, independent seeding, concurrent uniqueness, update conflicts, malformed public queries and JWT principal shape. Run strict typecheck, non-mutating lint, tests and build after each batch. Before production rollout, inspect duplicate kpIds and resolve them manually; do not automatically discard movies. No production database changes are part of local implementation.
