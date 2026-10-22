export interface ThreadStreamStabilitySnapshot {
  windowMs: number;
  eventCount: number;
  invalidEventCount: number;
  reductionFailureCount: number;
  threadCount: number;
}

interface ThreadStreamStabilityDiagnosticsOptions {
  windowMs: number;
  warningThreshold: number;
  now: () => number;
  onWarning: (snapshot: ThreadStreamStabilitySnapshot) => void;
}

export class ThreadStreamStabilityDiagnostics {
  private windowStartedAt: number;
  private eventCount = 0;
  private invalidEventCount = 0;
  private reductionFailureCount = 0;
  private readonly threadIds = new Set<string>();

  public constructor(
    private readonly options: ThreadStreamStabilityDiagnosticsOptions
  ) {
    this.windowStartedAt = options.now();
  }

  public recordEvent(threadId: string): void {
    this.rollWindowIfNeeded();
    this.eventCount += 1;
    this.threadIds.add(threadId);
  }

  public recordInvalidEvent(threadId: string | null | undefined): boolean {
    this.rollWindowIfNeeded();
    const shouldLogDetail = this.invalidEventCount === 0;
    this.eventCount += 1;
    this.invalidEventCount += 1;
    if (threadId) this.threadIds.add(threadId);
    return shouldLogDetail;
  }

  public recordReductionFailure(threadId: string): boolean {
    this.rollWindowIfNeeded();
    const shouldLogDetail = this.reductionFailureCount === 0;
    this.reductionFailureCount += 1;
    this.threadIds.add(threadId);
    return shouldLogDetail;
  }

  private rollWindowIfNeeded(): void {
    const now = this.options.now();
    if (now - this.windowStartedAt < this.options.windowMs) return;

    if (
      this.eventCount >= this.options.warningThreshold ||
      this.invalidEventCount > 0 ||
      this.reductionFailureCount > 0
    ) {
      this.options.onWarning({
        windowMs: this.options.windowMs,
        eventCount: this.eventCount,
        invalidEventCount: this.invalidEventCount,
        reductionFailureCount: this.reductionFailureCount,
        threadCount: this.threadIds.size
      });
    }

    this.windowStartedAt = now;
    this.eventCount = 0;
    this.invalidEventCount = 0;
    this.reductionFailureCount = 0;
    this.threadIds.clear();
  }
}
