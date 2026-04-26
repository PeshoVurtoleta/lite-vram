/**
 * VRAM — Complete Test Suite
 *
 * Run: npx vitest run vram.test.js
 *
 * Covers:
 *   - CategoryRegistry (registration, eviction order, size, getCategory)
 *   - DeviceTier (detection, signals, tier names)
 *   - AssetResolver (suffix mapping, scene resolution, standalone fn)
 *   - Presets (tier defaults, cache creation, auto-detect)
 *   - VramManager (mandatory registry, watermarks, stats, pause/resume, destroy)
 *   - SceneStreaming (loadScene, unloadScene, transitionScenes, cleanupPartialLoad)
 *   - SafariStressTest (result structure, stop reasons, warm-up, sweep)
 *   - VramHUD (construction, peak tracking, display modes, destroy lifecycle)
 */

/** @vitest-environment jsdom */
import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest';

// ══════════════════════════════════════════════════════════
//  MODULE: CategoryRegistry
// ══════════════════════════════════════════════════════════

import {
    AssetCategory,
    EVICTION_ORDER,
    CategoryRegistry
} from '../index.js';

describe('CategoryRegistry', () => {
    let registry;

    beforeEach(() => {
        registry = new CategoryRegistry();
    });

    it('starts empty', () => {
        expect(registry.size).toBe(0);
        expect(registry.getAll()).toEqual([]);
    });

    it('registers and retrieves categories', () => {
        registry.register('hero', AssetCategory.CHAR);
        registry.register('spark', AssetCategory.FX);

        expect(registry.getCategory('hero')).toBe('char');
        expect(registry.getCategory('spark')).toBe('fx');
        expect(registry.has('hero')).toBe(true);
        expect(registry.has('missing')).toBe(false);
        expect(registry.size).toBe(2);
    });

    it('coerces invalid categories to TEMP with warning', () => {
        const spy = vi.spyOn(console, 'warn').mockImplementation(() => {
        });
        registry.register('junk', 'INVALID_CAT');

        expect(registry.getCategory('junk')).toBe('temp');
        expect(spy).toHaveBeenCalledOnce();
        spy.mockRestore();
    });

    it('registerBatch registers multiple assets', () => {
        registry.registerBatch([
            {id: 'a', category: 'bg'},
            {id: 'b', category: 'ui'},
            {id: 'c', category: 'fx'},
        ]);
        expect(registry.size).toBe(3);
        expect(registry.getCategory('b')).toBe('ui');
    });

    it('unregister removes an asset', () => {
        registry.register('x', 'temp');
        expect(registry.size).toBe(1);
        registry.unregister('x');
        expect(registry.size).toBe(0);
        expect(registry.has('x')).toBe(false);
    });

    it('clear removes all registrations', () => {
        registry.register('a', 'bg');
        registry.register('b', 'char');
        registry.clear();
        expect(registry.size).toBe(0);
    });

    it('isEvictable returns false for UI, true for everything else', () => {
        registry.register('hud', AssetCategory.UI);
        registry.register('bg1', AssetCategory.BG);

        expect(registry.isEvictable('hud')).toBe(false);
        expect(registry.isEvictable('bg1')).toBe(true);
        expect(registry.isEvictable('unregistered')).toBe(true);
    });

    it('getEvictionBucket returns correct indices', () => {
        expect(registry.getEvictionBucket('temp')).toBe(0);
        expect(registry.getEvictionBucket('fx')).toBe(1);
        expect(registry.getEvictionBucket('bg')).toBe(2);
        expect(registry.getEvictionBucket('char')).toBe(3);
        expect(registry.getEvictionBucket('ui')).toBe(-1);
    });

    it('getIdsByPriority returns TEMP→FX→BG→CHAR, excludes UI', () => {
        registry.register('ui-hud', AssetCategory.UI);
        registry.register('temp-1', AssetCategory.TEMP);
        registry.register('char-hero', AssetCategory.CHAR);
        registry.register('bg-sky', AssetCategory.BG);
        registry.register('fx-spark', AssetCategory.FX);

        const ordered = registry.getIdsByPriority();
        expect(ordered).toEqual(['temp-1', 'fx-spark', 'bg-sky', 'char-hero']);
        expect(ordered).not.toContain('ui-hud');
    });

    it('getIdsByCategory filters correctly', () => {
        registry.register('a', 'bg');
        registry.register('b', 'bg');
        registry.register('c', 'fx');

        expect(registry.getIdsByCategory('bg')).toEqual(['a', 'b']);
        expect(registry.getIdsByCategory('fx')).toEqual(['c']);
        expect(registry.getIdsByCategory('char')).toEqual([]);
    });

    it('getAll returns all entries', () => {
        registry.register('x', 'temp');
        registry.register('y', 'ui');
        const all = registry.getAll();
        expect(all).toHaveLength(2);
        expect(all).toContainEqual(['x', 'temp']);
        expect(all).toContainEqual(['y', 'ui']);
    });
});

describe('EVICTION_ORDER', () => {
    it('has 4 entries in correct order, no UI', () => {
        expect(EVICTION_ORDER).toEqual(['temp', 'fx', 'bg', 'char']);
        expect(EVICTION_ORDER).not.toContain('ui');
    });
});

// ══════════════════════════════════════════════════════════
//  MODULE: DeviceTier
// ══════════════════════════════════════════════════════════

import {DeviceTier, detectDeviceTier} from '../index.js';

describe('DeviceTier constants', () => {
    it('has LOW=1, MID=2, HIGH=3', () => {
        expect(DeviceTier.LOW).toBe(1);
        expect(DeviceTier.MID).toBe(2);
        expect(DeviceTier.HIGH).toBe(3);
    });
});

