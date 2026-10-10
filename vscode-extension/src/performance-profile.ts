import { performance } from 'node:perf_hooks';

export interface PerformanceEntry {
    name: string;
    durationMs: number;
}

export class PerformanceProfile {
    private readonly startedAt: number;
    private lastCheckpoint: number;
    private finishedAt: number | undefined;
    private readonly entries: PerformanceEntry[] = [];

    constructor(
        private readonly label: string,
        private readonly now: () => number = () => performance.now(),
    ) {
        this.startedAt = this.now();
        this.lastCheckpoint = this.startedAt;
    }

    checkpoint(name: string): void {
        const current = this.now();
        this.entries.push({ name, durationMs: current - this.lastCheckpoint });
        this.lastCheckpoint = current;
    }

    async measure<T>(name: string, action: () => Promise<T>): Promise<T> {
        const startedAt = this.now();
        try {
            return await action();
        } finally {
            this.entries.push({ name, durationMs: this.now() - startedAt });
        }
    }

    measureSync<T>(name: string, action: () => T): T {
        const startedAt = this.now();
        try {
            return action();
        } finally {
            this.entries.push({ name, durationMs: this.now() - startedAt });
        }
    }

    finish(name?: string): void {
        const current = this.now();
        if (name) {
            this.entries.push({ name, durationMs: current - this.lastCheckpoint });
            this.lastCheckpoint = current;
        }
        this.finishedAt = current;
    }

    snapshot(): { label: string; totalMs: number; entries: PerformanceEntry[] } {
        return {
            label: this.label,
            totalMs: (this.finishedAt ?? this.now()) - this.startedAt,
            entries: [...this.entries],
        };
    }

    render(): string {
        const snapshot = this.snapshot();
        return [
            `${snapshot.label}: ${formatDuration(snapshot.totalMs)}`,
            ...snapshot.entries.map(entry => `- ${entry.name}: ${formatDuration(entry.durationMs)}`),
        ].join('\n');
    }
}

function formatDuration(durationMs: number): string {
    return `${durationMs.toFixed(1)} ms`;
}
