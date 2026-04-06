export interface AssetResolverOptions {
    basePath?: string;
    extension?: string;
    /** Override tier → suffix mapping. */
    suffixes?: Record<number, string>;
}

export declare class AssetResolver {
    constructor(options?: AssetResolverOptions);

    /** Resolves a logical asset ID to a tier-appropriate URL. */
    resolve(id: string, tier: number): string;

    /** Bulk-resolves IDs into `{ id, url }` descriptors. */
    resolveAll(ids: string[], tier: number): Array<{ id: string; url: string }>;

    /**
     * Resolves scene assets with categories preserved.
     * Returns descriptors ready for `loadScene()`.
     */
    resolveSceneAssets(
        assets: Array<{ id: string; category?: string }>,
        tier: number
    ): Array<{ id: string; url: string; category?: string }>;
}

/** Standalone one-off resolution. */
export declare function resolveTextureUrl(id: string, tier: number, basePath?: string): string;
