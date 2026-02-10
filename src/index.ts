/**
 * Cloudflare Worker entry point — 3-Layer Architecture.
 *
 * @developer Eduardo Arana
 *
 * Routes:
 *   GET  /                              → Chat UI (requires Basic auth)
 *   GET  /health                        → Health check (public)
 *
 *   ── MCP Layer (Streamable HTTP) ────
 *   POST /mcp                           → JSON-RPC (tools/list, tools/call, …)
 *   GET  /mcp                           → SSE keepalive stream
 *   DELETE /mcp                         → Close MCP session
 *
 *   ── A2A Layer (Agent-to-Agent) ─────
 *   GET  /.well-known/agent-card.json   → Agent discovery card (public)
 *   POST /a2a                           → JSON-RPC (SendMessage, GetTask)
 *
 *   ── Agent Layer (Cloudflare Agents SDK) ──
 *   *    /agents/*                      → WebSocket + REST (routeAgentRequest)
 *
 * Authentication per layer:
 *   UI/Agent  → Basic auth (AUTH_USER + AUTH_PASS)
 *   MCP       → Bearer token (MCP_API_KEY)
 *   A2A       → Bearer token (A2A_API_KEY)
 *
 * Re-exports the NutriAgent Durable Object class so Wrangler can bind it.
 */

import { routeAgentRequest } from "agents";
import type { Env } from "./types";
import { checkAuth } from "./auth";
import { handleMcpRequest } from "./mcp";
import { handleAgentCard, handleA2ARequest } from "./a2a";
import HTML from "./public/index.html";

export { NutriAgent } from "./agent";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // ── health (always public) ───────────────────────
    if (url.pathname === "/health") {
      return Response.json({
        status: "ok",
        agent: "NutriAgent",
        model: env.GLM_MODEL || "GLM-4.7-Flash",
        layers: {
          mcp: "/mcp",
          a2a: "/a2a",
          agentCard: "/.well-known/agent-card.json",
          ui: "/",
        },
      });
    }

    // ── Agent Card (public — no auth for discovery) ──
    if (url.pathname === "/.well-known/agent-card.json") {
      return handleAgentCard(request, env);
    }

    // ── MCP Streamable HTTP (own auth layer) ─────────
    if (url.pathname === "/mcp") {
      return handleMcpRequest(request, env);
    }

    // ── A2A Protocol (own auth layer) ────────────────
    if (url.pathname === "/a2a") {
      return handleA2ARequest(request, env);
    }

    // ── UI auth gate ─────────────────────────────────
    // Protect UI and agent SDK routes with Basic auth.
    const authResponse = checkAuth(request, env);
    if (authResponse) return authResponse;

    // ── static UI ────────────────────────────────────
    if (url.pathname === "/" || url.pathname === "/index.html") {
      return new Response(HTML, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    // ── Agent SDK routing (WebSocket + REST) ─────────
    const agentResponse = await routeAgentRequest(request, env);
    if (agentResponse) return agentResponse;

    return new Response("Not Found", { status: 404 });
  },
};
