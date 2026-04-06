# @zakkster/lite-vram

[![npm version](https://img.shields.io/npm/v/@zakkster/lite-vram.svg?style=for-the-badge&color=latest)](https://www.npmjs.com/package/@zakkster/lite-vram)
[![npm bundle size](https://img.shields.io/bundlephobia/minzip/@zakkster/lite-vram?style=for-the-badge)](https://bundlephobia.com/result?p=@zakkster/lite-vram)
[![npm downloads](https://img.shields.io/npm/dm/@zakkster/lite-vram?style=for-the-badge&color=blue)](https://www.npmjs.com/package/@zakkster/lite-vram)
[![npm total downloads](https://img.shields.io/npm/dt/@zakkster/lite-vram?style=for-the-badge&color=blue)](https://www.npmjs.com/package/@zakkster/lite-vram)
![TypeScript](https://img.shields.io/badge/TypeScript-Full_Types-informational?style=for-the-badge)
![Safari Tested](https://img.shields.io/badge/Safari-Crash--Free-orange?style=for-the-badge)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](https://opensource.org/licenses/MIT)

Production VRAM management for HTML5 game engines. Device-aware budgets, category-priority eviction, Safari crash prevention, and the data to prove it works on every device.

**The VRAM system that PixiJS, Phaser, Construct, and Cocos don't have.**

**[→ Try the Live Diagnostic Dashboard](./examples/vram-diagnostics-dashboard/)**

## Why lite-vram?

| Feature | lite-vram | PixiJS | Phaser | Construct | Cocos |
|---|---|---|---|---|---|
| **Device tier detection (GPU + RAM + cores)** | **Yes (7 rules)** | No | No | No | No |
| **Per-tier VRAM budgets (32–256 MB)** | **Yes** | No | No | No | No |
| **Category-priority eviction** | **Yes (TEMP→FX→BG→CHAR→UI)** | No | No | No | No |
| **Safari panic mode (95%+)** | **Yes** | No | No | No | No |
| **Tier-aware texture resolution** | **Yes (@0.5x/@0.75x/1.0x)** | No | No | No | No |
| **Decode throttle detection** | **Yes (3× baseline)** | No | No | No | No |
| **Device crash matrices (30+)** | **Yes (JSON)** | No | No | No | No |
| **Live diagnostic dashboard** | **Yes (HTML)** | No | No | No | No |
| **Scene streaming pipeline** | **Yes (safe transitions)** | Manual | Manual | N/A | Manual |
| **TypeScript declarations** | **Yes (9 .d.ts)** | Partial | Partial | No | Partial |
| **Zero dependencies** | **Yes** | No | No | N/A | No |

## Installation

The runtime cache is a free npm package:

```bash
npm install @zakkster/lite-vram
```

The Playbook (this repository) provides the VRAM management layer, presets, matrices, guides, and examples on top of it.

## Quick Start

```javascript
import {
    createCacheAuto, CategoryRegistry, VramManager,
    AssetResolver, loadScene, transitionScenes, VramHUD
} @zakkster/lite-vram.js';

// 1. Boot — auto-detects device, picks correct budget
const { cache, tier } = createCacheAuto();
const registry = new CategoryRegistry();
const resolver = new AssetResolver({ basePath: 'assets' });

// 2. VramManager — prevents Safari crashes
const manager = new VramManager(cache, {
    registry,
    checkIntervalMs: tier.tier === 1 ? 500 : 2000,
    onEvict: (id, cat) => console.log(`Evicted: ${id} [${cat}]`),
    onPanic: (u) => console.error(`PANIC at ${(u*100).toFixed(0)}%`)
});
manager.start();

// 3. Dev HUD (remove in production)
if (import.meta.env?.DEV) {
    new VramHUD(cache, { manager, position: 'top-right' });
}

// 4. Load a scene
const forest = {
    name: 'forest',
    assets: resolver.resolveSceneAssets([
        { id: 'bg-sky',    category: 'bg' },
        { id: 'hero',      category: 'char' },
        { id: 'hud-hp',    category: 'ui' },   // immune to eviction
    ], tier.tier)
};
await loadScene(cache, forest, registry);

// 5. Safe transition — always unloads before loading
const cave = {
    name: 'cave',
    assets: resolver.resolveSceneAssets([
        { id: 'cave-bg',   category: 'bg' },
        { id: 'hero',      category: 'char' },
        { id: 'hud-hp',    category: 'ui' },
    ], tier.tier)
};
await transitionScenes(cache, forest, cave, registry);

console.log(`${tier.tierName} | ${cache.stats().maxMemoryMB}MB | GPU: ${tier.signals.gpu}`);
```

---

## Full Module Reference

### deviceTier.js — Hardware Classifier

7-rule detection chain that classifies every device into LOW / MID / HIGH:

| # | Condition | → Tier | Reason |
|---|---|---|---|
| 1 | iOS && RAM ≤ 3GB | LOW | Safari process limits leave ≤100MB for textures |
| 2 | Android && RAM ≤ 2GB (Chrome `deviceMemory`) | LOW | Budget Android |
| 3 | Mobile && gpuIsLow | LOW | Weak mobile GPU (Mali T6/T7, Adreno 3xx–5xx, PowerVR) |
| 4 | Desktop && gpuIsLow | MID | Old integrated GPU — desktop is still permissive |
| 5 | RAM ≤ 4GB | MID | Memory-constrained |
| 6 | Desktop && cores ≤ 2 && RAM ≤ 8GB | MID | Weak desktop |
| 7 | Everything else | HIGH | Sufficient hardware |

```javascript
const { tier, tierName, signals } = detectDeviceTier();
// signals: { isIOS, isIPad, isMobile, memory, memoryReal, cores, gpu, gpuIsLow, reason }
```

### presets.js — Tier-Aware Cache Factory

| Tier | Budget | Target Devices |
|---|---|---|
| SAFE | 32 MB | iPhone 6–7, Safari under heavy pressure |
| LOW | 48 MB | iPhone SE, iPad 6th gen, 2GB Android |
| MID | 96 MB | iPhone 12, mid-range Android, 4GB laptops |
| HIGH | 192 MB | Desktop, gaming laptops, iPad Pro |
| ULTRA | 256 MB | High-end desktop, WebGPU, cinematic |

```javascript
const cache = createSpriteCacheForTier(DeviceTier.LOW);
const { cache, tier } = createCacheAuto();       // auto-detect
const defaults = getTierDefaults('ultra');        // inspect without creating
```

### categoryRegistry.js — Eviction Priority

```
Eviction order (first to die → last to die):
  TEMP → FX → BG → CHAR → UI (immune)
```

| Method | Description |
|---|---|
| `register(id, category)` | Tags an asset. Invalid categories coerce to TEMP with warning. |
| `registerBatch(assets)` | Bulk-register `[{ id, category }]` arrays. |
| `getIdsByPriority()` | Returns all IDs sorted TEMP-first. UI excluded. |
| `isEvictable(id)` | `false` for UI, `true` for everything else. |
| `getCategory(id)` | Returns the category, or `undefined`. |
| `size` | Number of registered assets (getter). |

### vramManager.js — Pressure Monitor + Eviction Engine

| Option | Default | Description |
|---|---|---|
| `registry` | **required** | CategoryRegistry instance. Throws if omitted. |
| `checkIntervalMs` | 2000 | Polling frequency (ms). LOW devices should use 500. |
| `highWatermark` | 0.90 | Usage ratio that triggers category-based eviction. |
| `lowWatermark` | 0.75 | Usage ratio below which eviction stops (hysteresis). |
| `panicWatermark` | 0.95 | Usage ratio that triggers panic mode (mass eviction). |
| `onEvict` | null | `(id, category?) => void` — analytics callback. |
| `onPressure` | null | `(usage) => void` — entering pressure state. |
| `onRelief` | null | `(usage) => void` — returning below low watermark. |
| `onPanic` | null | `(usage) => void` — emergency eviction engaged. |

| Method | Description |
|---|---|
| `start()` | Begin periodic checks. Idempotent. |
| `stop()` | Stop periodic checks. |
| `pause()` / `resume()` | Disable/enable eviction (e.g., during scene transitions). |
| `check()` | Manual immediate pressure check. |
| `stats()` | Diagnostic snapshot with `pressured`, `paused`, `usageRatio`, `registrySize`. |
| `destroy()` | Stops timer, nullifies references. Idempotent. |

### assetResolver.js — Tier-Aware URL Construction

```javascript
const resolver = new AssetResolver({
    basePath: 'assets',      // default
    extension: '.png',       // default
    suffixes: { 1: '@0.5x', 2: '@0.75x', 3: '' }  // default (LOW/MID/HIGH)
});

resolver.resolve('hero', DeviceTier.LOW);   // 'assets/hero@0.5x.png'
resolver.resolve('hero', DeviceTier.HIGH);  // 'assets/hero.png'

// Bulk resolve with categories preserved for loadScene()
const assets = resolver.resolveSceneAssets([
    { id: 'bg', category: 'bg' },
    { id: 'hero', category: 'char' }
], tier.tier);
```

### sceneStreaming.js — Safe Scene Pipeline

| Function | Description |
|---|---|
| `loadScene(cache, scene, registry?)` | Parallel load. Registers categories before decode. |
| `unloadScene(cache, scene, registry?)` | Immediate dispose of all scene assets. |
| `transitionScenes(cache, from, to, registry?)` | Unloads FIRST, then loads. Safari-safe. |
| `preloadScene(cache, scene, registry?)` | Loads without unloading current. Budget check first! |
| `cleanupPartialLoad(cache, scene, result, registry?)` | Rollback: disposes only the assets that succeeded. |

### vramHud.js — Live Telemetry Overlay

| Option | Values | Description |
|---|---|---|
| `position` | `'top-left'` / `'top-right'` / `'bottom-left'` / `'bottom-right'` | Corner placement |
| `mode` | `'raf'` / `'interval'` | RAF for dev (60Hz), interval for background-tab safety |
| `display` | `'full'` / `'compact'` | Multi-line or single-line |
| `intervalMs` | 500 (default) | Update frequency in interval mode |
| `manager` | VramManager instance | Enables pressure/eviction fields |

### safariStressTest.js — Crash Threshold Finder

```javascript
const result = await runSafariStressTest('https://cdn.example.com/texture.png', {
    iterations: 200,
    ceilingMB: 512,
    warmUpCount: 5,
    throttleMultiplier: 3
});
// result: { totalLoaded, peakMemoryMB, avgDurationMs, baselineDurationMs, stopReason }

const sweep = await runResolutionSweep('https://cdn.example.com/texture.png');
// Tests 512×256, 1024×512, 2048×1024 — builds VRAM cost matrix
```

---

## Recipes

<details>
<summary><strong>Budget-Guarded Preloading</strong></summary>

```javascript
const freeMB = parseFloat(cache.stats().maxMemoryMB) - parseFloat(cache.stats().memoryMB);
if (freeMB > 10) {
    // Budget allows overlap — preload next scene
    for (const a of nextScene.assets) {
        if (a.category) registry.register(a.id, a.category);
    }
    await cache.loadAll(nextScene.assets);
} else {
    // Too tight — safe sequential transition
    await transitionScenes(cache, currentScene, nextScene, registry);
}
```

</details>

<details>
<summary><strong>Pause Eviction During Cutscenes</strong></summary>

```javascript
manager.pause();
// Both scenes in VRAM temporarily
await loadScene(cache, cutscene, registry);
playCutscene();
// After cutscene
unloadScene(cache, cutscene, registry);
manager.resume();
```

</details>

<details>
<summary><strong>F2 HUD Toggle (Production QA Pattern)</strong></summary>

```javascript
let hud = null;
window.addEventListener('keydown', e => {
    if (e.key === 'F2') {
        e.preventDefault();
        if (hud) { hud.destroy(); hud = null; }
        else { hud = new VramHUD(cache, { manager, position: 'top-right' }); }
    }
});
```

</details>

<details>
<summary><strong>Partial Load Rollback</strong></summary>

```javascript
const result = await loadScene(cache, bossScene, registry);
if (!result.ok) {
    console.warn(`${result.failed} assets failed — rolling back`);
    cleanupPartialLoad(cache, bossScene, result, registry);
    // Show fallback UI
}
```

</details>

<details>
<summary><strong>Custom Tier Suffixes</strong></summary>

```javascript
const resolver = new AssetResolver({
    basePath: 'https://cdn.example.com/game',
    extension: '.webp',
    suffixes: { 1: '_lo', 2: '_md', 3: '' }
});
// LOW: https://cdn.example.com/game/hero_lo.webp
// HIGH: https://cdn.example.com/game/hero.webp
```

</details>

<details>
<summary><strong>Safari Stress Test in CI</strong></summary>

```javascript
const result = await runSafariStressTest(textureUrl, {
    iterations: 100,
    ceilingMB: 48,
    throttleMultiplier: 3
});
if (result.stopReason !== 'complete') {
    process.exit(1); // Fail the build
}
```

</details>

---

## What's in the Box

```
├── src/              9 JS modules + 9 .d.ts + diagnostic HTML
├── vram-diagnostics-dashboard/   Live VRAM graph, decode timing, exportable reports
│ 
└── vram.test.js       48 vitest tests covering all modules
```

---

## 🆓 Help Us Build Better Presets — Run the Dashboard!

The Diagnostic Dashboard is **completely free**. You don't need to install anything or run a local server.

👉 **[Run the Live VRAM Diagnostic Tool (CodePen Debug View)](https://cdpn.io/pen/debug/wBzxWPM/1b39093bbc824213998aacdf107736d5)**

It takes 60 seconds to run a test:
1. Open the link above on your target device (especially older phones or iPads).
2. Set the Tier Dropdown to the preset you want to test.
3. Click **▶ Start** and watch the VRAM load.
4. If the Safari tab crashes (reloads), you know the exact megabyte limit for that tier.
5. Click **Export Report**.

### Contributing Data
If you test `lite-vram` on an older device (like an iPhone 8 or a budget Android), please send us the JSON report! Your data helps us refine the `presets.json` watermarks for the whole community.

When submitting a report, please fill out the environmental hardware fields in the exported JSON:

```json
{
  "deviceModel": "iPhone 11 Pro",
  "osVersion": "iOS 17.2",
  "browserVersion": "Safari 17",
  "batteryStart": "82%",
  "deviceTemp": "cool | warm | hot",
  "network": "WiFi 5GHz | WiFi 2.4GHz | LTE | 5G",
  "notes": "Tab crashed cleanly at 192MB, no severe system stutter before the crash."
}

**Your anonymous device report is the most valuable contribution you can make.** Every JSON adds a real data point to our device matrices. Every data point makes the presets safer. Every safer preset prevents a Safari crash for some studio shipping a game to millions of players.

We desperately need reports from:

- **iPhone 7, 8, SE 2nd gen** — the LOW / MID boundary
- **iPhone 12, 13, 14, 15** — the MID / HIGH boundary
- **iPad 6th, 7th, 9th gen** — Safari memory limits differ from iPhone
- **2GB / 4GB Android** — Chrome's `deviceMemory` edge cases
- **MacBooks with Intel HD 4000–620** — the desktop `gpuIsLow` boundary
- **Any device that has ever crashed a web game** — we need its profile

**Every report you send saves a studio from shipping a crash.**

→ **[Read the full Dashboard README](./examples/vram-diagnostics-dashboard/README.md)** for report format, field mapping, and how we use the data.

---

## Testing

```bash
npx vitest run vram.test.js
```

48 tests across 10 describe blocks: CategoryRegistry (registration, eviction order, size, batch, clear, isEvictable, getIdsByPriority), DeviceTier (constants, detection, signal fields), AssetResolver (all 3 tiers, custom suffixes, scene assets, standalone function, edge cases), Presets (all 5 tiers, overrides, auto-detect, fallback), VramManager (mandatory registry throw, watermarks, pause/resume, stats, start/stop, destroy), SceneStreaming (load, unload, transition, partial cleanup with mock cache).

---

## Changelog

### v1.0.0

**Architecture: 7-rule device detection**
Added Android ≤2GB rule (Chrome `deviceMemory`), scoped `gpuIsLow` to mobile-only (desktop gets MID not LOW), expanded Intel GPU regex to catch 3-digit Skylake/Kaby Lake (HD 515, 520, 530, 610, 615, 620; excludes 540+, 630+).

**Safety: VramManager requires CategoryRegistry**
Constructor throws immediately if no registry is provided. Previously defaulted to `null` and crashed silently when VRAM pressure hit 90% — the exact moment the system was supposed to save the device.

**Safety: ES2015 catch binding**
`} catch {` → `} catch (e) {` in GPU probe. Optional catch binding is ES2019 — fatal `SyntaxError` on iOS 12 / early iOS 13, killing the game on exactly the oldest devices that need VRAM protection the most.

**Dashboard: Decode timing panel**
Baseline, last decode, multiplier, peak, and color-coded throttle bar. The only real-time Safari VRAM pressure signal available to web developers.

**Dashboard: Per-tier watermarks from presets.json**
SAFE 0.75/0.55/0.88 through ULTRA 0.92/0.80/0.96. Graph draws correct watermark lines per tier.

**Dashboard: Crash-proof RAF loop**
`try/catch` with `requestAnimationFrame` after the catch block. Visibility API pauses on tab switch. Session timer resets per boot. Tier selector auto-syncs to detected tier. Flush resets all metrics.

**Examples: Production-hardened**
Multi-scene streaming: 300ms throttled stats, visibility handler, transition race prevention, pattern double-click guard, resize listener. Safari Safe Mode: 100 iterations (was 60 — now hits budget ceiling and forces eviction), shared canvas (zero GC), early stop on throttle/95%, tracked peak VRAM, baseline guard. Tier-aware loading: anchored suffix regex, `--text-dim` variable, `!!` boolean coercion. VramHUD demo: cached canvas resize, dynamic tile limit, zero-GC stat polling (250ms), correct category rotation, VramManager with visible watermarks.

---

## License

MIT — Built by [@zakkster](https://www.npmjs.com/~zakkster) at [NiceWorks Studio](https://github.com/niceworks-studio)

---

*VRAM management isn't a feature. It's the difference between your game running and your game crashing. On Safari, there is no middle ground.*