# Dependency upgrade — 1 October 2026

| Package | Previous installed | Updated installed |
| --- | --- | --- |
| `@libsql/client` | 0.15.15 | 0.18.0 |
| `@nestjs/common` | 10.3.3 | 12.1.2 |
| `@nestjs/config` | 3.2.0 | 12.0.1 |
| `@nestjs/core` | 10.3.3 | 12.1.2 |
| `@nestjs/jwt` | 10.2.0 | 12.0.2 |
| `@nestjs/passport` | 10.0.3 | 12.0.0 |
| `@nestjs/platform-express` | 10.3.3 | 12.1.2 |
| `bcrypt` | 5.1.1 | 6.0.0 |
| `passport` | 0.7.0 | 0.7.0 |
| `passport-jwt` | 4.0.1 | 4.0.1 |
| `reflect-metadata` | 0.2.1 | 0.2.2 |
| `rxjs` | 7.8.1 | 7.8.2 |
| `@nestjs/cli` | 10.3.2 | 12.0.8 |
| `@nestjs/schematics` | 10.1.1 | 12.0.6 |
| `@types/bcrypt` | 5.0.2 | 6.0.0 |
| `@types/express` | 4.17.21 | 5.0.6 |
| `@types/node` | 20.11.24 | 24.19.0 |
| `@types/passport-jwt` | 4.0.1 | 4.0.1 |
| `@types/supertest` | 6.0.2 | 7.2.1 |
| `@typescript-eslint/eslint-plugin` | 6.21.0 | 8.71.0 |
| `@typescript-eslint/parser` | 6.21.0 | 8.71.0 |
| `eslint` | 8.57.0 | 10.11.0 |
| `eslint-config-prettier` | 9.1.0 | 10.1.8 |
| `eslint-plugin-prettier` | 5.1.3 | 5.5.6 |
| `prettier` | 3.2.5 | 3.9.9 |
| `source-map-support` | 0.5.21 | 0.5.21 |
| `supertest` | 6.3.4 | 7.3.0 |
| `ts-loader` | 9.5.1 | 9.6.2 |
| `ts-node` | 10.9.2 | 10.9.2 |
| `tsconfig-paths` | 4.2.0 | 4.2.0 |
| `typescript` | 5.3.3 | 6.0.3 |

All direct packages use current registry releases, with two deliberate compatibility constraints: TypeScript 6.0.3 instead of 7.0.2 (TypeScript ESLint parser supports `<6.1.0`) and Node 24 typings matching the locally tested runtime instead of Node 26 typings. No prerelease packages or forced peer dependency resolutions are used.

Nest packages now share major 12. CommonJS is preserved with NodeNext module resolution; TypeScript 6 requires an explicit `rootDir` in the build config so `start:prod` still launches `dist/main.js`. ESLint 10 uses `eslint.config.cjs` rather than the removed legacy config. Scripts include import tooling in lint/format checks. CI checks Node 22 and 24 and uses the current [checkout v7](https://github.com/actions/checkout/releases/tag/v7.0.1) and [setup-node v7](https://github.com/actions/setup-node/releases/tag/v7.0.0) actions.

Runtime/tooling require Node 22.22.3+, 24.15+, or 26+. Node 24 LTS is recommended; local verification ran on Node 24.21.0. The hosted CI matrix has been configured but not executed from this chat.

The compatible transitive `diff` patch was refreshed with `npm audit fix`, without `--force`. The resulting full dependency audit reports **0 vulnerabilities**.

Verification: strict typecheck, non-mutating lint, 26 regressions including HTTP integration, production build, and compiled-entry startup/CORS/graceful shutdown using temporary databases. Production data and credentials were not used.

Migration reference: [official NestJS migration guide](https://docs.nestjs.com/migration-guide).
