export type ProjectDetector = () => Promise<boolean>;
export type PrewarmStarter = () => void;

export class LanguageServicePrewarm {
    private generation = 0;
    private timer: ReturnType<typeof setTimeout> | undefined;
    private disposed = false;

    constructor(
        private readonly detectProject: ProjectDetector,
        private readonly start: PrewarmStarter,
        private readonly delayMs = 250,
        private readonly reportError: (error: unknown) => void = () => {},
    ) {}

    schedule(): void {
        if (this.disposed) {
            return;
        }

        this.cancelPending();
        const generation = this.generation;

        void this.detectProject()
            .then(projectFound => {
                if (!projectFound || this.disposed || generation !== this.generation) {
                    return;
                }

                this.timer = setTimeout(() => {
                    this.timer = undefined;
                    if (!this.disposed && generation === this.generation) {
                        this.start();
                    }
                }, this.delayMs);
            })
            .catch(error => {
                if (!this.disposed && generation === this.generation) {
                    this.reportError(error);
                }
            });
    }

    cancel(): void {
        if (this.disposed) {
            return;
        }

        this.cancelPending();
    }

    dispose(): void {
        if (this.disposed) {
            return;
        }

        this.cancelPending();
        this.disposed = true;
    }

    private cancelPending(): void {
        this.generation += 1;
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = undefined;
        }
    }
}
