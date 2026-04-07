# VRAM Diagnostics Dashboard

[![Part of VRAM Playbook](https://img.shields.io/badge/VRAM_Playbook-v1.0.0-blue?style=for-the-badge)](https://www.npmjs.com/package/@zakkster/lite-vram)
[![Engine](https://img.shields.io/badge/Engine-@zakkster/lite--vram-cyan?style=for-the-badge)](https://www.npmjs.com/package/@zakkster/lite-vram)
![Zero Dependencies](https://img.shields.io/badge/Dependencies-0-green?style=for-the-badge)
![Safari Tested](https://img.shields.io/badge/Safari-Tested-orange?style=for-the-badge)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](https://opensource.org/licenses/MIT)

The command center for VRAM management. Real-time telemetry, Safari throttle detection, visual texture grid, and exportable device reports — the same tooling used to build every matrix and preset in the Playbook.

**The diagnostic dashboard that PixiJS, Phaser, Construct, and Cocos don't have.**

---

## Why This Exists

Studios build this tooling *after* they hit crashes. You get it *before*.

| Capability | This Dashboard | PixiJS DevTools | Phaser Debug | Cocos Profiler |
|---|---|---|---|---|
| **Live VRAM graph** | **Yes (60Hz, DPR-aware)** | No | No | Partial |
| **Safari throttle detection** | **Yes (3× baseline)** | No | No | No |
| **Category-priority eviction view** | **Yes (TEMP→FX→BG→CHAR→UI)** | No | No | No |
| **Per-tier watermark lines** | **Yes (from presets.json)** | No | No | No |
| **Visual texture grid** | **Yes (colored by category)** | No | No | No |
| **Exportable device report** | **Yes (JSON/clipboard/email)** | No | No | No |
| **Tier auto-detection display** | **Yes (GPU + RAM + reason)** | No | No | No |

---

## Quick Start

```bash
# From the examples/ directory
open vram-diagnostics-dashboard/index.html
```

The dashboard auto-detects your device tier and boots with the matching preset. Click **Start** to begin streaming textures into VRAM and watch the system respond in real time.

---

## What You See

### VRAM Allocation Graph

Real-time memory curve with three reference lines:

- **Blue line** — current VRAM allocation (updated every frame, DPR-corrected)
- **Red dashed** — VRAM ceiling (tier budget: 48 / 96 / 192 / 256 MB)
- **Amber dashed** — high watermark (per-tier: 80% on LOW, 90% on HIGH)
- **Green bars** — asset count overlay

The graph uses `setTransform` identity reset before DPR scaling — no cumulative transform bugs on resize.

### Decode Timing Panel

The killer feature for Safari debugging:

| Field | Meaning |
|---|---|
| **Baseline** | Average decode time from first 5 warm-up loads |
| **Last Decode** | Most recent `createImageBitmap` duration |
| **Multiplier** | Last ÷ Baseline — **3× = Safari throttle detected** |
| **Peak** | Highest decode time in session |
| **Status bar** | Green (healthy) → Amber (elevated) → Red (THROTTLE DETECTED) |

When Safari starts throttling decodes (the only warning before a tab crash), this panel turns red.

### Visual Texture Grid

Every texture in VRAM rendered as a colored tile:

| Color | Category | Eviction Priority |
|---|---|---|
| Gray | TEMP | First to die |
| Amber | FX | Second |
| Green | BG | Third |
| Blue | CHAR | Fourth |
| Violet | UI | **Never evicted** |

Watch tiles appear (load), age, and flash red (eviction animation) — a visual proof that category-priority eviction works.

### Metrics Strip

Six real-time cards: VRAM Used, Peak VRAM, Assets, Evictions, FPS, and Pressure state (OK / HIGH / PANIC).

### Device Report (Export)

Click **Export Report** to generate a comprehensive JSON:

```json
{
    "generator": "@zakkster/lite-vram diagnostic",
    "version": "1.0.5",
    "sessionDurationMs": 45200,
    "device": { "gpu": "Apple A14 GPU", "tier": "MID", "ramGB": 4, ... },
    "vram": { "presetMaxMB": "96.00", "peakReachedMB": 82.4, ... },
    "watermarks": { "high": 0.85, "panic": 0.93, "checkIntervalMs": 1000 },
    "decode": { "baselineMs": 3.2, "peakMs": 28.4, "throttleDetected": false },
    "pressure": { "events": 2, "panics": 0, "evictions": { "total": 14, "temp": 8, "fx": 6 } }
}
```

Three export methods: **Copy** (clipboard with fallback), **Download** (JSON file), **Email** (pre-filled mailto).

---

## Per-Tier Watermarks

The dashboard uses tuned watermarks from `presets.json` — not hardcoded values:

| Tier | High Watermark | Panic | Check Interval |
|---|---|---|---|
| SAFE | 75% | 88% | 300ms |
| LOW | 80% | 90% | 500ms |
| MID | 85% | 93% | 1000ms |
| HIGH | 90% | 95% | 2000ms |
| ULTRA | 92% | 96% | 2000ms |

Switch tiers via the dropdown — watermarks, budgets, and graph lines update immediately.

---

## Architecture

```
┌─────────────────────────────────────────────────┐
│  HEADER   [Tier ▾] [Tex ▾] [▶ Start] [Flush]   │
├───────────────────────────────────┬──────────────┤
│  VRAM Graph (Canvas, 60Hz)       │ Tier Card    │
│  ────────────────────────         │ Decode Panel │
│  Metrics Strip (6 cards)          │ Categories   │
├───────────────────────────────────│ Pipeline Log │
│  Visual Texture Grid              │ CTA          │
└───────────────────────────────────┴──────────────┘
```

### Crash-Proof RAF Loop

The render loop is wrapped in `try/catch` with `requestAnimationFrame` placed *after* the catch block. Any exception logs to console and the loop continues. One thrown error never kills the dashboard.

### Visibility API

When the tab goes hidden: `isRunning = false`, `manager.pause()`, FPS counters reset. When it returns: manager resumes, test loop restarts if it was running. No stale data, no decode spikes from background tab throttling.

### Zero Inline Styles

Every visual element uses CSS classes. Graph legend swatches: `.g-sw--blue`, `.g-sw--red`. Category dots: `.cat-dot--temp` through `.cat-dot--ui`. Tier icons: `.tier-icon--low/mid/high`. Tier progress bars: `.tier-fill--low/mid/high`. Decode status: `.decode-status--ok/warn/danger/idle`.

---

## Using Reports to Build Your Matrices

Every JSON report maps directly into the Playbook's data files:

| Report Field | Maps To |
|---|---|
| `device.gpu` + `device.ramGB` + `device.tier` | `device-tier-matrix.json` — new row |
| `vram.peakReachedMB` + `decode.baselineMs` | `safari-crash-matrix.json` — stress test profile |
| `decode.peakMs` + `decode.throttleDetected` | `performance-matrix.json` — decode timing data |
| `pressure.evictions` | `presets.json` — watermark tuning feedback |

Run the dashboard on every device your studio owns. Export reports. Feed them into the matrices. The presets get more accurate with every report.

---

## License

MIT — Part of the [VRAM Playbook](https://github.com/niceworks-studio) by [@zakkster](https://www.npmjs.com/~zakkster)
