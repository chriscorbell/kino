# Match community intros by release version

## Status

Accepted

## Context

[ADR 0004](0004-resolve-intro-markers-from-metadata-and-theintrodb.md) chose strict duration matching for TheIntroDB markers, favoring a missing button over a skip into dialogue. Kino implemented it as an exact match: the video's runtime had to equal, to the millisecond, a runtime in the service's version list.

The service does not work that way. It groups submissions into release versions and lists each with a runtime and the average runtime of its submissions. On 2026-09-26 it listed Breaking Bad's pilot at 3,500,192 ms, averaging 3,495,986 ms over ten submissions. Asked for a runtime, it selects the version up to 60 seconds away and falls back to the most submitted version from 61 seconds; its documentation says it selects "the closest matching release version" and names no window, so the window was measured against the live service. A real file almost never lands on a listed runtime to the millisecond, so community markers almost never reached a viewer. The gates passed because their fixtures used exact runtimes.

## Decision

A community marker is trusted when exactly one listed release version has both its runtime and its average runtime within 60 seconds of the video's runtime. The zero-runtime version, submissions of unknown runtime, never qualifies, and the marker request still excludes those submissions. Two versions within the window are ambiguous and leave the button hidden.

Checking both runtimes keeps Kino inside the service's own window whichever of them it compares, so near the window's edge the service cannot fall back to another release while Kino believes it matched.

## Consequences

A file of the same release as the submissions gets its marker. A different cut, whose runtime differs by minutes, still does not, and neither does a runtime between two close versions.

The fixtures in `pnpm intro:check` and `SkipIntroTest` now take the live service's shape, with runtimes at both edges of the window. `pnpm intro:check-live` runs the production client against the service itself; it needs the network and runs by hand. The window is the service's behavior, not a documented contract, and that check is how a change would show.
