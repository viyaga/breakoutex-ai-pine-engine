// ================================================================
// BreakoutEx AI — Pine Script Cache
//
// Prevents repeatedly parsing/normalizing the same Pine source.
//
// IMPORTANT:
// This cache does NOT cache trade results.
// It only caches immutable script-level information.
// ================================================================

export interface CachedPineScript {

    source: string;

    normalizedSource: string;

    hash: string;

    createdAt: number;
}

export class PineScriptCache {

    private readonly cache =
        new Map<string, CachedPineScript>();

    get(
        source: string
    ): CachedPineScript | undefined {

        const hash =
            PineScriptCache.hash(
                source
            );

        return this.cache.get(
            hash
        );
    }

    getOrCreate(
        source: string
    ): CachedPineScript {

        const hash =
            PineScriptCache.hash(
                source
            );

        const existing =
            this.cache.get(
                hash
            );

        if (
            existing
        ) {

            return existing;
        }

        const cached: CachedPineScript = {

            source,

            normalizedSource:
                source.trim(),

            hash,

            createdAt:
                Date.now(),
        };

        this.cache.set(
            hash,
            cached
        );

        return cached;
    }

    clear(): void {

        this.cache.clear();
    }

    size(): number {

        return this.cache.size;
    }

    // ------------------------------------------------------------
    // Fast non-cryptographic hash.
    //
    // This is only a cache key.
    // It is NOT intended for security.
    // ------------------------------------------------------------

    private static hash(
        value: string
    ): string {

        let hash = 2166136261;

        for (
            let i = 0;
            i < value.length;
            i++
        ) {

            hash ^=
                value.charCodeAt(i);

            hash +=
                (
                    hash << 1
                ) +
                (
                    hash << 4
                ) +
                (
                    hash << 7
                ) +
                (
                    hash << 8
                ) +
                (
                    hash << 24
                );
        }

        return (
            hash >>> 0
        ).toString(16);
    }
}
