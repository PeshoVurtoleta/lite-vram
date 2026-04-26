/**
 * VramManager — Category-Aware VRAM Pressure Response System.
 *
 * Monitors SpriteCache memory usage and performs intelligent eviction:
 *   TEMP → FX → BG → CHAR → (UI is immune)
 *
 * Features:
 * - High/Low watermark hysteresis with explicit state-transition tracking
 * - Scaled eviction intensity (more assets evicted when further above threshold)
 * - Panic mode at panicWatermark: bypasses category logic, evicts everything non-UI
 * - Pause/resume for scene transitions
 * - onEvict callback for analytics
 *
 * ── v1.1.0 Hysteresis Fix ────────────────────────────────────────────
 * In v1.0.x, when a fast device crossed both `highWatermark` and
 * `panicWatermark` between two ticks, the manager fired both `onPressure`
 * and `onPanic` simultaneously, making `pressure.events == pressure.panics`
 * in dashboard reports. This obscured the diagnostic signal.
 *
 * v1.1 separates the two callbacks at their semantic source:
 *   - `onPressure` fires only on the OK → HIGH-PRESSURE transition.
 *   - `onPanic`    fires every tick we are above panicWatermark, regardless
 *                  of whether we passed through HIGH-PRESSURE first.
 *
 * If `onPressure` count < `onPanic` count, the dashboard knows the device
 * overshot the high-watermark window and the gap should be widened.
 */

import { AssetCategory, EVICTION_ORDER } from './categoryRegistry.js';

export class VramManager {
    /**
     * @param {import('@zakkster/lite-sprite-cache').SpriteCache} cache
     * @param {Object} [options]
     * @param {number} [options.checkIntervalMs=1000]
     * @param {number} [options.highWatermark=0.85]   - v1.1 default (was 0.90).
     * @param {number} [options.lowWatermark=0.70]    - v1.1 default (was 0.75).
     * @param {number} [options.panicWatermark=0.96]  - v1.1 default (was 0.95).
     * @param {number} [options.aggressiveUnloadAge=5000]
     * @param {import('./categoryRegistry.js').CategoryRegistry} options.registry - Required.
     * @param {function(string, string=): void} [options.onEvict=null]
     * @param {function(number): void} [options.onPressure=null]
     * @param {function(number): void} [options.onRelief=null]
     * @param {function(number): void} [options.onPanic=null]
     */
    constructor(cache, {
        checkIntervalMs     = 1000,
        highWatermark       = 0.85,
        lowWatermark        = 0.70,
        panicWatermark      = 0.96,
        aggressiveUnloadAge = 5000,
        registry            = null,
        onEvict             = null,
        onPressure          = null,
        onRelief            = null,
        onPanic             = null
    } = {}) {
        if (!registry) {
            throw new Error(
                'VramManager requires a CategoryRegistry instance. ' +
                'Without it, eviction cannot prioritize by category and will crash under pressure. ' +
                'Pass { registry } in the options object.'
            );
        }

        // ── Watermark sanity check (v1.1) ────────────────────────
        // Catches misconfigurations like high=0.95, panic=0.90 that would
        // make the system permanently panic and never relieve.
        if (!(lowWatermark < highWatermark && highWatermark < panicWatermark)) {
            throw new Error(
                `VramManager: watermarks must satisfy low < high < panic. ` +
                `Got low=${lowWatermark}, high=${highWatermark}, panic=${panicWatermark}.`
            );
        }

        this.cache              = cache;
        this.checkIntervalMs    = checkIntervalMs;
        this.highWatermark      = highWatermark;
        this.lowWatermark       = lowWatermark;
        this.panicWatermark     = panicWatermark;
        this.aggressiveUnloadAge = aggressiveUnloadAge;
        this.onEvict            = onEvict;
        this.onPressure         = onPressure;
        this.onRelief           = onRelief;
        this.onPanic            = onPanic;
        this.registry           = registry;

        /** @private */ this._timer = null;
        /** @private */ this._pressured = false;
        /** @private */ this._paused = false;
    }

    /** Starts the periodic check. Idempotent. */
    start() {
        if (this._timer) return;
        this._timer = setInterval(() => this._tick(), this.checkIntervalMs);
    }

    /** Stops the periodic check. Does not evict. */
    stop() {
        if (!this._timer) return;
        clearInterval(this._timer);
        this._timer = null;
    }

