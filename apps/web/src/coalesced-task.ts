export class CoalescedTask {
    private timer: number | null = null;
    private running = false;
    private pending = false;

    public constructor(
        private readonly task: () => Promise<void>,
        private readonly delayMs: number
    ) {}

    public schedule(): void {
        if (this.running || this.timer !== null) {
            this.pending = true;
            return;
        }
        this.timer = window.setTimeout(() => {
            this.timer = null;
            this.pending = false;
            void this.run();
        }, this.delayMs);
    }

    public cancel(): void {
        if (this.timer !== null) {
            window.clearTimeout(this.timer);
            this.timer = null;
        }
        this.pending = false;
    }

    private async run(): Promise<void> {
        this.running = true;
        try {
            await this.task();
        } finally {
            this.running = false;
            if (this.pending) {
                this.pending = false;
                this.schedule();
            }
        }
    }
}
