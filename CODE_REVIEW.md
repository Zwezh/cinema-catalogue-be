# Backend code review — 1 October 2026

Scope: current working tree, including pre-existing uncommitted remediation. No production database or credentials were accessed. Existing 22 regressions passed outside the sandbox; the sandbox denies loopback binding for the HTTP test.

| Priority | Problem and evidence | Solution options | Selected fix / verification |
| --- | --- | --- | --- |
| High | `query-validation.ts` and `movies.repository.ts` ignore frontend `quality` and `ageRating` parameters. Users receive unfiltered results. | Implement bounded repeated/comma-separated filters; alternatively remove the frontend controls. | Implement exact SQL `IN` matching, parameterized values, input validation, and combined-filter regression. |
| Medium | Year lower/upper bounds use separate `EXISTS` predicates. `[1990, 2030]` matches 2000–2020 although neither listed year matches. | Match one stored release year inside the range; alternatively explicitly define arrays as continuous intervals. | One `EXISTS ... BETWEEN`, preserving the stored release-year contract. |
| Medium | Comma-separated genres retain surrounding whitespace and query arrays are accepted as an object. | Normalize filter inputs and reject malformed root values. | Trim and deduplicate bounded filter lists; reject root arrays. |
| High | JWT validation checks signature and credentials but accepts signed tokens without `exp`; documented expiry is not enforced for that claim shape. | Require expiry; optionally add issuer/audience for a future multi-service deployment. | Require a future safe-integer expiry in the strategy; regressions cover omitted/expired claims. |
| Medium | `Date.parse` accepts `24:00:00` by rolling over to the next day, violating the stated timestamp contract. | Validate clock fields explicitly; alternatively canonicalize timestamps in an API contract change. | Bound hours/minutes/seconds in the existing ISO parser; regression for rollover time. |
| Medium | Database configuration validates only a URL prefix; empty hosts and embedded credentials pass. Remote production accepts whitespace-only tokens. | Parse supported URLs and validate token shape. | Parse URLs, require file paths/remote hosts, reject embedded credentials, blank production tokens and misspelled NODE_ENV values that would disable production safeguards. |
| Medium | Database client is opened before schema verification; initialization failure does not close it. | Close on initialization failure or wrap bootstrap resource ownership. | Close and rethrow from the service lifecycle hook; client-closure regression. |
| Medium | Legacy catalogs use exact duplicate matching, unlike API validation which ignores case/whitespace. Migrated catalogs can be uneditable. | Reject ambiguous legacy values without modifying data; alternatively require explicit mapping before migration. | Apply the same normalized uniqueness check and test migration preservation on failure. |
| Medium | Production schema verification checks only `MAX(version)`. Missing earlier migration records pass. | Verify a contiguous ledger; alternatively verify the entire schema fingerprint. | Require the full ordered migration ledger; regression for missing version 1. |
| Medium | Stored scalar movie fields are coerced without domain validation; `is_series=2` becomes `true` and rating 20 is returned. | Validate decoded records using shared domain validation; alternatively add versioned SQL constraints. | Validate boolean representation and decoded movie fields using the existing parser; corrupt-row regressions. |
| Low | Creates return the input object while updates return the database row. Defaults/triggers can produce inconsistent mutation responses. | Use `INSERT ... RETURNING *`; alternatively reread, which introduces a race. | Return the inserted database record through shared decoding. |
| Low | Auth controller dependency is mutable and JWT factory is unnecessarily async. | Mark dependency readonly and use a synchronous factory. | Small direct cleanup. Existing repositories already provide focused persistence responsibilities; extra generic abstractions would add unnecessary complexity. |
| High | Nest 10, bcrypt 5, ESLint 8, and other installed packages are outdated. Major updates change runtime/tooling contracts. | Upgrade together and validate migration; alternatively defer majors with documented support risks. | Upgrade Nest/Express, libSQL, bcrypt and tooling, regenerate lockfile, migrate ESLint to flat config, update Node requirement and CI matrix. |

The repository already addresses SQL parameterization, bounded pagination, stable ordering, duplicate kpId races, protected writes, credential rotation, shared login throttling, validated imports, migration rollback, and transactional settings. These were verified rather than reported as new defects.

## Dependency compatibility

Registry versions are checked during this review. TypeScript stays on the newest compatible 6.0 patch because the current TypeScript ESLint parser declares `<6.1.0`; TypeScript 7 is outside that supported range. Node typings follow the Node 24 runtime rather than advertising Node 26 APIs on Node 24. Exact installed versions are recorded in `package-lock.json` and `DEPENDENCY_UPGRADE.md`.

Nest 12 can be consumed by CommonJS on supported Node releases. Preserve the current module format and use NodeNext module resolution for ESM package declarations. Consult the [official Nest migration guide](https://docs.nestjs.com/migration-guide) for runtime floors and ESM interoperability.

## Conditional architecture work

Full-text search, relational actor/genre tables, cursor pagination, resumable imports, and optimistic concurrency remain workload/API decisions. No measured performance defect justifies changing these contracts in this review. Full-document edits continue to use last-write-wins. Documenting this limitation is appropriate; silently changing the frontend/API contract is not.

## Verification outcome

All 26 regression tests, strict typecheck, lint and build pass with the upgraded dependency tree. Compiled-entry startup, CORS and graceful shutdown pass with a temporary database. Full npm audit reports zero vulnerabilities. Local runtime: Node 24.21.0. Hosted Node 22/24 CI has been configured, not run here.
