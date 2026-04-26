/**
 * Per-Tier Watermark Configuration.
 *
 * Watermarks govern *when* the VramManager evicts. They are deliberately
 * separate from the cache budgets in `presets.js` because the two concerns
 * are independent: a HIGH-tier device might use a SAFE-tier budget but
 * still want generous watermarks, or vice-versa.
 *
 * ── Tuning history (v1.1.0) ──────────────────────────────
 * Analysis of 38 real-device reports (v1.0.6) revealed that the previous
 * HIGH-tier configuration (high=0.90, panic=0.95, checkInterval=2000) was
 * collapsing hysteresis: in 18/22 HIGH reports `events == panics`, meaning
 * the system jumped OK → PANIC in a single tick without ever sitting in
 * a graceful HIGH-pressure state. Cache filled fast enough between two
 * 2-second ticks to cross both thresholds simultaneously.
 *
 * v1.1 widens the gap and halves the check interval on HIGH/ULTRA so the
 * manager has more chances to catch pressure before panic.
 *
 * | Tier  | high | low  | panic | checkMs |
 * |-------|------|------|-------|---------|
 * | safe  | 0.75 | 0.55 | 0.88  |   300   |
 * | LOW   | 0.78 | 0.60 | 0.92  |   500   |
 * | MID   | 0.82 | 0.65 | 0.94  |   750   |
 * | HIGH  | 0.85 | 0.70 | 0.96  |  1000   |
 * | ultra | 0.87 | 0.72 | 0.98  |  1000   |
 *
 * The `high` → `panic` gap is at least 11 percentage points on every tier.
 * Combined with sub-second polling on HIGH/ULTRA, the manager cannot skip
 * the pressured-but-not-panicking state on realistic load curves.
 */

import { DeviceTier } from './deviceTier.js';

/**
 * @typedef {Object} WatermarkConfig
 * @property {number} high           - Usage ratio (0–1) that triggers eviction.
 * @property {number} low            - Usage ratio (0–1) below which eviction stops.
 * @property {number} panic          - Usage ratio (0–1) that triggers panic mode.
 * @property {number} checkIntervalMs - Polling frequency (ms) for the manager.
 */

/** @type {Readonly<Record<string|number, WatermarkConfig>>} */
export const WATERMARKS = Object.freeze({
    safe: Object.freeze({
        high:            0.75,
        low:             0.55,
        panic:           0.88,
        checkIntervalMs: 300
    }),
    [DeviceTier.LOW]: Object.freeze({
        high:            0.78,
        low:             0.60,
        panic:           0.92,
        checkIntervalMs: 500
    }),
    [DeviceTier.MID]: Object.freeze({
        high:            0.82,
        low:             0.65,
        panic:           0.94,
        checkIntervalMs: 750
    }),
    [DeviceTier.HIGH]: Object.freeze({
        high:            0.85,
        low:             0.70,
        panic:           0.96,
        checkIntervalMs: 1000
    }),
    ultra: Object.freeze({
        high:            0.87,
        low:             0.72,
        panic:           0.98,
        checkIntervalMs: 1000
    })
});

/**
 * Returns the watermark config for a given tier, in a shape that can be
 * spread directly into the `VramManager` constructor options.
 *
 * Falls back to HIGH-tier values for unknown keys (most generous defaults).
 *
 * @param {number|string} tier - DeviceTier.LOW|MID|HIGH, or 'safe'|'ultra'.
 * @returns {{highWatermark: number, lowWatermark: number, panicWatermark: number, checkIntervalMs: number}}
 *          A fresh shallow copy — safe to mutate.
 *
 * @example
 * ```js
 * import { detectDeviceTier, getWatermarksForTier, VramManager } from '@zakkster/lite-vram';
 *
 * const { tier } = detectDeviceTier();
 * const manager = new VramManager(cache, {
 *     registry,
 *     ...getWatermarksForTier(tier)   // spreads as highWatermark/lowWatermark/panicWatermark
 * });
 * ```
 */
export function getWatermarksForTier(tier) {
    const cfg = WATERMARKS[tier] || WATERMARKS[DeviceTier.HIGH];
    return {
        highWatermark:   cfg.high,
        lowWatermark:    cfg.low,
        panicWatermark:  cfg.panic,
        checkIntervalMs: cfg.checkIntervalMs
    };
}
