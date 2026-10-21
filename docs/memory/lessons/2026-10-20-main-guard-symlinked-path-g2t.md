# A script's main guard does nothing through a symlinked path

Read when: a script under `scripts/` exits 0 with no output, a check passes from `/tmp` or another linked directory, or you add an "only when run directly" guard to a script.
Status: verified
Scope: Node scripts under `scripts/` that also export functions
Verified: 2026-10-21
Source: kardboard card 4u9x5uvmpmnzsy, found on #316; `scripts/linux-notices.mjs`; a Node 24.21.0 run on mbp, 2026-10-21
Recheck when: card 4u9x5uvmpmnzsy is done, or a script adds or changes its main guard.

Node gives `process.argv[1]` the path as typed, made absolute, while `import.meta.filename` and `import.meta.url` carry the real path with links resolved. A guard such as `if (process.argv[1] === import.meta.filename)` is false when the script is reached through a link, and on macOS `/tmp` links to `/private/tmp`. The script then skips its main block and exits 0 with no output, a check that passes without running. On 2026-10-21, `node /tmp/<link to the checkout>/scripts/linux-notices.mjs check` printed nothing and exited 0, while the real path printed "Reviewed Linux notices match the Flatpak manifest." On `main` at 88220ea the same guard is in `linux-notices.mjs`, `windows-notices.mjs`, `android-notices.mjs` and `review-qt-notices.mjs`; `test-support/loudness-reference.mjs` and `test-support/track-fixtures.mjs` compare unresolved paths the same way, by reading of their code. `pnpm notices:check` imports these functions, so it is not affected; direct runs such as the Flatpak workflow's `node scripts/linux-notices.mjs generate` are. Until the card lands, run these scripts from the real checkout path, and compare real paths (`realpathSync(process.argv[1])`) in any new guard.
