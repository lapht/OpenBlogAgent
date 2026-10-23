import type { FastifyInstance } from "fastify";

import type { Application } from "@openblog/app";
import { ApprovalError } from "@openblog/graph";
import { articleBriefSchema, formatBriefIssues, type ArticleBrief } from "@openblog/types";
import { ZodError } from "zod";

import { ApiError } from "../errors";
import { createApiKeyGuard } from "../plugins/auth";
import type { RunQueue } from "../run-queue";

export interface RunRoutesOptions {
  application: Application;
  queue: RunQueue;
  apiKey?: string;
}

const errorResponse = {
  type: "object",
  properties: { error: { type: "string" }, code: { type: "string" } },
  required: ["error", "code"]
} as const;

const idParams = {
  type: "object",
  properties: { id: { type: "string", minLength: 1, maxLength: 100 } },
  required: ["id"]
} as const;

const startBody = {
  type: "object",
  properties: {
    topic: { type: "string", minLength: 1, maxLength: 500 },
    force: { type: "boolean" },
    language: {
      type: "string",
      pattern: "^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$",
      description: "Language code of the article, e.g. `en` or `it`."
    },
    audience: { type: "string", minLength: 1, maxLength: 300 },
    tone: { type: "string", minLength: 1, maxLength: 200 },
    targetKeyword: { type: "string", minLength: 1, maxLength: 100 },
    secondaryKeywords: {
      type: "array",
      items: { type: "string", minLength: 1, maxLength: 100 },
      maxItems: 20
    },
    minWords: { type: "integer", minimum: 1, maximum: 20000 },
    maxWords: {
      type: "integer",
      minimum: 1,
      maximum: 20000,
      description: "Must not be smaller than `minWords`."
    },
    notes: { type: "string", minLength: 1, maxLength: 2000 }
  },
  required: ["topic"],
  additionalProperties: false
} as const;

const acceptedResponse = {
  type: "object",
  properties: {
    workflowId: { type: "string" },
    status: { type: "string", enum: ["started"] }
  },
  required: ["workflowId", "status"]
} as const;

const review = {
  type: ["object", "null"],
  properties: {
    overall: { type: "number" },
    scores: { type: "object", additionalProperties: { type: "number" } },
    rationale: { type: "string" }
  }
} as const;

const runSummary = {
  type: "object",
  properties: {
    workflowId: { type: "string" },
    topic: { type: "string" },
    status: { type: "string" },
    failedStep: { type: ["string", "null"] },
    errorCode: { type: ["string", "null"] },
    createdAt: { type: "string" },
    totalTokens: { type: "number" },
    costUsd: { type: "number" },
    review,
    models: {
      type: "object",
      additionalProperties: { type: "string" },
      description: "The model each step last used."
    }
  }
} as const;

const stepUsage = {
  type: ["object", "null"],
  properties: {
    calls: { type: "number" },
    promptTokens: { type: "number" },
    completionTokens: { type: "number" },
    totalTokens: { type: "number" },
    costUsd: { type: "number" }
  }
} as const;

const runDetails = {
  type: "object",
  properties: {
    ...runSummary.properties,
    errorMessage: { type: ["string", "null"] },
    completedAt: { type: ["string", "null"] },
    steps: {
      type: "array",
      items: {
        type: "object",
        properties: {
          step: { type: "string" },
          status: { type: "string", enum: ["succeeded", "failed"] },
          attempt: { type: "number" },
          errorCode: { type: ["string", "null"] },
          errorMessage: { type: ["string", "null"] },
          startedAt: { type: "string" },
          completedAt: { type: "string" },
          usage: stepUsage,
          model: { type: ["string", "null"] }
        }
      }
    }
  }
} as const;

const APPROVAL_STATUS: Record<string, number> = {
  not_found: 404,
  already_published: 409,
  gate_not_passed: 422,
  not_publishable: 422,
  memory_unavailable: 503
};