describe('detectDeviceTier', () => {
    it('returns a valid TierResult', () => {
        const result = detectDeviceTier();

        expect(result).toHaveProperty('tier');
        expect(result).toHaveProperty('tierName');
        expect(result).toHaveProperty('signals');
        expect([1, 2, 3]).toContain(result.tier);
        expect(['LOW', 'MID', 'HIGH']).toContain(result.tierName);
    });

    it('signals contain all required fields', () => {
        const {signals} = detectDeviceTier();

        expect(typeof signals.isIOS).toBe('boolean');
        expect(typeof signals.isIPad).toBe('boolean');
        expect(typeof signals.isMobile).toBe('boolean');
        expect(typeof signals.memory).toBe('number');
        expect(typeof signals.memoryReal).toBe('boolean');
        expect(typeof signals.cores).toBe('number');
        expect(typeof signals.gpu).toBe('string');
        expect(typeof signals.gpuIsLow).toBe('boolean');
        expect(typeof signals.reason).toBe('string');
        expect(signals.reason.length).toBeGreaterThan(0);
    });
});

// ══════════════════════════════════════════════════════════
//  MODULE: AssetResolver
// ══════════════════════════════════════════════════════════

import {AssetResolver, resolveTextureUrl} from '../index.js';

describe('AssetResolver', () => {
    it('resolves LOW with @0.5x suffix', () => {
        const r = new AssetResolver({basePath: 'assets'});
        expect(r.resolve('hero', DeviceTier.LOW)).toBe('assets/hero@0.5x.png');
    });

    it('resolves MID with @0.75x suffix', () => {
        const r = new AssetResolver({basePath: 'assets'});
        expect(r.resolve('hero', DeviceTier.MID)).toBe('assets/hero@0.75x.png');
    });

    it('resolves HIGH with no suffix', () => {
        const r = new AssetResolver({basePath: 'assets'});
        expect(r.resolve('hero', DeviceTier.HIGH)).toBe('assets/hero.png');
    });

    it('accepts custom basePath and extension', () => {
        const r = new AssetResolver({basePath: 'cdn/img', extension: '.webp'});
        expect(r.resolve('boss', DeviceTier.LOW)).toBe('cdn/img/boss@0.5x.webp');
    });

    it('accepts custom suffix overrides', () => {
        const r = new AssetResolver({
            basePath: 'dist',
            suffixes: {[DeviceTier.LOW]: '_lo', [DeviceTier.MID]: '_md', [DeviceTier.HIGH]: ''}
        });
        expect(r.resolve('hero', DeviceTier.LOW)).toBe('dist/hero_lo.png');
        expect(r.resolve('hero', DeviceTier.MID)).toBe('dist/hero_md.png');
    });

    it('strips trailing slashes from basePath', () => {
        const r = new AssetResolver({basePath: 'assets///'});
        expect(r.resolve('x', DeviceTier.HIGH)).toBe('assets/x.png');
    });

    it('warns on unknown tier and falls back to no suffix', () => {
        const spy = vi.spyOn(console, 'warn').mockImplementation(() => {
        });
        const r = new AssetResolver();
        const url = r.resolve('hero', 99);
        expect(url).toBe('assets/hero.png');
        expect(spy).toHaveBeenCalled();
        spy.mockRestore();
    });

    it('resolveAll returns array of {id, url}', () => {
        const r = new AssetResolver();
        const result = r.resolveAll(['a', 'b'], DeviceTier.LOW);
        expect(result).toHaveLength(2);
        expect(result[0]).toEqual({id: 'a', url: 'assets/a@0.5x.png'});
    });

    it('resolveSceneAssets preserves categories', () => {
        const r = new AssetResolver();
        const result = r.resolveSceneAssets([
            {id: 'bg', category: 'bg'},
            {id: 'hero', category: 'char'},
            {id: 'plain'}
        ], DeviceTier.MID);

        expect(result).toHaveLength(3);
        expect(result[0]).toEqual({id: 'bg', url: 'assets/bg@0.75x.png', category: 'bg'});
        expect(result[1]).toEqual({id: 'hero', url: 'assets/hero@0.75x.png', category: 'char'});
        expect(result[2]).toEqual({id: 'plain', url: 'assets/plain@0.75x.png'});
        expect(result[2]).not.toHaveProperty('category');
    });
});

describe('resolveTextureUrl (standalone)', () => {
    it('resolves correctly', () => {
        expect(resolveTextureUrl('hero', DeviceTier.LOW)).toBe('assets/hero@0.5x.png');
        expect(resolveTextureUrl('hero', DeviceTier.HIGH, 'cdn')).toBe('cdn/hero.png');
    });
});

// ══════════════════════════════════════════════════════════
//  MODULE: Presets
// ══════════════════════════════════════════════════════════

import {createSpriteCacheForTier, getTierDefaults, createCacheAuto} from '../index.js';

describe('Presets', () => {
    it('getTierDefaults returns correct budgets', () => {
        expect(getTierDefaults(DeviceTier.LOW).maxMemoryMB).toBe(48);
        expect(getTierDefaults(DeviceTier.MID).maxMemoryMB).toBe(96);
        expect(getTierDefaults(DeviceTier.HIGH).maxMemoryMB).toBe(192);
        expect(getTierDefaults('safe').maxMemoryMB).toBe(32);
        expect(getTierDefaults('ultra').maxMemoryMB).toBe(256);
    });

    it('getTierDefaults falls back to HIGH for unknown tier', () => {
        expect(getTierDefaults(999).maxMemoryMB).toBe(192);
    });

    it('createSpriteCacheForTier returns a cache with correct budget', () => {
        const cache = createSpriteCacheForTier(DeviceTier.LOW);
        expect(cache.stats().maxMemoryMB).toBe('48.00');
        cache.clearAll();
    });

    it('createSpriteCacheForTier accepts overrides', () => {
        const cache = createSpriteCacheForTier(DeviceTier.MID, {fetchTimeoutMs: 5000});
        expect(cache.stats().maxMemoryMB).toBe('96.00');
        cache.clearAll();
    });

    it('createCacheAuto returns cache and tier', () => {
        const {cache, tier} = createCacheAuto();
        expect(cache).toBeDefined();
        expect(tier).toHaveProperty('tier');
        expect(tier).toHaveProperty('tierName');
        expect(tier).toHaveProperty('signals');
        cache.clearAll();
    });
});

