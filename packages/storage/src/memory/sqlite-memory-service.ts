import path from "node:path";

import { runStorageMigrations, SQLiteDatabaseConnection } from "../database";
import {
  ArticleRepository,
  DecisionRepository,
  PromptRepository,
  StepRepository,
  TopicRepository,
  WorkflowRepository
} from "../repositories";
import { MemoryService } from "./service";

export interface CreateSQLiteMemoryServiceOptions {
  filePath?: string;
}

export interface SQLiteMemoryServiceHandle {
  memoryService: MemoryService;
  disconnect(): Promise<void>;
}

export async function createSQLiteMemoryService(
  options: CreateSQLiteMemoryServiceOptions = {}
): Promise<SQLiteMemoryServiceHandle> {
  const dbPath = options.filePath ?? path.resolve(process.cwd(), "data", "openblog-memory.db");
  const connection = new SQLiteDatabaseConnection({ filePath: dbPath });
  await connection.connect();

  const db = connection.getDatabase();
  runStorageMigrations(db);

  const memoryService = new MemoryService(
    new WorkflowRepository(db),
    new TopicRepository(db),
    new PromptRepository(db),
    new ArticleRepository(db),
    new StepRepository(db),
    (fn) => db.transaction(fn)(),
    new DecisionRepository(db)
  );

  return {
    memoryService,
    async disconnect(): Promise<void> {
      await connection.disconnect();
    }
  };
}
