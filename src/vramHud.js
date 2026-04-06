/**
 * VramHUD — Lightweight in-game VRAM telemetry overlay.
 *
 * Modes:
 * - `'interval'`: setInterval — works in background tabs
 * - `'raf'`: requestAnimationFrame — frame-synced, pauses when backgrounded
 *
 * Display:
 * - `'full'` (default): Multi-line with all metrics
 * - `'compact'`: Single-line summary
 */

export class VramHUD {
    /**
     * @param {import('@zakkster/lite-sprite-cache').SpriteCache} cache
     * @param {Object} [options]
     * @param {'top-left'|'top-right'|'bottom-left'|'bottom-right'} [options.position='top-left']
     * @param {'interval'|'raf'} [options.mode='interval']
     * @param {'full'|'compact'} [options.display='full']
     * @param {number} [options.intervalMs=500]
     * @param {import('./vramManager.js').VramManager} [options.manager=null]
     */
    constructor(cache, {
        position   = 'top-left',
        mode       = 'interval',
        display    = 'full',
        intervalMs = 500,
        manager    = null
    } = {}) {
        this.cache   = cache;
        this.manager = manager;
        this.mode    = mode;
        this.display = display;

        /** Peak VRAM usage observed (MB). */
        this.peakMB = 0;

        // ── DOM Setup ────────────────────────────────
        this.el = document.createElement('div');
        const s = this.el.style;
        s.position     = 'fixed';
        s.zIndex       = '99999';
        s.fontFamily   = 'ui-monospace, SFMono-Regular, Menlo, monospace';
        s.fontSize     = '11px';
        s.lineHeight   = '1.4';
        s.padding      = '5px 8px';
        s.background   = 'rgba(0, 0, 0, 0.75)';
        s.color        = '#0f0';
        s.borderRadius = '3px';
        s.pointerEvents = 'none';
        s.whiteSpace   = 'pre';

        const positions = {
            'top-left':     { top: '4px', left: '4px' },
            'top-right':    { top: '4px', right: '4px' },
            'bottom-left':  { bottom: '4px', left: '4px' },
            'bottom-right': { bottom: '4px', right: '4px' }
        };
        Object.assign(s, positions[position] || positions['top-left']);

        document.body.appendChild(this.el);

        // ── Update Loop ──────────────────────────────
        /** @private */ this._rafId = null;
        /** @private */ this._timer = null;

        if (mode === 'raf') {
            const tick = () => {
                this._render();
                this._rafId = requestAnimationFrame(tick);
            };
            this._rafId = requestAnimationFrame(tick);
        } else {
            this._timer = setInterval(() => this._render(), intervalMs);
        }
    }

    /** Resets peak tracking to current usage. */
    resetPeak() {
        const s = this.cache.stats();
        this.peakMB = parseFloat(s.memoryMB) || 0;
    }

    /** @private */
    _render() {
        const s = this.cache.stats();
        const used = parseFloat(s.memoryMB) || 0;
        const max  = parseFloat(s.maxMemoryMB) || 1;
        const ratio = used / max;

        if (used > this.peakMB) this.peakMB = used;

        let text;

        if (this.display === 'compact') {
            const pct = (ratio * 100).toFixed(0);
            const pressure = this.manager?.isPressured ? ' ⚠' : '';
            text = `VRAM ${s.memoryMB}/${s.maxMemoryMB}MB (${pct}%)${pressure}`;
        } else {
            text = `VRAM ${s.memoryMB}/${s.maxMemoryMB} MB | ${s.items} cached | ${s.pending} pending`;
            text += `\nPeak: ${this.peakMB.toFixed(2)} MB`;

            if (this.manager) {
                const ms = this.manager.stats();
                const pressureTag = ms.pressured ? ' ⚠ PRESSURE' : '';
                const pauseTag    = ms.paused ? ' ⏸ PAUSED' : '';
                text += `\n${ms.usagePercent}% usage${pressureTag}${pauseTag}`;
            }
        }

        // Color code
        if (ratio > 0.9) {
            this.el.style.color = '#f44';
        } else if (ratio > 0.7) {
            this.el.style.color = '#fa0';
        } else {
            this.el.style.color = '#0f0';
        }

        this.el.textContent = text;
    }

    /** Removes HUD and stops updates. Idempotent. */
    destroy() {
        if (this._timer) { clearInterval(this._timer); this._timer = null; }
        if (this._rafId) { cancelAnimationFrame(this._rafId); this._rafId = null; }
        if (this.el.parentNode) this.el.remove();
        this.cache = null;
        this.manager = null;
    }
}