// ══════════════════════════════════════════════════════════
//  MODULE: VramManager
// ══════════════════════════════════════════════════════════

import {VramManager} from '../index.js';

describe('VramManager', () => {
    let cache, registry, manager;

    beforeEach(() => {
        cache = createSpriteCacheForTier(DeviceTier.LOW);
        registry = new CategoryRegistry();
    });

    afterEach(() => {
        if (manager) {
            manager.destroy();
            manager = null;
        }
        if (cache) {
            cache.clearAll();
            cache = null;
        }
    });

    it('throws if registry is not provided', () => {
        expect(() => new VramManager(cache)).toThrow('VramManager requires a CategoryRegistry');
        expect(() => new VramManager(cache, {})).toThrow('VramManager requires a CategoryRegistry');
        expect(() => new VramManager(cache, {registry: null})).toThrow();
    });

    it('constructs with registry', () => {
        manager = new VramManager(cache, {registry});
        expect(manager).toBeDefined();
    });

    it('start/stop are idempotent', () => {
        manager = new VramManager(cache, {registry});
        manager.start();
        manager.start(); // no error
        manager.stop();
        manager.stop(); // no error
    });

    it('pause/resume toggle isPaused', () => {
        manager = new VramManager(cache, {registry});
        expect(manager.isPaused).toBe(false);
        manager.pause();
        expect(manager.isPaused).toBe(true);
        manager.resume();
        expect(manager.isPaused).toBe(false);
    });

    it('isPressured starts false', () => {
        manager = new VramManager(cache, {registry});
        expect(manager.isPressured).toBe(false);
    });

    it('stats() returns complete snapshot', () => {
        manager = new VramManager(cache, {registry, highWatermark: 0.85});
        const s = manager.stats();

        expect(s).toHaveProperty('pressured', false);
        expect(s).toHaveProperty('paused', false);
        expect(s).toHaveProperty('usageRatio');
        expect(s).toHaveProperty('usagePercent');
        expect(s).toHaveProperty('highWatermark', 0.85);
        expect(s).toHaveProperty('lowWatermark');
        expect(s).toHaveProperty('panicWatermark');
        expect(s).toHaveProperty('registrySize', 0);
        expect(s).toHaveProperty('running', false);
    });

    it('stats().running reflects start/stop', () => {
        manager = new VramManager(cache, {registry});
        expect(manager.stats().running).toBe(false);
        manager.start();
        expect(manager.stats().running).toBe(true);
        manager.stop();
        expect(manager.stats().running).toBe(false);
    });

    it('check() can be called manually without error', () => {
        manager = new VramManager(cache, {registry});
        expect(() => manager.check()).not.toThrow();
    });

    it('destroy nullifies references', () => {
        manager = new VramManager(cache, {registry});
        manager.start();
        manager.destroy();
        expect(manager.cache).toBeNull();
        expect(manager.registry).toBeNull();
        manager = null; // prevent afterEach double-destroy
    });

    it('accepts custom watermarks', () => {
        manager = new VramManager(cache, {
            registry,
            highWatermark: 0.80,
            lowWatermark: 0.60,
            panicWatermark: 0.90
        });
        const s = manager.stats();
        expect(s.highWatermark).toBe(0.80);
        expect(s.lowWatermark).toBe(0.60);
        expect(s.panicWatermark).toBe(0.90);
    });
});

// ══════════════════════════════════════════════════════════
//  MODULE: SceneStreaming
// ══════════════════════════════════════════════════════════

import {
    loadScene,
    unloadScene,
    transitionScenes,
    cleanupPartialLoad
} from '../index.js';

describe('SceneStreaming', () => {
    // These tests need a mock SpriteCache since real cache.load() needs fetch
    let mockCache, registry;

    beforeEach(() => {
        registry = new CategoryRegistry();
        mockCache = {
            _items: new Map(),
            async load(id, url) {
                if (url.includes('fail')) return null;
                const bmp = {width: 10, height: 10, close: vi.fn()};
                this._items.set(id, bmp);
                return bmp;
            },
            async loadAll(assets) {
                return Promise.all(assets.map(a => this.load(a.id, a.url)));
            },
            get(id) {
                return this._items.get(id) || null;
            },
            dispose(id) {
                this._items.delete(id);
            },
            stats() {
                return {memoryMB: '0.00', maxMemoryMB: '48.00', items: this._items.size, pending: 0};
            },
            clearAll() {
                this._items.clear();
            }
        };
    });

    it('loadScene loads all assets and returns LoadResult', async () => {
        const scene = {
            name: 'test',
            assets: [
                {id: 'a', url: 'http://x/a.png', category: 'bg'},
                {id: 'b', url: 'http://x/b.png', category: 'char'},
            ]
        };

        const result = await loadScene(mockCache, scene, registry);

        expect(result.ok).toBe(true);
        expect(result.total).toBe(2);
        expect(result.loaded).toBe(2);
        expect(result.failed).toBe(0);
        expect(result.failures).toEqual([]);
    });

    it('loadScene registers categories before loading', async () => {
        const scene = {
            name: 'test',
            assets: [{id: 'hero', url: 'http://x/h.png', category: 'char'}]
        };

        await loadScene(mockCache, scene, registry);
        expect(registry.getCategory('hero')).toBe('char');
    });

    it('loadScene reports failures', async () => {
        const scene = {
            name: 'test',
            assets: [
                {id: 'ok', url: 'http://x/ok.png'},
                {id: 'bad', url: 'http://x/fail.png'},
            ]
        };

        const result = await loadScene(mockCache, scene);
        expect(result.ok).toBe(false);
        expect(result.failed).toBe(1);
        expect(result.failures).toEqual(['bad']);
    });

    it('unloadScene disposes all assets', async () => {
        const scene = {
            name: 'test',
            assets: [
                {id: 'a', url: 'http://x/a.png', category: 'bg'},
                {id: 'b', url: 'http://x/b.png', category: 'char'},
            ]
        };

        await loadScene(mockCache, scene, registry);
        expect(mockCache._items.size).toBe(2);
        expect(registry.size).toBe(2);

        unloadScene(mockCache, scene, registry);
        expect(mockCache._items.size).toBe(0);
        expect(registry.size).toBe(0);
    });

    it('transitionScenes unloads old then loads new', async () => {
        const sceneA = {
            name: 'A',
            assets: [{id: 'a1', url: 'http://x/a1.png', category: 'bg'}]
        };
        const sceneB = {
            name: 'B',
            assets: [{id: 'b1', url: 'http://x/b1.png', category: 'char'}]
        };

        await loadScene(mockCache, sceneA, registry);
        expect(mockCache._items.has('a1')).toBe(true);

        const result = await transitionScenes(mockCache, sceneA, sceneB, registry);

        expect(result.ok).toBe(true);
        expect(mockCache._items.has('a1')).toBe(false); // old scene gone
        expect(mockCache._items.has('b1')).toBe(true);  // new scene loaded
        expect(registry.has('a1')).toBe(false);
        expect(registry.has('b1')).toBe(true);
    });

    it('cleanupPartialLoad disposes only successful assets', async () => {
        const scene = {
            name: 'test',
            assets: [
                {id: 'ok1', url: 'http://x/ok1.png', category: 'bg'},
                {id: 'bad', url: 'http://x/fail.png', category: 'fx'},
                {id: 'ok2', url: 'http://x/ok2.png', category: 'char'},
            ]
        };

        const result = await loadScene(mockCache, scene, registry);
        expect(result.ok).toBe(false);
        expect(mockCache._items.size).toBe(2); // ok1 + ok2

        cleanupPartialLoad(mockCache, scene, result, registry);
        expect(mockCache._items.size).toBe(0);
        expect(registry.size).toBe(0);
    });
});

