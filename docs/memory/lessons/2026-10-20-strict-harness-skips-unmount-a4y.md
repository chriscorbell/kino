# A test harness can silently skip the case it exists for

Read when: a test mounts the player view with `strict: true`, or any harness option is supposed to exercise a case such as a remount, a retry, or a failure.
Status: verified
Scope: desktop vitest harnesses under `apps/desktop/src/test/`
Verified: 2026-10-21
Source: #317; `mountPlayback` in `apps/desktop/src/test/playback.tsx`; `apps/desktop/src/screens/PlayerScreen.shutdown.test.tsx`
Recheck when: React is upgraded, or `mountPlayback` changes how it applies StrictMode.

The strict shutdown tests existed to prove that StrictMode's practice unmount ran no save and no Unload. Their harness put StrictMode inside the settings provider, and #317 reports that React 19.2 then ran each effect once on first mount, so those tests never saw a practice unmount and passed whatever unmount did. #317 passes `reactStrictMode` to the render instead, so StrictMode wraps the whole tree as in `main.tsx`, and it checked the fix by planting a view effect that leaves playback on unmount and seeing the strict suite fail. A harness option is a claim like any other: assert that the harness exercised the case, or plant the defect the case guards and see the test fail. The test "sends one Load and saves nothing while StrictMode mounts the view twice" still asserts only the outcome, not that the second mount happened. Checked on 2026-10-21 against #317 and the current harness and test.
