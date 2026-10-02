# Backend development guidance

This is the NestJS backend project. Use constructor injection for NestJS providers.
Angular component-specific instructions belong to the frontend project.

For NestJS implementation, refactoring, and code review:

1. Read [the project NestJS instructions](.github/instructions/nestjs.instructions.md).
2. Read [nestjs-best-practices](.agents/skills/nestjs-best-practices/SKILL.md)
   and the relevant files in its `rules/` directory. The complete 40-rule skill is
   vendored here; its upstream documentation is linked from SKILL.md.
3. Apply feature modules, focused services, persistence repositories, thin
   controllers, validated DTOs/pipes, transactions, and tests appropriate to changes.
4. Put each controller in its own `<feature>.controller.ts` file. Multiple
   controllers per module are allowed; shared persistence may be exported from a
   shared titles module under `src/shared/titles/`. Keep feature policies in their
   owning feature and SQL helpers under `src/database/`.
5. Keep credentials and database tokens out of logs, source, and review reports.

The current stack is NestJS, TypeScript strict mode, SQLite/Turso through
`@libsql/client`, and node:test/Supertest. The imported instructions also recommend
TypeORM, Jest, class-validator, and Nest TestingModule. Report these implementation
mismatches explicitly in reviews; a code-review request by itself does not authorize
replacing the application's database driver or testing stack.

Run `npm run typecheck`, `npm run lint:check`, `npm run build`, and relevant tests
for implementation changes. Database tests must use isolated local fixtures.
Changing source does not imply permission to migrate or modify a live database.
