/** A place in the queue, handed out before any work is registered so a full queue refuses early. */
export interface QueueSlot {
  /** Runs `job` when a worker is free. Errors are the job's business: the queue only logs them. */
  run(job: () => Promise<unknown>): void;
  /** Gives the slot back when the job could not be created. */
  release(): void;
}

export interface RunQueueOptions {
  /** Jobs executing at the same time. */
  concurrency: number;
  /** Jobs allowed to wait for a free worker. */
  maxQueued: number;
  onError?: (error: unknown) => void;
}

/** A bounded in-memory job queue: at most `concurrency` running and `maxQueued` waiting. */
export class RunQueue {
  private running = 0;
  private reserved = 0;
  private readonly waiting: Array<() => void> = [];
  private readonly active = new Set<Promise<unknown>>();
  private closed = false;

  constructor(private readonly options: RunQueueOptions) {}

  /** Jobs running or waiting (reserved slots included). */
  get size(): number {
    return this.running + this.waiting.length + this.reserved;
  }

  /** Reserves a place, or returns null when the queue is full or closed. */
  reserve(): QueueSlot | null {
    if (this.closed || this.size >= this.options.concurrency + this.options.maxQueued) {
      return null;
    }
    this.reserved += 1;
    let used = false;
    return {
      run: (job) => {
        if (used) return;
        used = true;
        this.reserved -= 1;
        this.start(job);
      },
      release: () => {
        if (used) return;
        used = true;
        this.reserved -= 1;
      }
    };
  }

  /** Stops accepting jobs and waits for the ones running or waiting to finish. */
  async close(): Promise<void> {
    this.closed = true;
    while (this.active.size > 0 || this.waiting.length > 0) {
      await Promise.allSettled([...this.active]);
    }
  }

  private start(job: () => Promise<unknown>): void {
    const execute = (): void => {
      this.running += 1;
      const promise = job()
        .catch((error: unknown) => this.options.onError?.(error))
        .finally(() => {
          this.running -= 1;
          this.active.delete(promise);
          this.waiting.shift()?.();
        });
      this.active.add(promise);
    };

    if (this.running < this.options.concurrency) {
      execute();
    } else {
      this.waiting.push(execute);
    }
  }
}