    /**
     * Temporarily disables eviction.
     * Useful during scene transitions where you want to load both scenes
     * briefly before unloading the old one.
     */
    pause() {
        this._paused = true;
    }

    /** Resumes eviction after a pause. */
    resume() {
        this._paused = false;
    }

    /** @returns {boolean} */
    get isPressured() { return this._pressured; }

    /** @returns {boolean} */
    get isPaused() { return this._paused; }

    /** Manual trigger for an immediate pressure check. */
    check() { this._tick(); }

    /** @private */
    _tick() {
        if (this._paused) return;

        const usage = this._getUsageRatio();

        // ── Panic Mode ───────────────────────────────────
        // Above panicWatermark: bypass category logic, aggressively evict
        // everything non-UI to prevent Safari tab crashes.
        //
        // v1.1: do NOT fire `onPressure` here. Pressure events are reserved
        // for graceful OK→HIGH transitions. If the system jumped straight to
        // panic, the dashboard sees onPanic without a preceding onPressure
        // and can correctly diagnose watermark overshoot.
        if (usage > this.panicWatermark) {
            this._pressured = true;
            if (this.onPanic) this.onPanic(usage);
            this._panicEvict();
            return;
        }

        // ── Hysteresis: enter pressured state via the high watermark ─────
        if (!this._pressured) {
            if (usage > this.highWatermark) {
                this._pressured = true;
                if (this.onPressure) this.onPressure(usage);
            } else {
                return;
            }
        }

        // ── Relief: exit pressured state via the low watermark ───────────
        if (usage <= this.lowWatermark) {
            this._pressured = false;
            if (this.onRelief) this.onRelief(usage);
            return;
        }

        // ── Scaled Eviction ──────────────────────────────────────────────
        // The further above the high watermark, the more assets we evict
        // per tick. At 1pp over: 1 eviction. At 4pp over: ~4 evictions.
        const overshoot = usage - this.highWatermark;
        const evictionCount = Math.max(1, Math.floor(overshoot * 40));

        this._evictByPriority(evictionCount);
    }

    /**
     * Category-aware eviction: walks TEMP → FX → BG → CHAR.
     * UI is never touched. Evicts up to `count` assets per tick.
     * @private
     * @param {number} count
     */
    _evictByPriority(count) {
        const prioritized = this.registry.getIdsByPriority();
        let evicted = 0;

        for (const id of prioritized) {
            if (evicted >= count) break;

            if (this.cache.get(id) !== undefined) {
                const category = this.registry.getCategory(id);
                this.cache.dispose(id);
                this.registry.unregister(id);
                if (this.onEvict) this.onEvict(id, category);
                evicted++;
            } else {
                this.registry.unregister(id);
            }
        }

        // Fallback if no categorized assets remain
        if (evicted === 0) {
            this.cache.unloadUnused(this.aggressiveUnloadAge);
        }
    }

    /**
     * Panic eviction: bypasses category priority, evicts ALL non-UI assets
     * starting from the oldest accessed, until below high watermark.
     * @private
     */
    _panicEvict() {
        const evictable = this.registry.getIdsByPriority();
        for (const id of evictable) {
            if (this._getUsageRatio() <= this.highWatermark) break;
            if (this.cache.get(id) !== undefined) {
                const category = this.registry.getCategory(id);
                this.cache.dispose(id);
                this.registry.unregister(id);
                if (this.onEvict) this.onEvict(id, category);
            }
        }
        // Last-resort age-based eviction
        this.cache.unloadUnused(this.aggressiveUnloadAge);
    }

    /**
     * @private
     * @returns {number}
     */
    _getUsageRatio() {
        const stats = this.cache.stats();
        const used = parseFloat(stats.memoryMB) || 0;
        const max  = parseFloat(stats.maxMemoryMB) || 1;
        return used / max;
    }

    /**
     * Diagnostic snapshot.
     * @returns {Object}
     */
    stats() {
        const usage = this._getUsageRatio();
        return {
            pressured:      this._pressured,
            paused:         this._paused,
            usageRatio:     usage,
            usagePercent:   (usage * 100).toFixed(1),
            highWatermark:  this.highWatermark,
            lowWatermark:   this.lowWatermark,
            panicWatermark: this.panicWatermark,
            registrySize:   this.registry ? this.registry.size : 0,
            running:        this._timer !== null
        };
    }

    /** Stops and nullifies references. Idempotent. */
    destroy() {
        this.stop();
        this.cache    = null;
        this.registry = null;
    }
}