// ══════════════════════════════════════════════════════════
//  MODULE: AssetResolver + resolveTextureUrl edge cases
// ══════════════════════════════════════════════════════════

describe('AssetResolver edge cases', () => {
    it('resolveSceneAssets preserves order (map guarantee)', () => {
        const r = new AssetResolver();
        const input = [
            {id: 'z', category: 'bg'},
            {id: 'a', category: 'char'},
            {id: 'm', category: 'fx'},
        ];
        const result = r.resolveSceneAssets(input, DeviceTier.LOW);
        expect(result.map(x => x.id)).toEqual(['z', 'a', 'm']);
    });

    it('handles empty asset list', () => {
        const r = new AssetResolver();
        expect(r.resolveAll([], DeviceTier.HIGH)).toEqual([]);
        expect(r.resolveSceneAssets([], DeviceTier.LOW)).toEqual([]);
    });
});

// ══════════════════════════════════════════════════════════
//  MODULE: SafariStressTest
// ══════════════════════════════════════════════════════════

import {runSafariStressTest, runResolutionSweep} from '../index.js';

describe('runSafariStressTest', () => {
    // The stress test creates its own SpriteCache internally.
    // In a test environment with no server, cache.load() returns null,
    // which triggers the 'load-failed' stop reason on the first iteration.

    it('returns a valid StressTestResult structure', async () => {
        const spy = vi.spyOn(console, 'log').mockImplementation(() => {
        });
        const tableSpy = vi.spyOn(console, 'table').mockImplementation(() => {
        });

        const result = await runSafariStressTest('http://fake/texture.png', {
            iterations: 5,
            ceilingMB: 32,
            warmUpCount: 2
        });

        expect(result).toHaveProperty('iterations');
        expect(result).toHaveProperty('totalLoaded');
        expect(result).toHaveProperty('peakMemoryMB');
        expect(result).toHaveProperty('avgDurationMs');
        expect(result).toHaveProperty('baselineDurationMs');
        expect(result).toHaveProperty('stopReason');

        expect(Array.isArray(result.iterations)).toBe(true);
        expect(typeof result.totalLoaded).toBe('number');
        expect(typeof result.peakMemoryMB).toBe('number');
        expect(typeof result.avgDurationMs).toBe('number');
        expect(typeof result.baselineDurationMs).toBe('number');

        spy.mockRestore();
        tableSpy.mockRestore();
    });

    it('stops with load-failed when cache.load returns null', async () => {
        const spy = vi.spyOn(console, 'log').mockImplementation(() => {
        });
        const tableSpy = vi.spyOn(console, 'table').mockImplementation(() => {
        });

        const result = await runSafariStressTest('http://fake/texture.png', {
            iterations: 10,
            ceilingMB: 32
        });

        // No server → load() returns null → stopReason is 'load-failed'
        expect(result.stopReason).toBe('load-failed');
        expect(result.totalLoaded).toBe(0);
        expect(result.peakMemoryMB).toBe(0);

        spy.mockRestore();
        tableSpy.mockRestore();
    });

    it('iteration entries have correct shape', async () => {
        const spy = vi.spyOn(console, 'log').mockImplementation(() => {
        });
        const tableSpy = vi.spyOn(console, 'table').mockImplementation(() => {
        });

        const result = await runSafariStressTest('http://fake/texture.png', {
            iterations: 3,
            ceilingMB: 32
        });

        // At least one iteration should exist (the first one that failed)
        expect(result.iterations.length).toBeGreaterThanOrEqual(1);

        const first = result.iterations[0];
        expect(first).toHaveProperty('index', 0);
        expect(first).toHaveProperty('memoryMB');
        expect(first).toHaveProperty('durationMs');
        expect(first).toHaveProperty('ok');
        expect(typeof first.durationMs).toBe('number');
        expect(first.durationMs).toBeGreaterThanOrEqual(0);

        spy.mockRestore();
        tableSpy.mockRestore();
    });

    it('respects custom options', async () => {
        const spy = vi.spyOn(console, 'log').mockImplementation(() => {
        });
        const tableSpy = vi.spyOn(console, 'table').mockImplementation(() => {
        });

        const result = await runSafariStressTest('http://fake/texture.png', {
            iterations: 2,
            ceilingMB: 64,
            warmUpCount: 1,
            throttleMultiplier: 5
        });

        // Should complete (or fail) without throwing
        expect(result).toBeDefined();
        expect(['complete', 'load-failed', 'vram-limit', 'decode-throttle', 'error'])
            .toContain(result.stopReason);

        spy.mockRestore();
        tableSpy.mockRestore();
    });

    it('uses default options when none provided', async () => {
        const spy = vi.spyOn(console, 'log').mockImplementation(() => {
        });
        const tableSpy = vi.spyOn(console, 'table').mockImplementation(() => {
        });

        // Should not throw even with defaults (200 iterations, 512MB ceiling)
        // Will stop immediately on first load-failed in test env
        const result = await runSafariStressTest('http://fake/texture.png');

        expect(result.stopReason).toBe('load-failed');

        spy.mockRestore();
        tableSpy.mockRestore();
    });
});

