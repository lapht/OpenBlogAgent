import type { FastifyInstance } from "fastify";

import {
  BacklogError,
  ResearchError,
  SourcesConfigError,
  type Application,
  type CandidateStatus,
  type ResearchService
} from "@openblog/app";

import { ApiError } from "../errors";
import { createApiKeyGuard } from "../plugins/auth";

export interface TopicRoutesOptions {
  application: Application;
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

const STATUSES = ["new", "accepted", "dropped", "used"] as const;

const nullableString = { type: ["string", "null"] } as const;

const candidate = {
  type: "object",
  properties: {
    id: { type: "string" },
    title: { type: "string" },
    url: { type: "string" },
    source: { type: "string" },
    summary: nullableString,
    publishedAt: nullableString,
    collectedAt: { type: "string" },
    score: { type: "integer", description: "0 to 100." },
    breakdown: {
      type: "object",
      additionalProperties: { type: "number" },
      description: "Points per factor: recency, source, keywords, overlap."
    },
    motivation: { type: "string" },
    status: { type: "string", enum: STATUSES },
    brief: { type: ["object", "null"], additionalProperties: true },
    decidedBy: nullableString,
    decisionNote: nullableString,
    decidedAt: nullableString,
    workflowId: nullableString,
    createdAt: { type: "string" },
    updatedAt: { type: "string" }
  }
} as const;

const sourceReport = {
  type: "object",
  properties: {
    name: { type: "string" },
    type: { type: "string" },
    url: { type: "string" },
    status: { type: "string", enum: ["ok", "failed"] },
    count: { type: "integer" },
    error: {
      type: "object",
      properties: { code: { type: "string" }, message: { type: "string" } }
    },
    warnings: { type: "array", items: { type: "string" } }
  }
} as const;

const briefProperties = {
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
  maxWords: { type: "integer", minimum: 1, maximum: 20000 },
  notes: { type: "string", minLength: 1, maxLength: 2000 }
} as const;

const BACKLOG_STATUS: Record<string, number> = {
  not_found: 404,
  ambiguous_id: 409,
  invalid_state: 409,
  invalid_input: 400
};

const RESEARCH_STATUS: Record<string, number> = {
  sources_not_configured: 503,
  backlog_unavailable: 503
};

/** Turns the backlog's typed errors into the API's, so clients see stable codes. */
function translate(error: unknown): never {
  if (error instanceof BacklogError) {
    throw new ApiError(BACKLOG_STATUS[error.code] ?? 400, error.code, error.message);
  }
  if (error instanceof ResearchError) {
    throw new ApiError(RESEARCH_STATUS[error.code] ?? 503, error.code, error.message);
  }
  if (error instanceof SourcesConfigError) {
    throw new ApiError(503, "sources_invalid", error.message);
  }
  throw error;
}

/** The topic backlog endpoints: every route here needs the API key. */
export async function registerTopicRoutes(
  app: FastifyInstance,
  { application, apiKey }: TopicRoutesOptions
): Promise<void> {
  app.addHook("onRequest", createApiKeyGuard(apiKey));

  const research = (): ResearchService => {
    if (!application.research) {
      throw new ApiError(
        503,
        "backlog_unavailable",
        "The topic backlog needs the SQLite memory store"
      );
    }
    return application.research;
  };

  app.get<{ Querystring: { status?: CandidateStatus; limit?: number } }>(
    "/topics",
    {
      schema: {
        summary: "List the topic backlog",
        description: "Candidates, best score first.",
        tags: ["topics"],
        querystring: {
          type: "object",
          properties: {
            status: { type: "string", enum: STATUSES },
            limit: { type: "integer", minimum: 1, maximum: 500, default: 100 }
          }
        },
        response: {
          200: {
            type: "object",
            properties: { candidates: { type: "array", items: candidate } },
            required: ["candidates"]
          },
          503: errorResponse
        }
      }
    },
    async (request) => ({
      candidates: research().list({
        status: request.query.status,
        limit: request.query.limit ?? 100
      })
    })
  );

  app.post(
    "/topics/collect",
    {
      schema: {
        summary: "Collect topic candidates from the configured sources",
        description:
          "Reads the sources of `OPENBLOG_RESEARCH_SOURCES_FILE`, scores the candidates and stores the new ones. Repeating it does not duplicate. Runs while the request waits; a failing source is reported in `sources`.",
        tags: ["topics"],
        response: {
          200: {
            type: "object",
            properties: {
              sources: { type: "array", items: sourceReport },
              counts: {
                type: "object",
                properties: {
                  created: { type: "integer" },
                  refreshed: { type: "integer" },
                  unchanged: { type: "integer" },
                  skipped: { type: "integer" },
                  autoAccepted: { type: "integer" }
                }
              },
              skipped: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    title: { type: "string" },
                    url: { type: "string" },
                    coveredBy: { type: "string" }
                  }
                }
              },
              candidates: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    ...candidate.properties,
                    outcome: { type: "string", enum: ["created", "refreshed", "unchanged"] }
                  }
                }
              }
            }
          },
          503: errorResponse
        }
      }
    },
    async () => {
      try {
        return await research().collect();
      } catch (error) {
        return translate(error);
      }
    }
  );

  app.post<{
    Params: { id: string };
    Body?: { acceptedBy?: string; brief?: Record<string, unknown> };
  }>(
    "/topics/:id/accept",
    {
      schema: {
        summary: "Accept a candidate for generation",
        description:
          "Only an accepted candidate is picked up for a run. The optional `brief` (everything but the topic, which is the candidate's title) is stored with it.",
        tags: ["topics"],
        params: idParams,
        body: {
          type: ["object", "null"],
          properties: {
            acceptedBy: { type: "string", minLength: 1, maxLength: 100 },
            brief: {
              type: "object",
              properties: briefProperties,
              additionalProperties: false
            }
          },
          additionalProperties: false
        },
        response: {
          200: candidate,
          400: errorResponse,
          404: errorResponse,
          409: errorResponse,
          503: errorResponse
        }
      }
    },
    async (request) => {
      try {
        return research().accept(request.params.id, {
          by: request.body?.acceptedBy ?? "api",
          brief: request.body?.brief
        });
      } catch (error) {
        return translate(error);
      }
    }
  );

  app.post<{ Params: { id: string }; Body?: { droppedBy?: string; reason?: string } }>(
    "/topics/:id/drop",
    {
      schema: {
        summary: "Drop a candidate",
        description: "A dropped candidate is kept and is never offered as `new` again.",
        tags: ["topics"],
        params: idParams,
        body: {
          type: ["object", "null"],
          properties: {
            droppedBy: { type: "string", minLength: 1, maxLength: 100 },
            reason: { type: "string", minLength: 1, maxLength: 1000 }
          },
          additionalProperties: false
        },
        response: {
          200: candidate,
          404: errorResponse,
          409: errorResponse,
          503: errorResponse
        }
      }
    },
    async (request) => {
      try {
        return research().drop(request.params.id, {
          by: request.body?.droppedBy ?? "api",
          reason: request.body?.reason
        });
      } catch (error) {
        return translate(error);
      }
    }
  );
}
