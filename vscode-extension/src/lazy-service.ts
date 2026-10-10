export type LazyServiceState = 'idle' | 'starting' | 'running';

export class LazyService {
    private startPromise: Promise<void> | undefined;
    private currentState: LazyServiceState = 'idle';

    constructor(private readonly onStateChange?: (state: LazyServiceState) => void) {}

    get state(): LazyServiceState {
        return this.currentState;
    }

    ensureStarted(start: () => Promise<void>): Promise<void> {
        if (this.currentState === 'running') {
            return Promise.resolve();
        }

        if (this.startPromise) {
            return this.startPromise;
        }

        this.setState('starting');
        this.startPromise = Promise.resolve()
            .then(start)
            .then(() => {
                this.setState('running');
            })
            .catch(error => {
                this.setState('idle');
                throw error;
            })
            .finally(() => {
                this.startPromise = undefined;
            });

        return this.startPromise;
    }

    reset(): void {
        this.startPromise = undefined;
        this.setState('idle');
    }

    private setState(state: LazyServiceState): void {
        this.currentState = state;
        this.onStateChange?.(state);
    }
}
