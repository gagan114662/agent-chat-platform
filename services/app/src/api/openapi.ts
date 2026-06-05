// Hand-authored OpenAPI 3.1 document for the agent-chat-platform public API (#86).
//
// This is the source of truth served at GET /openapi.json and rendered by GET /docs.
// It is intentionally NOT auto-generated: it covers the *agent-useful* route
// families (auth, chat, tasks, runs, memory, integrations, billing) with
// hand-curated request/response shapes that MATCH the real Fastify routes in
// src/http/*. It is not an exhaustive enumeration of all ~50 routes.
//
// Auth: every non-public route expects `Authorization: Bearer <token>` where the
// token is either a user session token (from POST /auth/login) or an `acp_`-prefixed
// API key (#83). This is modelled as the `bearerAuth` security scheme applied
// globally; /auth/login, /openapi.json and /docs are public (no security).

export const openapiSpec = {
  openapi: "3.1.0",
  info: {
    title: "agent-chat-platform API",
    version: "0.1.0",
    description:
      "Public REST API for agent-chat-platform (reload.chat). Authenticate with a " +
      "bearer token: either a user session token from POST /auth/login or an " +
      "`acp_`-prefixed API key (#83). Multi-tenant: every resource is org-scoped; " +
      "cross-org ids resolve as 404.",
  },
  servers: [{ url: "/", description: "Same-origin API" }],
  // Applied to every operation that does not override it (only /auth/login does).
  security: [{ bearerAuth: [] }],
  tags: [
    { name: "auth", description: "Sessions and identity" },
    { name: "chat", description: "Channels, threads, and messages" },
    { name: "tasks", description: "Task tracker (create, update, link)" },
    { name: "runs", description: "Agent runs, diffs, and approvals" },
    { name: "memory", description: "The agent memory graph" },
    { name: "integrations", description: "Linear / GitHub issue import" },
    { name: "billing", description: "Plan, usage, and quotas" },
  ],
  paths: {
    "/auth/login": {
      post: {
        tags: ["auth"],
        summary: "Exchange credentials for a session token",
        security: [], // public
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["memberId"],
                properties: {
                  memberId: { type: "string" },
                  password: { type: "string" },
                  code: { type: "string", description: "TOTP MFA code, if enabled" },
                },
              },
            },
          },
        },
        responses: {
          "201": {
            description: "Session created",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    token: { type: "string" },
                    member: { $ref: "#/components/schemas/Member" },
                  },
                },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "429": { description: "Too many attempts" },
        },
      },
    },
    "/channels": {
      get: {
        tags: ["chat"],
        summary: "List channels in the caller's org",
        parameters: [
          {
            name: "includeArchived",
            in: "query",
            required: false,
            schema: { type: "string", enum: ["1"] },
            description: "Pass `1` to include archived channels",
          },
        ],
        responses: {
          "200": {
            description: "Channels",
            content: {
              "application/json": {
                schema: { type: "array", items: { $ref: "#/components/schemas/Channel" } },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
        },
      },
      post: {
        tags: ["chat"],
        summary: "Create a channel (requires channel:create)",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["name"],
                properties: { name: { type: "string" } },
              },
            },
          },
        },
        responses: {
          "201": {
            description: "Channel created",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/Channel" } },
            },
          },
          "400": { description: "name required" },
          "403": { $ref: "#/components/responses/Forbidden" },
        },
      },
    },
    "/threads/{id}/messages": {
      parameters: [
        { name: "id", in: "path", required: true, schema: { type: "string" }, description: "Thread id" },
      ],
      get: {
        tags: ["chat"],
        summary: "List messages in a thread (paginated)",
        parameters: [
          { name: "before", in: "query", required: false, schema: { type: "string" } },
          { name: "after", in: "query", required: false, schema: { type: "string" } },
          { name: "limit", in: "query", required: false, schema: { type: "integer" } },
        ],
        responses: {
          "200": {
            description: "Messages",
            content: {
              "application/json": {
                schema: { type: "array", items: { $ref: "#/components/schemas/Message" } },
              },
            },
          },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
      post: {
        tags: ["chat"],
        summary: "Post a message to a thread (triggers @mention runs)",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["body"],
                properties: { body: { type: "string" } },
              },
            },
          },
        },
        responses: {
          "201": {
            description: "Message created",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    message: { $ref: "#/components/schemas/Message" },
                    startedRuns: { type: "array", items: { type: "string" } },
                  },
                },
              },
            },
          },
          "403": { $ref: "#/components/responses/Forbidden" },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
    },
    "/tasks/bulk": {
      post: {
        tags: ["tasks"],
        summary: "Bulk-create up to 50 tasks in one transaction",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["threadId", "items"],
                properties: {
                  threadId: { type: "string" },
                  items: {
                    type: "array",
                    maxItems: 50,
                    items: {
                      type: "object",
                      required: ["title"],
                      properties: {
                        title: { type: "string" },
                        priority: { $ref: "#/components/schemas/TaskPriority" },
                        dueDate: { type: "string", nullable: true },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        responses: {
          "201": {
            description: "Created task ids",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: { ids: { type: "array", items: { type: "string" } } },
                },
              },
            },
          },
          "400": { description: "Invalid item or over the 50-task cap" },
        },
      },
    },
    "/tasks/{id}": {
      parameters: [
        { name: "id", in: "path", required: true, schema: { type: "string" }, description: "Task id" },
      ],
      get: {
        tags: ["tasks"],
        summary: "Get a task with its comments and relations",
        responses: {
          "200": {
            description: "Task detail",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    task: { $ref: "#/components/schemas/Task" },
                    comments: { type: "array", items: { type: "object" } },
                    relations: { type: "array", items: { type: "object" } },
                  },
                },
              },
            },
          },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
      patch: {
        tags: ["tasks"],
        summary: "Update a task's priority, due date, or state",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  priority: { $ref: "#/components/schemas/TaskPriority" },
                  dueDate: { type: "string", nullable: true },
                  state: { $ref: "#/components/schemas/TaskState" },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Updated task",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: { task: { $ref: "#/components/schemas/Task" } },
                },
              },
            },
          },
          "400": { description: "Invalid value" },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
    },
    "/runs/{id}/diff": {
      get: {
        tags: ["runs"],
        summary: "Get the changed files for a run's pull request",
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" }, description: "Run id" },
        ],
        responses: {
          "200": {
            description: "Changed files",
            content: {
              "application/json": {
                schema: { type: "array", items: { $ref: "#/components/schemas/ChangedFile" } },
              },
            },
          },
          "400": { description: "Repo token not configured" },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
    },
    "/runs/{id}/approve": {
      post: {
        tags: ["runs"],
        summary: "Approve a held run (merges its PR)",
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" }, description: "Run id" },
        ],
        responses: {
          "200": {
            description: "Approved run",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/Run" } },
            },
          },
          "400": { description: "Repo token not configured" },
          "404": { description: "Held run not found" },
        },
      },
    },
    "/runs/{id}/decline": {
      post: {
        tags: ["runs"],
        summary: "Decline a held run",
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" }, description: "Run id" },
        ],
        responses: {
          "200": {
            description: "Declined",
            content: {
              "application/json": {
                schema: { type: "object", properties: { ok: { type: "boolean" } } },
              },
            },
          },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
    },
    "/memory": {
      get: {
        tags: ["memory"],
        summary: "List or search memory nodes",
        parameters: [
          { name: "kind", in: "query", required: false, schema: { type: "string" } },
          { name: "scope", in: "query", required: false, schema: { type: "string" } },
          { name: "q", in: "query", required: false, schema: { type: "string" }, description: "Full-text search query" },
        ],
        responses: {
          "200": {
            description: "Memory nodes",
            content: {
              "application/json": {
                schema: { type: "array", items: { $ref: "#/components/schemas/MemoryNode" } },
              },
            },
          },
        },
      },
      post: {
        tags: ["memory"],
        summary: "Create a memory node",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["kind", "label"],
                properties: {
                  kind: { type: "string" },
                  label: { type: "string" },
                  body: { type: "string" },
                  scope: { type: "string" },
                  metadata: { type: "object", additionalProperties: true },
                  derivedFrom: { type: "array", items: { type: "string" } },
                },
              },
            },
          },
        },
        responses: {
          "201": {
            description: "Created node",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/MemoryNode" } },
            },
          },
          "400": { description: "kind and label required" },
          "403": { $ref: "#/components/responses/Forbidden" },
        },
      },
    },
    "/memory/recall": {
      get: {
        tags: ["memory"],
        summary: "Recall the most relevant memory nodes for an intent",
        parameters: [
          { name: "q", in: "query", required: true, schema: { type: "string" } },
          { name: "limit", in: "query", required: false, schema: { type: "integer", default: 5 } },
        ],
        responses: {
          "200": {
            description: "Ranked memory nodes",
            content: {
              "application/json": {
                schema: { type: "array", items: { $ref: "#/components/schemas/MemoryNode" } },
              },
            },
          },
        },
      },
    },
    "/integrations/linear/import": {
      post: {
        tags: ["integrations"],
        summary: "Import Linear issues into a thread as tasks",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["threadId"],
                properties: { threadId: { type: "string" } },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Import result",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/ImportResult" } },
            },
          },
          "400": { description: "threadId required or Linear API key not configured" },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
    },
    "/integrations/github/import": {
      post: {
        tags: ["integrations"],
        summary: "Import GitHub issues into a thread as tasks",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["threadId"],
                properties: { threadId: { type: "string" } },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Import result",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/ImportResult" } },
            },
          },
          "400": { description: "threadId required or repo token not configured" },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
    },
    "/billing": {
      get: {
        tags: ["billing"],
        summary: "Get the org's plan, usage, and per-resource quotas",
        responses: {
          "200": {
            description: "Billing snapshot",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/Billing" } },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
        },
      },
    },
  },
  components: {
    securitySchemes: {
      // Both a user session token (POST /auth/login) and an `acp_` API key (#83)
      // are accepted as bearer tokens.
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        description:
          "A user session token (from POST /auth/login) OR an `acp_`-prefixed API key (#83).",
      },
    },
    responses: {
      Unauthorized: {
        description: "Missing or invalid bearer token",
        content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
      },
      Forbidden: {
        description: "Authenticated but not permitted (RBAC)",
        content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
      },
      NotFound: {
        description: "Not found (or cross-org, which resolves as 404)",
        content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
      },
    },
    schemas: {
      Error: {
        type: "object",
        properties: { error: { type: "string" } },
        required: ["error"],
      },
      Member: {
        type: "object",
        properties: {
          id: { type: "string" },
          orgId: { type: "string" },
          workspaceId: { type: "string" },
          displayName: { type: "string" },
          role: { type: "string" },
        },
      },
      Channel: {
        type: "object",
        properties: {
          id: { type: "string" },
          orgId: { type: "string" },
          name: { type: "string" },
          archived: { type: "boolean" },
        },
      },
      Message: {
        type: "object",
        properties: {
          id: { type: "string" },
          orgId: { type: "string" },
          threadId: { type: "string" },
          authorKind: { type: "string", enum: ["human", "agent"] },
          authorId: { type: "string" },
          kind: { type: "string" },
          body: { type: "string" },
          createdAt: { type: "string", format: "date-time" },
        },
      },
      TaskPriority: { type: "string", enum: ["low", "medium", "high", "urgent"] },
      TaskState: { type: "string", enum: ["open", "in_progress", "blocked", "done", "cancelled"] },
      Task: {
        type: "object",
        properties: {
          id: { type: "string" },
          orgId: { type: "string" },
          threadId: { type: "string" },
          title: { type: "string" },
          state: { $ref: "#/components/schemas/TaskState" },
          priority: { $ref: "#/components/schemas/TaskPriority" },
          dueDate: { type: "string", nullable: true },
        },
      },
      Run: {
        type: "object",
        properties: {
          id: { type: "string" },
          orgId: { type: "string" },
          taskId: { type: "string" },
          state: { type: "string" },
          prNumber: { type: "integer", nullable: true },
        },
      },
      ChangedFile: {
        type: "object",
        properties: {
          filename: { type: "string" },
          status: { type: "string" },
          additions: { type: "integer" },
          deletions: { type: "integer" },
          patch: { type: "string" },
        },
      },
      MemoryNode: {
        type: "object",
        properties: {
          id: { type: "string" },
          orgId: { type: "string" },
          kind: { type: "string" },
          label: { type: "string" },
          body: { type: "string" },
          scope: { type: "string" },
          version: { type: "integer" },
        },
      },
      ImportResult: {
        type: "object",
        properties: {
          imported: { type: "integer" },
          ids: { type: "array", items: { type: "string" } },
        },
      },
      Billing: {
        type: "object",
        properties: {
          plan: { type: "object", additionalProperties: true },
          usage: { type: "object", additionalProperties: true },
          quotas: { type: "object", additionalProperties: true },
        },
      },
    },
  },
} as const;

export type OpenApiSpec = typeof openapiSpec;