/** The run endpoints: every route here needs the API key. */
export async function registerRunRoutes(
  app: FastifyInstance,
  { application, queue, apiKey }: RunRoutesOptions
): Promise<void> {
  const { workflow } = application;
  // Runs queued or executing in this process; a second resume of the same run is refused.
  const inFlight = new Set<string>();

  app.addHook("onRequest", createApiKeyGuard(apiKey));

  const reserveSlot = () => {
    const slot = queue.reserve();
    if (!slot) {
      throw new ApiError(429, "queue_full", "Too many runs in progress; try again later", {
        "retry-after": "30"
      });
    }
    return slot;
  };

  app.post<{ Body: ArticleBrief & { force?: boolean } }>(
    "/runs",
    {
      schema: {
        summary: "Start a run",
        description:
          "Registers a run and executes it in the background. Poll `GET /runs/{id}` for the outcome. Besides `topic`, the body takes the article brief (language, audience, tone, keywords, word range, notes); a run with only a topic uses the configured defaults.",
        tags: ["runs"],
        body: startBody,
        response: {
          202: acceptedResponse,
          400: errorResponse,
          429: errorResponse,
          503: errorResponse
        }
      }
    },
    async (request, reply) => {
      const { force, ...brief } = request.body;
      const checked = articleBriefSchema.safeParse(brief);
      if (!checked.success) {
        throw new ApiError(400, "invalid_brief", formatBriefIssues(checked.error));
      }

      const slot = reserveSlot();
      try {
        const pending = await workflow.begin({ ...checked.data, force }).catch((error: unknown) => {
          if (error instanceof ZodError) {
            throw new ApiError(400, "invalid_brief", formatBriefIssues(error));
          }
          throw error;
        });
        const id = pending.workflowId;
        if (!id) {
          throw new ApiError(503, "memory_unavailable", "Runs need a memory store to be inspected");
        }
        inFlight.add(id);
        slot.run(() => pending.execute().finally(() => inFlight.delete(id)));
        return reply.status(202).send({ workflowId: id, status: "started" });
      } catch (error) {
        slot.release();
        throw error;
      }
    }
  );

  app.get<{ Querystring: { limit?: number } }>(
    "/runs",
    {
      schema: {
        summary: "List the most recent runs",
        tags: ["runs"],
        querystring: {
          type: "object",
          properties: { limit: { type: "integer", minimum: 1, maximum: 100, default: 20 } }
        },
        response: {
          200: {
            type: "object",
            properties: { runs: { type: "array", items: runSummary } },
            required: ["runs"]
          }
        }
      }
    },
    async (request) => ({ runs: await application.listRuns(request.query.limit ?? 20) })
  );

  app.get<{ Params: { id: string } }>(
    "/runs/:id",
    {
      schema: {
        summary: "Status and steps of a run",
        tags: ["runs"],
        params: idParams,
        response: { 200: runDetails, 404: errorResponse }
      }
    },
    async (request) => {
      const run = await application.getRun(request.params.id);
      if (!run) {
        throw new ApiError(404, "not_found", `Run ${request.params.id} was not found`);
      }
      return run;
    }
  );

  app.post<{ Params: { id: string }; Body?: { force?: boolean } }>(
    "/runs/:id/resume",
    {
      schema: {
        summary: "Resume a run that did not publish",
        description: "Continues from the last good step, in the background.",
        tags: ["runs"],
        params: idParams,
        body: {
          type: ["object", "null"],
          properties: { force: { type: "boolean" } },
          additionalProperties: false
        },
        response: {
          202: acceptedResponse,
          404: errorResponse,
          409: errorResponse,
          429: errorResponse
        }
      }
    },
    async (request, reply) => {
      const { id } = request.params;
      const run = await application.getRun(id);
      if (!run) {
        throw new ApiError(404, "not_found", `Run ${id} was not found`);
      }
      if (run.status === "published") {
        throw new ApiError(409, "already_published", `Run ${id} is already published`);
      }
      if (inFlight.has(id)) {
        throw new ApiError(409, "already_running", `Run ${id} is already queued or running`);
      }

      const slot = reserveSlot();
      inFlight.add(id);
      slot.run(() =>
        workflow.resume(id, { force: request.body?.force }).finally(() => inFlight.delete(id))
      );
      return reply.status(202).send({ workflowId: id, status: "started" });
    }
  );

  app.post<{ Params: { id: string }; Body?: { approvedBy?: string; overrideReason?: string } }>(
    "/runs/:id/approve",
    {
      schema: {
        summary: "Publish a stored article live",
        description:
          "An article that failed the quality gate needs `overrideReason`. Runs while the request waits.",
        tags: ["runs"],
        params: idParams,
        body: {
          type: ["object", "null"],
          properties: {
            approvedBy: { type: "string", minLength: 1, maxLength: 100 },
            overrideReason: { type: "string", minLength: 1, maxLength: 1000 }
          },
          additionalProperties: false
        },
        response: {
          200: {
            type: "object",
            properties: {
              workflowId: { type: "string" },
              title: { type: "string" },
              slug: { type: "string" },
              status: { type: "string", enum: ["published"] }
            }
          },
          502: errorResponse,
          404: errorResponse,
          409: errorResponse,
          422: errorResponse,
          503: errorResponse
        }
      }
    },
    async (request, reply) => {
      const { id } = request.params;
      try {
        const result = await workflow.approve(id, {
          approvedBy: request.body?.approvedBy ?? "api",
          overrideReason: request.body?.overrideReason
        });
        if (result.status !== "published") {
          throw new ApiError(
            502,
            result.failure?.code ?? "publish_failed",
            result.failure?.message ?? "Publisher did not confirm the publication"
          );
        }
        return reply.send({
          workflowId: result.workflowId,
          title: result.title,
          slug: result.slug,
          status: result.status
        });
      } catch (error) {
        if (error instanceof ApprovalError) {
          throw new ApiError(APPROVAL_STATUS[error.code] ?? 400, error.code, error.message);
        }
        throw error;
      }
    }
  );
}
