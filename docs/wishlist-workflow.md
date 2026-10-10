# Wishlist provider workflow

Wishlist stores normalized Movie/Series titles with membership separate from metadata. Provider credentials and Poiskkino requests remain backend-only. Release with the matching frontend; generic Wishlist POST/PUT and date-only promotion routes are removed.

| API route | Request | Result |
| --- | --- | --- |
| POST /api/wishlist/from-kinopoisk | {"kpId":"915196"} | 201 {"id":"internal-title-id"} |
| GET /api/wishlist/:id | Internal title ID | 200 normalized Title |
| POST /api/wishlist/:id/refresh | {"kpId":"915196"} | 200 updated normalized Title |
| DELETE /api/wishlist/:id | Internal title ID | 200 removed title |

All writes require an administrator JWT; reads are public. Input provider IDs are canonical positive safe decimal integers. Request objects reject unsupported fields. The refresh URL identifies the existing database title; the submitted provider ID must match it. Unknown provider kind or unusable provider metadata fails with sanitized 502. Other provider failures retain existing 404/502/503/504 handling.

Creation obtains TitleAutofill through KinopoiskService, including separate season loading. The backend maps directors to director and assigns the UTC server date. Imported formats are empty; seasons start unavailable, with nullable release years. Provider data never establishes local file availability.

Refresh replaces provider-owned metadata, including nullable/empty fields. It preserves title ID, provider identity, Wishlist addedDate, local formats and season availability. Seasons merge by seasonNumber: retained seasons keep local fields and internal IDs, new seasons start unavailable, and previously stored seasons omitted by the provider remain. Kind changes return 409. Mutation responses and Wishlist detail reads use the primary database.

## Add to library

The frontend opens the normal Movie or Series new-item editor with wishlistId in the URL. The editor loads the Wishlist by internal ID; reload works. Save posts normal validated editor fields to /api/movies or /api/series, with optional wishlistId. Response types remain legacy Movie DTO or normalized Series DTO respectively.

Every library create, including manual saves without wishlistId, resolves canonical kpId inside the primary write transaction. One Wishlist-only match of the same kind reuses its title ID, saves library fields, inserts library membership and removes Wishlist membership. A supplied wishlistId must identify that exact source. Missing source returns 404; changed kind/identity, multiple historical matches or existing library membership returns 409. With no match and no explicit source, create normally. Validation or SQL failure rolls back metadata, formats, seasons and both memberships. The frontend never performs a follow-up Wishlist delete.

Provider calls happen outside write locks. Refresh captures a primary title/revision snapshot, fetches metadata, then rechecks revision, identity, kind and Wishlist-only membership inside a short write transaction. Stale results return 409; deletion/transfer cannot be undone by a late refresh. Existing bounded transaction retries repeat the complete rolled-back database unit, without repeating network calls.

## Database deployment

The additive catalog-v8-wishlist-refresh migration adds title_metadata_revisions with a cascading title foreign key and title_metadata_updated, an AFTER UPDATE trigger on titles. Missing rows represent revision zero. The trigger covers normalized and legacy metadata writers. Existing canonical provider indexes and season reconciliation are reused; no historical duplicates are deleted and no global uniqueness constraint is added blindly.

After database-owner approval, back up the configured database and run npm run migrate using the deployment configuration before starting the new backend. Production startup with DATABASE_AUTO_MIGRATE=false rejects an incomplete ledger. Updating source/building does not apply a live migration or restart a running API. This implementation has been tested with temporary local databases only.

Tests cover provider mapping, season/local-field preservation, canonical aliases, malformed input, rollback, manual Movie/Series transfers, source-ID mismatches, overlapping refreshes, delete/transfer races and authenticated HTTP contracts. Provider requests in tests are mocked.