describe('runResolutionSweep', () => {
    it('returns an array of resolution entries', async () => {
        const spy = vi.spyOn(console, 'log').mockImplementation(() => {
        });
        const tableSpy = vi.spyOn(console, 'table').mockImplementation(() => {
        });

        const results = await runResolutionSweep('http://fake/texture.png', {
            resolutions: [[256, 128], [512, 256]],
            iterationsPerRes: 2,
            ceilingMB: 32
        });

        expect(Array.isArray(results)).toBe(true);
        expect(results).toHaveLength(2);

        expect(results[0]).toHaveProperty('width', 256);
        expect(results[0]).toHaveProperty('height', 128);
        expect(results[0]).toHaveProperty('result');
        expect(results[0].result).toHaveProperty('stopReason');

        expect(results[1]).toHaveProperty('width', 512);
        expect(results[1]).toHaveProperty('height', 256);

        spy.mockRestore();
        tableSpy.mockRestore();
    });

    it('uses default resolutions when none provided', async () => {
        const spy = vi.spyOn(console, 'log').mockImplementation(() => {
        });
        const tableSpy = vi.spyOn(console, 'table').mockImplementation(() => {
        });

        const results = await runResolutionSweep('http://fake/texture.png', {
            iterationsPerRes: 1,
            ceilingMB: 16
        });

        // Default: 3 resolutions (512×256, 1024×512, 2048×1024)
        expect(results).toHaveLength(3);
        expect(results[0].width).toBe(512);
        expect(results[1].width).toBe(1024);
        expect(results[2].width).toBe(2048);

        spy.mockRestore();
        tableSpy.mockRestore();
    });
});

// ══════════════════════════════════════════════════════════
//  MODULE: VramHUD
// ══════════════════════════════════════════════════════════

import {VramHUD} from '../index.js';

describe('VramHUD', () => {
    let mockCache, hud;

    beforeEach(() => {
        mockCache = {
            stats() {
                return {memoryMB: '24.00', maxMemoryMB: '48.00', items: 10, pending: 0};
            }
        };
    });

    afterEach(() => {
        if (hud) {
            hud.destroy();
            hud = null;
        }
    });

    it('constructs and appends element to document.body', () => {
        hud = new VramHUD(mockCache, {mode: 'interval', intervalMs: 99999});

        expect(hud.el).toBeDefined();
        expect(hud.el.parentNode).toBe(document.body);
        expect(hud.el.style.position).toBe('fixed');
    });

    it('defaults to top-left position', () => {
        hud = new VramHUD(mockCache, {mode: 'interval', intervalMs: 99999});

        expect(hud.el.style.top).toBe('4px');
        expect(hud.el.style.left).toBe('4px');
    });

    it('respects position option', () => {
        hud = new VramHUD(mockCache, {position: 'bottom-right', mode: 'interval', intervalMs: 99999});

        expect(hud.el.style.bottom).toBe('4px');
        expect(hud.el.style.right).toBe('4px');
    });

    it('starts with peakMB = 0', () => {
        hud = new VramHUD(mockCache, {mode: 'interval', intervalMs: 99999});
        expect(hud.peakMB).toBe(0);
    });

    it('tracks display mode', () => {
        hud = new VramHUD(mockCache, {display: 'compact', mode: 'interval', intervalMs: 99999});
        expect(hud.display).toBe('compact');
    });

    it('tracks mode', () => {
        hud = new VramHUD(mockCache, {mode: 'interval', intervalMs: 99999});
        expect(hud.mode).toBe('interval');
    });

    it('resetPeak reads current usage', () => {
        hud = new VramHUD(mockCache, {mode: 'interval', intervalMs: 99999});
        hud.peakMB = 100;
        hud.resetPeak();
        expect(hud.peakMB).toBe(24); // parseFloat('24.00')
    });

    it('destroy removes element and clears references', () => {
        hud = new VramHUD(mockCache, {mode: 'interval', intervalMs: 100});

        const el = hud.el;
        expect(el.parentNode).toBe(document.body);

        hud.destroy();
        expect(el.parentNode).toBeNull();
        expect(hud.cache).toBeNull();
        expect(hud.manager).toBeNull();
        expect(hud._timer).toBeNull();
        hud = null; // prevent afterEach double-destroy
    });

    it('destroy is idempotent', () => {
        hud = new VramHUD(mockCache, {mode: 'interval', intervalMs: 99999});
        hud.destroy();
        expect(() => hud.destroy()).not.toThrow();
        hud = null;
    });

    it('interval mode creates a timer', () => {
        hud = new VramHUD(mockCache, {mode: 'interval', intervalMs: 200});
        expect(hud._timer).not.toBeNull();
        expect(hud._rafId).toBeNull();
    });

    it('raf mode creates a rafId', () => {
        hud = new VramHUD(mockCache, {mode: 'raf'});
        expect(hud._rafId).not.toBeNull();
        expect(hud._timer).toBeNull();
    });

    it('accepts a manager reference', () => {
        const mockManager = {
            isPressured: false,
            stats() {
                return {pressured: false, paused: false, usagePercent: '50.0'};
            }
        };
        hud = new VramHUD(mockCache, {manager: mockManager, mode: 'interval', intervalMs: 99999});
        expect(hud.manager).toBe(mockManager);
    });

    it('renders full display text with all fields', () => {
        hud = new VramHUD(mockCache, {display: 'full', mode: 'interval', intervalMs: 99999});

        // Manually trigger a render to populate textContent
        hud._render();

        const text = hud.el.textContent;
        expect(text).toContain('VRAM');
        expect(text).toContain('24.00');
        expect(text).toContain('48.00');
        expect(text).toContain('cached');
        expect(text).toContain('pending');
        expect(text).toContain('Peak');
    });

    it('renders compact display text', () => {
        hud = new VramHUD(mockCache, {display: 'compact', mode: 'interval', intervalMs: 99999});

        hud._render();

        const text = hud.el.textContent;
        expect(text).toContain('VRAM');
        expect(text).toContain('24.00');
        expect(text).toContain('48.00');
        expect(text).toContain('%');
    });

    it('color codes green when usage < 70%', () => {
        hud = new VramHUD(mockCache, {mode: 'interval', intervalMs: 99999});
        hud._render();
        expect(hud.el.style.color).toBe('rgb(0, 255, 0)'); // 🔧 Changed from '#0f0'
    });

    it('color codes amber when usage > 70%', () => {
        const highCache = { stats: () => ({memoryMB: '36.00', maxMemoryMB: '48.00', items: 10, pending: 0}) };
        hud = new VramHUD(highCache, {mode: 'interval', intervalMs: 99999});
        hud._render();
        expect(hud.el.style.color).toBe('rgb(255, 170, 0)'); // 🔧 Changed from '#fa0'
    });

    it('color codes red when usage > 90%', () => {
        const criticalCache = { stats: () => ({memoryMB: '44.00', maxMemoryMB: '48.00', items: 10, pending: 0}) };
        hud = new VramHUD(criticalCache, {mode: 'interval', intervalMs: 99999});
        hud._render();
        expect(hud.el.style.color).toBe('rgb(255, 68, 68)'); // 🔧 Changed from '#f44'
    });

    it('updates peakMB on render when usage exceeds previous peak', () => {
        hud = new VramHUD(mockCache, {mode: 'interval', intervalMs: 99999});
        expect(hud.peakMB).toBe(0);
        hud._render();
        expect(hud.peakMB).toBe(24); // 24.00 > 0
    });
});
// ══════════════════════════════════════════════════════════
//  MODULE: Watermarks (v1.1)
// ══════════════════════════════════════════════════════════

