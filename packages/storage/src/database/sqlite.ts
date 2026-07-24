import Database from "better-sqlite3";

import type { IDatabaseConnection } from "./index";

export interface SQLiteDatabaseConnectionOptions {
  filePath: string;
}

export class SQLiteDatabaseConnection implements IDatabaseConnection {
  private db: Database.Database | null = null;

  constructor(private readonly options: SQLiteDatabaseConnectionOptions) {}

  async connect(): Promise<void> {
    if (this.db) {
      return;
    }

    this.db = new Database(this.options.filePath);
    this.db.pragma("foreign_keys = ON");
    this.db.pragma("journal_mode = WAL");
  }

  async disconnect(): Promise<void> {
    if (!this.db) {
      return;
    }

    this.db.close();
    this.db = null;
  }

  getDatabase(): Database.Database {
    if (!this.db) {
      throw new Error("SQLite connection is not initialized. Call connect() first.");
    }

    return this.db;
  }
}
