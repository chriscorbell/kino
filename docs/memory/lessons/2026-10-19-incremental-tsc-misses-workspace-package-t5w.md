# An incremental tsc -b misses a change only in a workspace package

Read when: adding a TypeScript workspace package under `packages/` that the desktop client imports, or `pnpm typecheck` passes locally on a break CI reports.
Status: verified
Scope: desktop typecheck (`apps/desktop`, `tsc -b`, TypeScript 6.0.3)
Verified: 2026-10-19
Source: PR #304
Recheck when: the TypeScript version, or the desktop `tsconfig.app.json` include list, changes

The desktop client imports `@kino/settings` from `packages/settings/src/schema.ts`. With only `src` in `tsconfig.app.json`'s include, a clean `tsc -b`, which is what CI runs, does report a type error in the schema. An incremental local `tsc -b` does not: it judges the project's freshness from its root files, finds them unchanged, reports the project up to date, and exits 0 while the schema is broken. Listing `../../packages/settings/src` in the include makes the schema a root file, so an incremental build rechecks it and fails. A new TypeScript package the client imports needs the same entry; to confirm, break it after a passing build and run `pnpm typecheck` again.
