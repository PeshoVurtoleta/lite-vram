/**
 * VramManager — Category-Aware VRAM Pressure Response System.
 *
 * Monitors SpriteCache memory usage and performs intelligent eviction:
 *   TEMP → FX → BG → CHAR → (UI is immune)
 *
 * Features:
 * - High/Low watermark hysteresis
 * - Scaled eviction intensity (more assets evicted when further above threshold)
 * - Panic mode at 95%: bypasses category logic, evicts everything non-UI
 * - Pause/resume for scene transitions
 * - onEvict callback for analytics
 */

import { AssetCategory, EVICTION_ORDER } from './categoryRegistry.js';

export class VramManager {
    /**
     * @param {import('@zakkster/lite-sprite-cache').SpriteCache} cache
     * @param {Object} [options]
     * @param {number} [options.checkIntervalMs=2000]
     * @param {number} [options.highWatermark=0.90]
     * @param {number} [options.lowWatermark=0.75]
     * @param {number} [options.panicWatermark=0.95]
     * @param {number} [options.aggressiveUnloadAge=5000]
     * @param {import('./categoryRegistry.js').CategoryRegistry} options.registry - Required. Category-aware eviction depends on this.
     * @param {function(string, string=): void} [options.onEvict=null] - Called with (id, category?) on each eviction.
     * @param {function(number): void} [options.onPressure=null]
     * @param {function(number): void} [options.onRelief=null]
     * @param {function(number): void} [options.onPanic=null] - Called when usage exceeds panicWatermark.
     */
    constructor(cache, {
        checkIntervalMs     = 2000,
        highWatermark       = 0.90,
        lowWatermark        = 0.75,
        panicWatermark      = 0.95,
        aggressiveUnloadAge = 5000,
        registry            = null,
        onEvict             = null,
        onPressure          = null,
        onRelief            = null,
        onPanic             = null
    } = {}) {
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

        if (!registry) {
            throw new Error(
                'VramManager requires a CategoryRegistry instance. ' +
                'Without it, eviction cannot prioritize by category and will crash under pressure. ' +
                'Pass { registry } in the options object.'
            );
        }
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
        // Above 95%: bypass category logic, aggressively evict everything non-UI.
        // This prevents Safari tab crashes.
        if (usage > this.panicWatermark) {
            if (!this._pressured) {
                this._pressured = true;
                if (this.onPressure) this.onPressure(usage);
            }
            if (this.onPanic) this.onPanic(usage);
            this._panicEvict();
            return;
        }

        // ── Hysteresis ───────────────────────────────────
        if (!this._pressured) {
            if (usage > this.highWatermark) {
                this._pressured = true;
                if (this.onPressure) this.onPressure(usage);
            } else {
                return;
            }
        }

        if (usage <= this.lowWatermark) {
            this._pressured = false;
            if (this.onRelief) this.onRelief(usage);
            return;
        }

        // ── Scaled Eviction ──────────────────────────────
        // The further above the high watermark, the more assets we evict per tick.
        // At 91%: 1 eviction. At 94%: ~4 evictions. Mimics Unreal's panic ramp.
        const overshoot = usage - this.highWatermark;
        const evictionCount = Math.max(1, Math.floor(overshoot * 40));

        if (this.registry) {
            this._evictByPriority(evictionCount);
        } else {
            this.cache.unloadUnused(this.aggressiveUnloadAge);
        }
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
        if (this.registry) {
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
        }
        // Also run aggressive age-based eviction as a last resort
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
            pressured:     this._pressured,
            paused:        this._paused,
            usageRatio:    usage,
            usagePercent:  (usage * 100).toFixed(1),
            highWatermark: this.highWatermark,
            lowWatermark:  this.lowWatermark,
            panicWatermark: this.panicWatermark,
            registrySize:  this.registry ? this.registry.size : 0,
            running:       this._timer !== null
        };
    }

    /** Stops and nullifies references. Idempotent. */
    destroy() {
        this.stop();
        this.cache    = null;
        this.registry = null;
    }
}
