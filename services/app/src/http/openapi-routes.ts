import type { FastifyInstance } from "fastify";
import { openapiSpec } from "../api/openapi.js";

// #86: serve the hand-authored OpenAPI 3 spec + a Swagger UI docs page.
// Both routes are PUBLIC (registered in auth-routes PUBLIC_PATHS) so unauthenticated
// callers can discover the API. /docs loads Swagger UI from a CDN (no new server
// dep) and points it at /openapi.json.
const DOCS_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>agent-chat-platform API docs</title>
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css" />
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js" crossorigin></script>
    <script>
      window.onload = function () {
        window.ui = SwaggerUIBundle({ url: "/openapi.json", dom_id: "#swagger-ui" });
      };
    </script>
  </body>
</html>
`;

export function registerOpenApiRoutes(app: FastifyInstance) {
  app.get("/openapi.json", async (_req, reply) => {
    return reply.header("content-type", "application/json").send(openapiSpec);
  });

  app.get("/docs", async (_req, reply) => {
    return reply.header("content-type", "text/html; charset=utf-8").send(DOCS_HTML);
  });
}