import {WATERMARKS, getWatermarksForTier} from '../index.js';

describe('Watermarks (v1.1)', () => {
    it('exposes WATERMARKS keyed by tier', () => {
        expect(WATERMARKS).toHaveProperty('safe');
        expect(WATERMARKS).toHaveProperty([DeviceTier.LOW]);
        expect(WATERMARKS).toHaveProperty([DeviceTier.MID]);
        expect(WATERMARKS).toHaveProperty([DeviceTier.HIGH]);
        expect(WATERMARKS).toHaveProperty('ultra');
    });

    it('every preset has high < panic with at least 11pp gap', () => {
        for (const key of ['safe', DeviceTier.LOW, DeviceTier.MID, DeviceTier.HIGH, 'ultra']) {
            const wm = WATERMARKS[key];
            expect(wm.high).toBeLessThan(wm.panic);
            // Use rounded gap to avoid IEEE 754 surprises (0.96 − 0.85 = 0.10999…)
            const gapPP = Math.round((wm.panic - wm.high) * 100);
            expect(gapPP).toBeGreaterThanOrEqual(11);
            expect(wm.low).toBeLessThan(wm.high);
        }
    });

    it('HIGH tier has 11pp gap (was 5pp in v1.0.x — primary v1.1 fix)', () => {
        const high = WATERMARKS[DeviceTier.HIGH];
        // v1.0.x: high=0.90, panic=0.95 → 5pp gap, caused hysteresis collapse.
        // v1.1:   high=0.85, panic=0.96 → 11pp gap.
        expect(high.high).toBe(0.85);
        expect(high.panic).toBe(0.96);
        expect(high.checkIntervalMs).toBeLessThanOrEqual(1000);
    });

    it('LOW tier polls fastest (most aggressive devices)', () => {
        const low = WATERMARKS[DeviceTier.LOW];
        const high = WATERMARKS[DeviceTier.HIGH];
        expect(low.checkIntervalMs).toBeLessThanOrEqual(high.checkIntervalMs);
    });

    it('safe preset has fastest polling and tightest watermarks', () => {
        const safe = WATERMARKS.safe;
        expect(safe.checkIntervalMs).toBeLessThanOrEqual(500);
        expect(safe.high).toBeLessThanOrEqual(0.80);
    });

    it('getWatermarksForTier returns config for known tiers (VramManager-shaped)', () => {
        const wm = getWatermarksForTier(DeviceTier.MID);
        expect(wm).toHaveProperty('highWatermark');
        expect(wm).toHaveProperty('lowWatermark');
        expect(wm).toHaveProperty('panicWatermark');
        expect(wm).toHaveProperty('checkIntervalMs');
    });

    it('getWatermarksForTier output spreads cleanly into VramManager', () => {
        // Regression guard: the helper output MUST match the constructor's
        // named parameters exactly. Any rename on either side breaks this.
        const cache = createSpriteCacheForTier(DeviceTier.LOW);
        const registry = new CategoryRegistry();
        const wm = getWatermarksForTier(DeviceTier.LOW);
        const manager = new VramManager(cache, { registry, ...wm });
        const s = manager.stats();

        // Values must come from WATERMARKS[LOW], not constructor defaults.
        expect(s.highWatermark).toBe(WATERMARKS[DeviceTier.LOW].high);
        expect(s.lowWatermark).toBe(WATERMARKS[DeviceTier.LOW].low);
        expect(s.panicWatermark).toBe(WATERMARKS[DeviceTier.LOW].panic);
        expect(manager.checkIntervalMs).toBe(WATERMARKS[DeviceTier.LOW].checkIntervalMs);

        manager.destroy();
        cache.clearAll();
    });

    it('getWatermarksForTier returns a fresh copy (mutation-safe)', () => {
        const wm1 = getWatermarksForTier(DeviceTier.MID);
        wm1.highWatermark = 0.99;
        const wm2 = getWatermarksForTier(DeviceTier.MID);
        expect(wm2.highWatermark).not.toBe(0.99);
    });

    it('getWatermarksForTier falls back to HIGH for unknown', () => {
        const wm = getWatermarksForTier(999);
        const high = WATERMARKS[DeviceTier.HIGH];
        expect(wm.highWatermark).toBe(high.high);
        expect(wm.panicWatermark).toBe(high.panic);
    });

    it('WATERMARKS object is frozen', () => {
        expect(Object.isFrozen(WATERMARKS)).toBe(true);
        expect(Object.isFrozen(WATERMARKS[DeviceTier.HIGH])).toBe(true);
    });
});

