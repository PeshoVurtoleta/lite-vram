export declare const AssetCategory: {
    readonly TEMP: 'temp';
    readonly FX:   'fx';
    readonly BG:   'bg';
    readonly CHAR: 'char';
    readonly UI:   'ui';
};

/**
 * Eviction priority order. Lower index = evicted first.
 * UI is absent — immune to priority-based eviction.
 */
export declare const EVICTION_ORDER: readonly string[];

export declare class CategoryRegistry {
    constructor();

    /** Number of registered assets. */
    readonly size: number;

    /**
     * Tags an asset with a category.
     * Invalid categories are coerced to TEMP with a console warning.
     */
    register(id: string, category: string): void;

    /** Registers multiple assets at once. */
    registerBatch(assets: Array<{ id: string; category: string }>): void;

    /** Returns the category, or `undefined` if unregistered. */
    getCategory(id: string): string | undefined;

    /** Returns true if the ID is registered. */
    has(id: string): boolean;

    /** Returns true if the asset can be evicted (false for UI). */
    isEvictable(id: string): boolean;

    /**
     * Returns the eviction bucket index for a category.
     * Lower = evicted first. Returns -1 for UI or unknown.
     */
    getEvictionBucket(category: string): number;

    /** Removes an asset's registration. */
    unregister(id: string): void;

    /**
     * Returns all IDs sorted by eviction priority.
     * TEMP first, CHAR last, UI excluded.
     */
    getIdsByPriority(): string[];

    /** Returns all IDs under a specific category. */
    getIdsByCategory(category: string): string[];

    /** Returns all entries as [id, category] pairs. */
    getAll(): Array<[string, string]>;

    /** Clears all registrations. */
    clear(): void;
}
