import type { Database } from "better-sqlite3";

export type LockResult =
  { acquired: true; expiresAt: string } | { acquired: false; owner: string; expiresAt: string };

/** What the runs of a period cost, as stored. */
export interface UsageSince {
  /** Runs created in the period, whatever their outcome. */
  runs: number;
  /** Provider cost (USD) of the steps finished in the period. */
  costUsd: number;
}

/** A named lock with an owner and an expiry, and the usage totals the scheduler's limits need. */
export class SchedulerStore {
  constructor(private readonly db: Database) {}

  /**
   * Takes the lock unless another owner holds an unexpired one. An expired lock (its holder died)
   * is taken over. The check and the write are one transaction, so two callers never both win,
   * also from different processes.
   */
  acquireLock(name: string, owner: string, ttlMs: number, now: Date = new Date()): LockResult {
    return this.db
      .transaction((): LockResult => {
        const current = this.db
          .prepare("SELECT owner, expires_at FROM scheduler_locks WHERE name = ?")
          .get(name) as { owner: string; expires_at: string } | undefined;

        if (current && current.owner !== owner && current.expires_at > now.toISOString()) {
          return { acquired: false, owner: current.owner, expiresAt: current.expires_at };
        }

        const expiresAt = new Date(now.getTime() + ttlMs).toISOString();
        this.db
          .prepare(
            `INSERT INTO scheduler_locks (name, owner, acquired_at, expires_at)
             VALUES (?, ?, ?, ?)
             ON CONFLICT(name) DO UPDATE SET
               owner = excluded.owner, acquired_at = excluded.acquired_at, expires_at = excluded.expires_at`
          )
          .run(name, owner, now.toISOString(), expiresAt);
        return { acquired: true, expiresAt };
      })
      .immediate();
  }

  /** Releases the lock if `owner` still holds it (it may have expired and been taken over). */
  releaseLock(name: string, owner: string): void {
    this.db.prepare("DELETE FROM scheduler_locks WHERE name = ? AND owner = ?").run(name, owner);
  }

  /** Runs created and cost incurred since `since`, from the stored runs and steps. */
  usageSince(since: Date): UsageSince {
    const cutoff = since.toISOString();
    const runs = this.db
      .prepare("SELECT COUNT(*) AS count FROM workflows WHERE created_at >= ?")
      .get(cutoff) as { count: number };
    const cost = this.db
      .prepare("SELECT SUM(cost_usd) AS cost FROM workflow_steps WHERE completed_at >= ?")
      .get(cutoff) as { cost: number | null };
    return { runs: runs.count, costUsd: cost.cost ?? 0 };
  }
}
