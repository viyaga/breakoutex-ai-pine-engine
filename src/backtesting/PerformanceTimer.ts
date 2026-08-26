// ================================================================
// BreakoutEx AI — Performance Timer
// ================================================================

export interface PerformanceTiming {

    totalMs: number;

    dataPreparationMs: number;

    simulationMs: number;

    metricsMs: number;

    validationMs: number;

    barsProcessed?: number;

    barsPerSecond?: number;
}

export class PerformanceTimer {

    private readonly start =
        PerformanceTimer.now();

    private marks =
        new Map<string, number>();

    mark(
        name: string
    ): void {

        this.marks.set(
            name,
            PerformanceTimer.now()
        );
    }

    elapsedFrom(
        markName: string
    ): number {

        const mark =
            this.marks.get(
                markName
            );

        if (
            mark === undefined
        ) {

            return 0;
        }

        return (
            PerformanceTimer.now() -
            mark
        );
    }

    total(): number {

        return (
            PerformanceTimer.now() -
            this.start
        );
    }

    static now(): number {

        if (
            typeof performance !==
            'undefined'
        ) {

            return performance.now();
        }

        return Date.now();
    }
}
