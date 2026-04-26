# Changelog

All notable changes to `@zakkster/lite-vram`.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

---

## [1.1.0] — "Hysteresis"

Bug-fix release driven by analysis of 38 real-device diagnostic reports.

> The fixes are backwards-compatible. Existing code that constructs
> `VramManager` without explicit watermarks will pick up the new defaults
> automatically — and that is the whole point. The defaults were the bug.

### Fixed

- **VramManager hysteresis collapse on HIGH tier (B1).** In v1.0.x, fast
  devices crossed both `highWatermark` (0.90) and `panicWatermark` (0.95)
  inside a single 2000ms tick, so `onPressure` and `onPanic` fired
  together. Diagnostic reports showed `pressure.events == pressure.panics`
  in 18 of 22 HIGH-tier sessions, obscuring the difference between
  graceful pressure response and runaway overshoot. **Fix:** widen the
  per-tier high→panic gap to ≥ 11 percentage points, halve the check
  interval on HIGH/ULTRA, and separate the callbacks at their source —
  `onPressure` now fires only on the OK→HIGH transition, never as a
  side-effect of panic.

- **SafariStressTest blind to spike patterns (B2).** Single-iteration
  detection misclassified GC pauses and tab-switches as Safari throttles.
  Three reports (#13 5.1×, #14 5.7×, #27 25.7×) had peak/baseline ratios
  that should have flagged throttling but reported `throttleDetected:
  false`. **Fix:** rolling-window detection (3-of-last-5 samples must
  exceed threshold), `visibilitychange` listener with 500ms cool-down,
  per-iteration `classification` field (`'normal' | 'gc-pause' |
  'throttle' | 'ignored'`), and a decode-time histogram (p50/p75/p90/p95/p99)
  on the result.

- **iPad iOS-version detection on Mac-spoofed UA (B3).** iPadOS 13+
  spoofs its User-Agent as `Macintosh`, so the `CPU OS X_X like Mac OS X`
  regex returned 0 and the tier reason became `"iOS ?"`. Classification
  still landed correctly (LOW for older iPads) but for the wrong reason.
  **Fix:** when the iOS-token match fails on a confirmed iPadOS device,
  parse the iOS major version from the Safari `Version/X` token, which
  Apple aligns with iPadOS major versions.

### Added

- **`watermarks.js` module.** Per-tier hysteresis configuration cleanly
  separated from cache budgets. New exports: `WATERMARKS` (frozen
  per-tier table), `getWatermarksForTier(tier)` (mutation-safe accessor).

- **`VramManager` watermark validation.** Constructor now throws if
  `low < high < panic` is violated, catching misconfigurations like
  `high: 0.95, panic: 0.90` that would have silently caused permanent
  panic mode in v1.0.x.

- **`StressTestResult.histogram`** with p50/p75/p90/p95/p99 percentiles
  over steady-state samples (excludes warm-up, GC-pauses, and ignored
  visibility-resume samples).

- **`StressTestResult.gcPauseCount`** — single-iteration spikes that
  did not persist long enough to trigger the throttle stop.

- **`StressTestResult.visibilityPauseCount`** — number of times the
  tab went hidden during the test.

- **`StressIteration.classification`** — per-sample tag distinguishing
  normal samples from GC pauses, throttles, and visibility-ignored
  windows.

- **New stress-test options:** `slowWindow` (default 5),
  `slowThreshold` (default 3), `visibilityResumeMs` (default 500).

### Changed

- **`VramManager` defaults:** `highWatermark: 0.85` (was 0.90),
  `lowWatermark: 0.70` (was 0.75), `panicWatermark: 0.96` (was 0.95),
  `checkIntervalMs: 1000` (was 2000).

- **`onPressure` semantics:** now fires only on the OK→HIGH-PRESSURE
  transition. Code that counted `onPressure` calls expecting one per
  panic event will see lower numbers. Code that wants per-tick panic
  notification should use `onPanic`.

### Migration from v1.0.x

No code changes are required for the typical setup:

```js
// v1.0.x — still works in v1.1, picks up new defaults
const manager = new VramManager(cache, { registry });
manager.start();
```

If you were relying on the old hysteresis values, opt back in explicitly:

```js
const manager = new VramManager(cache, {
    registry,
    highWatermark:   0.90,    // v1.0.x value
    lowWatermark:    0.75,    // v1.0.x value
    panicWatermark:  0.95,    // v1.0.x value
    checkIntervalMs: 2000     // v1.0.x value
});
```

If you were counting `onPressure` calls as a proxy for panic events,
switch to `onPanic`:

```js
// v1.0.x pattern (broken)
let panicCount = 0;
new VramManager(cache, { registry, onPressure: () => panicCount++ });

// v1.1 pattern (correct)
let panicCount = 0;
new VramManager(cache, { registry, onPanic: () => panicCount++ });
```

---

## [1.0.6] — Last v1.0.x patch

Minor diagnostic dashboard refinements. No library API changes.

## [1.0.5]

- Improved iOS version detection (`iOSVersion >= 17` gating)
- Two-core-desktop fallback rule (Rule 6) added to handle older
  MacBooks reporting 8GB RAM via Chrome's `deviceMemory`.

## [1.0.0]

Initial release. 7-rule device tier detection, category-priority
eviction (TEMP→FX→BG→CHAR→UI), `VramManager` requires
`CategoryRegistry`, ES2015 `catch (e)` binding for iOS 12 compatibility,
diagnostic dashboard with decode-timing panel and exportable JSON
reports.

[1.1.0]: https://github.com/PeshoVurtoleta/lite-vram/releases/tag/v1.1.0
[1.0.6]: https://github.com/PeshoVurtoleta/lite-vram/releases/tag/v1.0.6
[1.0.5]: https://github.com/PeshoVurtoleta/lite-vram/releases/tag/v1.0.5
[1.0.0]: https://github.com/PeshoVurtoleta/lite-vram/releases/tag/v1.0.0