// ══════════════════════════════════════════════════════════
//  MODULE: VramManager — v1.1 Hysteresis Fix (B1)
// ══════════════════════════════════════════════════════════

describe('VramManager v1.1 hysteresis fix', () => {
    let cache, registry, manager;

    beforeEach(() => {
        cache = createSpriteCacheForTier(DeviceTier.LOW);
        registry = new CategoryRegistry();
    });

    afterEach(() => {
        if (manager) { manager.destroy(); manager = null; }
        if (cache)   { cache.clearAll();    cache = null; }
    });

    it('throws on inverted watermarks (panic ≤ high)', () => {
        expect(() => new VramManager(cache, {
            registry, highWatermark: 0.95, panicWatermark: 0.90
        })).toThrow(/low < high < panic/);
    });

    it('throws on inverted watermarks (high ≤ low)', () => {
        expect(() => new VramManager(cache, {
            registry, highWatermark: 0.50, lowWatermark: 0.60
        })).toThrow(/low < high < panic/);
    });

    it('throws on equal watermarks', () => {
        expect(() => new VramManager(cache, {
            registry, highWatermark: 0.85, panicWatermark: 0.85
        })).toThrow(/low < high < panic/);
    });

    it('uses v1.1 defaults: high=0.85, panic=0.96, interval=1000ms', () => {
        manager = new VramManager(cache, {registry});
        const s = manager.stats();
        expect(s.highWatermark).toBe(0.85);
        expect(s.lowWatermark).toBe(0.70);
        expect(s.panicWatermark).toBe(0.96);
        expect(manager.checkIntervalMs).toBe(1000);
    });

    it('onPressure does NOT fire when system jumps straight to panic (v1.1 bug fix)', () => {
        // Mock a cache that reports usage above panicWatermark immediately.
        const fakeCache = {
            stats: () => ({memoryMB: '100.00', maxMemoryMB: '100.00'}), // 100% usage
            unloadUnused: vi.fn(),
            get: () => undefined,
            dispose: vi.fn()
        };
        const onPressure = vi.fn();
        const onPanic = vi.fn();

        manager = new VramManager(fakeCache, {
            registry, onPressure, onPanic,
            highWatermark: 0.85, panicWatermark: 0.96
        });
        manager.check(); // trigger one tick

        // The whole point of v1.1: jumping straight to panic must NOT
        // double-count as a pressure event. onPressure should stay 0.
        expect(onPanic).toHaveBeenCalledTimes(1);
        expect(onPressure).not.toHaveBeenCalled();
        manager = null;
    });

    it('onPressure fires when usage gracefully crosses high watermark (no panic)', () => {
        let usage = 0.50;
        const fakeCache = {
            stats: () => ({memoryMB: String(usage * 100), maxMemoryMB: '100.00'}),
            unloadUnused: vi.fn(),
            get: () => undefined,
            dispose: vi.fn()
        };
        const onPressure = vi.fn();
        const onPanic = vi.fn();

        manager = new VramManager(fakeCache, {
            registry, onPressure, onPanic,
            highWatermark: 0.85, panicWatermark: 0.96
        });

        // First tick: usage 50% — below high watermark, no callbacks
        manager.check();
        expect(onPressure).not.toHaveBeenCalled();
        expect(onPanic).not.toHaveBeenCalled();

        // Second tick: usage 90% — above high but below panic
        usage = 0.90;
        manager.check();
        expect(onPressure).toHaveBeenCalledTimes(1);
        expect(onPanic).not.toHaveBeenCalled();
        manager = null;
    });

    it('onPressure fires only ONCE while staying pressured (no spam)', () => {
        let usage = 0.50;
        const fakeCache = {
            stats: () => ({memoryMB: String(usage * 100), maxMemoryMB: '100.00'}),
            unloadUnused: vi.fn(),
            get: () => undefined,
            dispose: vi.fn()
        };
        const onPressure = vi.fn();

        manager = new VramManager(fakeCache, {
            registry, onPressure,
            highWatermark: 0.85, panicWatermark: 0.96
        });

        usage = 0.90;
        manager.check();
        manager.check();
        manager.check();
        expect(onPressure).toHaveBeenCalledTimes(1);
        manager = null;
    });

    it('onRelief fires when crossing back below low watermark', () => {
        let usage = 0.90;
        const fakeCache = {
            stats: () => ({memoryMB: String(usage * 100), maxMemoryMB: '100.00'}),
            unloadUnused: vi.fn(),
            get: () => undefined,
            dispose: vi.fn()
        };
        const onPressure = vi.fn();
        const onRelief = vi.fn();

        manager = new VramManager(fakeCache, {
            registry, onPressure, onRelief,
            highWatermark: 0.85, lowWatermark: 0.70, panicWatermark: 0.96
        });

        manager.check();
        expect(onPressure).toHaveBeenCalledTimes(1);

        usage = 0.60;
        manager.check();
        expect(onRelief).toHaveBeenCalledTimes(1);
        manager = null;
    });

    it('onPanic can fire repeatedly (it is a tick-event, not a transition)', () => {
        const fakeCache = {
            stats: () => ({memoryMB: '99.00', maxMemoryMB: '100.00'}),
            unloadUnused: vi.fn(),
            get: () => undefined,
            dispose: vi.fn()
        };
        const onPanic = vi.fn();

        manager = new VramManager(fakeCache, {
            registry, onPanic,
            highWatermark: 0.85, panicWatermark: 0.96
        });

        manager.check();
        manager.check();
        manager.check();
        expect(onPanic).toHaveBeenCalledTimes(3);
        manager = null;
    });
});

