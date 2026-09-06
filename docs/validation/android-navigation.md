# Shield navigation measurements

Issue #138 was reproduced on the development Shield at 59.94 Hz, with a 1920 × 1080 app buffer on its 3840 × 2160 display. The frame budget is 16.68 ms. Device animation settings and the enabled Button Mapper accessibility service were left unchanged.

## Cause and controlled comparisons

After artwork loaded, the original development APK still missed 21 of 44 frame deadlines in a 14-key navigation burst. Its 90th-percentile frame time was 56.3 ms; main-thread work was 19.4 ms at the 90th percentile. GPU time was about 2 ms. This rules out waiting for an add-on or GPU throughput as the cause of that warm navigation stall.

A sampled main-thread trace showed Compose accessibility semantics traversal, bounds sorting, and allocations during focus changes. Kino's lazy lists already use stable media keys. Core coalesces updates for 40 ms and publishes a StateFlow value only when the converted state changes. The warm trace reproduced without fresh catalog responses. Disabling poster enlargement did not fix the frame-time tail.

Three warm repeats used the same Home content and 14-key sequence: three right, three left, down, three right, three left, up. Frame times below are `FrameCompleted - IntendedVsync` from `dumpsys gfxinfo ... framestats`, ignoring flagged frames and duplicate timestamps.

| Build                       | Compose | 90th-percentile frame time, three repeats |
| --------------------------- | ------- | ----------------------------------------- |
| Debuggable, R8 enabled      | 1.10.6  | 53.3 / 67.6 / 53.4 ms                     |
| Non-debuggable, R8 enabled  | 1.10.6  | 25.0 / 21.9 / 26.7 ms                     |
| Non-debuggable, R8 enabled  | 1.9.2   | 34.0 / 28.5 / 32.6 ms                     |
| Non-debuggable, R8 disabled | 1.10.6  | 42.6 / 38.5 / 39.2 ms                     |

The strongest controlled effect is the debuggable flag. R8 and the newer Compose runtime also reduce the tail. This comparison does not isolate ART, runtime inspection, and compiler instrumentation from one another. Android's [Compose performance guidance](https://developer.android.com/develop/ui/compose/performance) recommends measuring a non-debuggable R8 build for the same reason.

## Repeating the device gate

`pnpm android:check "$ANDROID_SERIAL"` runs `NavigationPerformanceTest` along with the real Core and player gates. The navigation gate uses the production Home, Search, Library, series, source, and drawer components. Synthetic artwork passes through Coil's decoder after a controlled delay. Repeated key-down events exercise held input, and focus assertions check the resulting selection.

The gate records Android `FrameMetrics.TOTAL_DURATION` and counts frames exceeding one refresh interval. On the Shield's Android 11, that duration includes the delay from intended vsync through frame completion, as defined by [AOSP's FrameMetrics implementation](https://android.googlesource.com/platform/frameworks/base/+/refs/tags/android-11.0.0_r48/core/java/android/view/FrameMetrics.java). It rejects a 90th-percentile duration of two refresh intervals or more. It excludes the window's first draw, but does not discard slow scrolling frames.

The benchmark APK keeps public APIs used by the separate instrumentation APK. The distributed APK can remove those unused APIs. Live-account measurements use the distributed APK; the synthetic gate verifies focus and timing without depending on an add-on's response time.

## Final component gate

The complete Shield suite passed all 40 checks. The navigation run below kept Button Mapper enabled and exercised held horizontal and vertical input, Home, Search, Library, the drawer, episodes, and sources. Poster focus settles in 140 ms; the drawer and page fade take 160 ms. A separate disabled-motion check observes settled poster and drawer bounds within two frames. It also checks Back from an expanded drawer when Home is loading or empty, including delivery of a second Back to its parent.

| Component                                  | Frames | 90th-percentile duration | Frames over 16.68 ms |
| ------------------------------------------ | -----: | -----------------------: | -------------------: |
| Home, including artwork loading            |    406 |                 14.22 ms |                   16 |
| Search                                     |     91 |                 13.46 ms |                    1 |
| Library, first scroll with artwork loading |     44 |                 28.60 ms |                   19 |
| Library, loaded artwork                    |    153 |                 25.02 ms |                   38 |
| Episodes                                   |     90 |                 11.91 ms |                    0 |
| Sources                                    |     90 |                 12.38 ms |                    0 |

Library's initial scroll originally exceeded 50 ms at the 90th percentile in the optimized benchmark. It now uses cached rows with the same poster columns and spacing, and poster accessibility descriptions include the title and caption once. The component gate preserves selected media through repeated row changes. These changes brought that first-scroll result to 28.60 ms. Library still misses some individual refresh deadlines; the measurements establish the reduced stall, not a guarantee that every frame finishes within one refresh interval.

## Distributed APK

The final distributed APK was also checked against the saved account. Movie details receives focus immediately, and one Back restores the same Library poster at exactly the same bounds. This caught a movie-entry focus defect that the series gate did not cover; `SeasonNavigationTest` now gates that case too.

The original unpaced 14-key shell burst sends every key without a pause. In the final APK, three warm repeats measured 37.0 / 35.8 / 37.7 ms at the 90th percentile, down from the original debug baseline of 56.3 ms. The shorter focus animation also produces fewer frames per burst, so the sample counts differ from the original build comparisons.

A second measurement spaces the same 14 keys by 80 ms in one shell process, matching the repeated-input component gate. Its three warm repeats were 16.6 / 16.2 / 17.1 ms at the 90th percentile. Respectively, 9 of 87, 8 of 90, and 10 of 89 frames exceeded 16.68 ms. The first sequence after launch was slower at 48.3 ms, with 53 of 81 frames over budget; the next two were 20.5 and 24.8 ms before reaching the warm results. Cold startup work and occasional browsing deadlines remain visible in these measurements.
