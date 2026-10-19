# A workspace package's TypeScript goes unchecked through node_modules

Read when: adding a TypeScript workspace package under `packages/`, or a type error in one does not fail `pnpm typecheck`.
Status: verified
Scope: desktop typecheck (`apps/desktop`, `tsc -b`)
Verified: 2026-10-19
Source: the settings schema change that added `packages/settings` (unit B1 of the agent-friendly program)
Recheck when: the TypeScript version, `moduleResolution`, or the desktop `tsconfig.app.json` include list changes

The desktop client imports `@kino/settings` through pnpm's `node_modules` symlink to `packages/settings/src/schema.ts`. With only `src` in `tsconfig.app.json`'s include, `pnpm typecheck` passed with a choice default outside its choices and with a ranged TV setting missing its own domain, both of which the schema's types reject. Adding `../../packages/settings/src` to the include made both fail with TS2345 and TS2322. A new TypeScript package the client imports needs the same entry, and a deliberate type error is the quick way to confirm it is checked.
