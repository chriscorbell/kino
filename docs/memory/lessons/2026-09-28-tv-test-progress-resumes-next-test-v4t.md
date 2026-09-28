# A TV playback test's progress resumes the next test on that episode

Read when: a Shield playback test that seeks into a segment fails only in a full class or suite run, and passes alone.
Status: verified
Scope: Android TV instrumentation that plays `CoreEpisodeFixture` through `FullscreenPlayer`
Verified: 2026-09-28
Source: `SkipIntroTest` runs on the development Shield on 2026-09-28, while adding the redirect tests in the pull request that keeps community intros through redirects.

Leaving playback records the position as the fixture episode's progress in Core, and the next test that plays the same episode resumes there when the player becomes ready. A new test that left a five-minute file paused at 6 s made `automaticSkipOffersUndoOnceAndUndoSuppressesTheSegment` resume inside the intro, use up its one automatic skip before the test seeked, and fail about half the time in class runs while passing every time alone. Excluding the new tests made the class pass five runs in five; seeking to 0 before leaving made it pass six in six. A test that plays the shared fixture episode should leave it at 0, or at a position the next test's assertions tolerate, and a failure message that reports position, marker and buttons turns this from guesswork into a one-run diagnosis.
