# Refresh authentication

Access JWTs last 15 minutes and are held only in browser memory. Sign-in creates a 30-day refresh session. Its deadline is fixed at sign-in; refreshing does not extend it. The server stores SHA-256 hashes of random 256-bit refresh tokens. Each refresh consumes one token and rotates it transactionally. Reuse revokes the whole session family. Logout and credential replacement invalidate protected access immediately through primary-database session checks.

## Browser contract

All authentication POST requests must include credentials, the exact allowed Origin, and `X-MediaShelf-Request: 1`. Responses use `Cache-Control: no-store`. Refresh tokens are sent only through Set-Cookie and never in JSON.

- `POST /api/auth`: body `{ "secretKey": "..." }`; response `{ "access_token": "..." }`.
- `POST /api/auth/refresh`: empty body; same response shape; missing, expired or reused cookies return 401.
- `POST /api/auth/logout`: empty body; 204 after revocation and cookie removal.

Production uses `__Host-media-shelf-refresh`, HttpOnly, Secure, Path=/, no Domain, and SameSite=Lax. Development uses `media-shelf-refresh` without Secure for local HTTP. Angular serializes refreshes within the page and uses Web Locks across same-origin tabs when available. Browsers without Web Locks may require signing in again after simultaneous cross-tab rotation. Existing localStorage JWTs are removed; users sign in once after upgrading.

## Production routing

The frontend production API URL is `/api`. Configure the HTTPS web host or reverse proxy to forward `/api/*` to this Nest backend, preserving the path, Origin, request cookies and Set-Cookie responses. Disable caching for auth routes. This repository does not provision that proxy. Set backend `NODE_ENV=production`, `REFRESH_COOKIE_SAMESITE=lax`, and `CORS_ORIGINS` to the public frontend origin. Use a strong server-only `JWT_KEY`. Deploy frontend and backend together.

If hosting must keep unrelated frontend/backend origins, restore the absolute frontend API URL, use `REFRESH_COOKIE_SAMESITE=none` on the production HTTPS backend, and allow only the frontend origin. Credentialed CORS is enabled. Third-party cookie restrictions can prevent that arrangement from restoring sessions; same-origin routing is preferred.

## Migration and activation

The additive `catalog-v7-refresh-sessions` migration creates `auth_refresh_tokens` and indexes. Back up the target database and explicitly approve the migration before applying it with `npm run migrate` in the backend. Use `DATABASE_AUTO_MIGRATE=false` in production and restart only after migration succeeds. Tests use temporary isolated databases; implementation verification does not migrate the live database.
