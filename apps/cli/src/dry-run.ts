import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { EnvSchema } from "@openblog/config";
import type { IPublisher, PublishResult } from "@openblog/publishers";

/** A publisher that accepts everything and writes nothing. */
export function createDryRunPublisher(id: string): IPublisher {
  return {
    id,
    name: "Dry run",
    validate: async () => ({ valid: true, issues: [] }),
    supports: () => true,
    publish: async (): Promise<PublishResult> => ({
      success: true,
      publisherId: id,
      publisherName: "Dry run",
      metadata: { dryRun: true }
    })
  };
}

export interface DryRunWorkspace {
  /** Database path for the run: a throwaway copy of the real one. */
  dbPath: string;
  cleanup(): void;
}

/**
 * A dry run must not leave a trace, but it still has to see earlier runs (duplicates, resume,
 * approve). It therefore works on a temporary copy of the database, deleted afterwards.
 */
export function prepareDryRunWorkspace(config: EnvSchema): DryRunWorkspace {
  const source =
    config.OPENBLOG_MEMORY_DB_PATH ?? path.resolve(process.cwd(), "data", "openblog-memory.db");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openblog-dry-run-"));
  const dbPath = path.join(dir, "memory.db");

  for (const suffix of ["", "-wal", "-shm"]) {
    if (fs.existsSync(source + suffix)) {
      fs.copyFileSync(source + suffix, dbPath + suffix);
    }
  }

  return { dbPath, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}