// ══════════════════════════════════════════════════════════
//  MODULE: SafariStressTest — v1.1 Improvements (B2)
// ══════════════════════════════════════════════════════════

describe('SafariStressTest v1.1 result shape', () => {
    it('result includes histogram with 5 percentiles', async () => {
        const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
        const tableSpy = vi.spyOn(console, 'table').mockImplementation(() => {});

        const result = await runSafariStressTest('http://fake/x.png', {
            iterations: 3, ceilingMB: 32
        });

        expect(result).toHaveProperty('histogram');
        expect(result.histogram).toHaveProperty('p50');
        expect(result.histogram).toHaveProperty('p75');
        expect(result.histogram).toHaveProperty('p90');
        expect(result.histogram).toHaveProperty('p95');
        expect(result.histogram).toHaveProperty('p99');

        spy.mockRestore();
        tableSpy.mockRestore();
    });

    it('result includes gcPauseCount and visibilityPauseCount', async () => {
        const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
        const tableSpy = vi.spyOn(console, 'table').mockImplementation(() => {});

        const result = await runSafariStressTest('http://fake/x.png', {
            iterations: 3, ceilingMB: 32
        });

        expect(result).toHaveProperty('gcPauseCount');
        expect(result).toHaveProperty('visibilityPauseCount');
        expect(typeof result.gcPauseCount).toBe('number');
        expect(typeof result.visibilityPauseCount).toBe('number');
        expect(result.gcPauseCount).toBeGreaterThanOrEqual(0);
        expect(result.visibilityPauseCount).toBeGreaterThanOrEqual(0);

        spy.mockRestore();
        tableSpy.mockRestore();
    });

    it('iteration entries include classification field', async () => {
        const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
        const tableSpy = vi.spyOn(console, 'table').mockImplementation(() => {});

        const result = await runSafariStressTest('http://fake/x.png', {
            iterations: 3, ceilingMB: 32
        });

        const first = result.iterations[0];
        expect(first).toHaveProperty('classification');
        expect(['normal', 'gc-pause', 'throttle', 'ignored']).toContain(first.classification);

        spy.mockRestore();
        tableSpy.mockRestore();
    });

    it('accepts new v1.1 options without throwing', async () => {
        const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
        const tableSpy = vi.spyOn(console, 'table').mockImplementation(() => {});

        const result = await runSafariStressTest('http://fake/x.png', {
            iterations: 2,
            ceilingMB: 32,
            slowWindow: 7,
            slowThreshold: 4,
            visibilityResumeMs: 250
        });

        expect(result).toBeDefined();
        spy.mockRestore();
        tableSpy.mockRestore();
    });
});

// ══════════════════════════════════════════════════════════
//  MODULE: DeviceTier — v1.1 iPad Mac-spoof Fix (B3)
// ══════════════════════════════════════════════════════════

describe('DeviceTier v1.1 iPad Mac-spoofed UA', () => {
    let originalUA, originalMaxTouch, originalDeviceMemory;

    beforeEach(() => {
        originalUA = navigator.userAgent;
        originalMaxTouch = navigator.maxTouchPoints;
        originalDeviceMemory = navigator.deviceMemory;
    });

    afterEach(() => {
        Object.defineProperty(navigator, 'userAgent', {
            value: originalUA, configurable: true
        });
        Object.defineProperty(navigator, 'maxTouchPoints', {
            value: originalMaxTouch, configurable: true
        });
        if (originalDeviceMemory !== undefined) {
            Object.defineProperty(navigator, 'deviceMemory', {
                value: originalDeviceMemory, configurable: true
            });
        } else {
            delete navigator.deviceMemory;
        }
    });

    it('parses iOS version from Safari Version/X token on Mac-spoofed iPad', () => {
        // iPadOS 17 reports Mac UA with Version/17.x
        Object.defineProperty(navigator, 'userAgent', {
            value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
            configurable: true
        });
        Object.defineProperty(navigator, 'maxTouchPoints', {
            value: 5, configurable: true
        });
        delete navigator.deviceMemory;

        const result = detectDeviceTier();

        // The iOS version should be parsed from "Version/17" — not 0.
        expect(result.signals.iOSVersion).toBe(17);
        expect(result.signals.isIOS).toBe(true);
        expect(result.signals.isIPad).toBe(true);
        // 17 ≥ 17 → HIGH tier with proper reason (not "iOS ?")
        expect(result.tier).toBe(DeviceTier.HIGH);
        expect(result.signals.reason).toMatch(/iOS 17/);
    });

    it('iPad Air 2 (Safari 15) maps to LOW with version 15 (not 0)', () => {
        // Replicates report #38 in the analysis dataset.
        Object.defineProperty(navigator, 'userAgent', {
            value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.6.8 Safari/605.1.15',
            configurable: true
        });
        Object.defineProperty(navigator, 'maxTouchPoints', {
            value: 5, configurable: true
        });
        delete navigator.deviceMemory;

        const result = detectDeviceTier();

        expect(result.signals.iOSVersion).toBe(15);
        expect(result.tier).toBe(DeviceTier.LOW);
        // Reason must NOT contain "iOS ?" — that's the v1.0.x bug.
        expect(result.signals.reason).not.toMatch(/iOS \?/);
    });

    it('classic iPhone UA still parses iOS version from CPU OS token (no regression)', () => {
        Object.defineProperty(navigator, 'userAgent', {
            value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.7 Mobile/15E148 Safari/604.1',
            configurable: true
        });
        delete navigator.deviceMemory;

        const result = detectDeviceTier();
        expect(result.signals.iOSVersion).toBe(18);
        expect(result.tier).toBe(DeviceTier.HIGH);
    });
});
