import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createSQLiteMemoryService,
  type SQLiteMemoryServiceHandle
} from "../../packages/storage/src/memory";

const dirs: string[] = [];
const handles: SQLiteMemoryServiceHandle[] = [];

afterEach(async () => {
  await Promise.all(handles.splice(0).map((handle) => handle.disconnect()));
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

async function open() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openblog-stale-"));
  dirs.push(dir);
  const handle = await createSQLiteMemoryService({ filePath: path.join(dir, "memory.db") });
  handles.push(handle);
  return handle.memoryService;
}

const minutesFromNow = (minutes: number) => new Date(Date.now() + minutes * 60_000);

describe("recoverStaleRuns", () => {
  it("moves runs idle past the threshold to interrupted and keeps their steps", async () => {
    const service = await open();
    const started = await service.beginWorkflow({ workflowName: "w", topic: "Queued" });
    const running = await service.beginWorkflow({ workflowName: "w", topic: "Running" });
    await service.markRunning(running.workflowId);
    const stepTime = new Date().toISOString();
    await service.recordStep({
      workflowId: running.workflowId,
      step: "planner",
      status: "succeeded",
      output: ["a"],
      startedAt: stepTime,
      completedAt: stepTime
    });

    const recovered = await service.recoverStaleRuns(60, minutesFromNow(61));

    expect(recovered.sort()).toEqual([started.workflowId, running.workflowId].sort());
    for (const id of recovered) {
      expect((await service.loadWorkflow(id))?.status).toBe("interrupted");
    }
    expect((await service.loadWorkflow(running.workflowId))?.steps).toHaveLength(1);
  });

  it("leaves runs with recent activity alone", async () => {
    const service = await open();
    const run = await service.beginWorkflow({ workflowName: "w", topic: "Fresh" });
    await service.markRunning(run.workflowId);

    expect(await service.recoverStaleRuns(60, minutesFromNow(59))).toEqual([]);
    expect((await service.loadWorkflow(run.workflowId))?.status).toBe("running");
  });

  it("counts a recent step as activity even when the run row is old", async () => {
    const service = await open();
    const run = await service.beginWorkflow({ workflowName: "w", topic: "Slow step" });
    await service.markRunning(run.workflowId);
    const stepTime = minutesFromNow(80).toISOString();
    await service.recordStep({
      workflowId: run.workflowId,
      step: "writer",
      status: "succeeded",
      output: "text",
      startedAt: stepTime,
      completedAt: stepTime
    });

    expect(await service.recoverStaleRuns(60, minutesFromNow(90))).toEqual([]);
    expect(await service.recoverStaleRuns(60, minutesFromNow(141))).toEqual([run.workflowId]);
  });

  it("ignores runs that already ended", async () => {
    const service = await open();
    const run = await service.beginWorkflow({ workflowName: "w", topic: "Done" });
    await service.finishWorkflow({
      workflowId: run.workflowId,
      status: "failed",
      topic: "Done",
      article: "",
      editedText: "",
      seoOutput: {},
      category: "General",
      tags: []
    });

    expect(await service.recoverStaleRuns(1, minutesFromNow(600))).toEqual([]);
  });
});
