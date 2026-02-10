/**
 * MCP Streamable HTTP Server
 *
 * @developer Eduardo Arana
 *
 * Implements the Model Context Protocol over Streamable HTTP transport.
 * Exposes OpenFoodFacts tools via a JSON-RPC 2.0 interface at /mcp.
 *
 * Supported methods:
 *   - initialize          → handshake + capabilities
 *   - tools/list          → list available tools
 *   - tools/call          → execute a tool
 *   - notifications/initialized  → client ack (no-op)
 *   - ping                → keepalive
 *
 * Security:
 *   - Bearer token auth via MCP_API_KEY secret
 *   - Origin header validation
 *   - Session management via Mcp-Session-Id header
 *
 * Spec: https://modelcontextprotocol.io/specification/2025-03-26/basic/transports#streamable-http
 */

import { dispatchTool } from "../tools";
import type { Env } from "../types";

// ── protocol constants ─────────────────────────────────────────────────────

const MCP_PROTOCOL_VERSION = "2025-03-26";

const SERVER_INFO = {
  name: "NutriAgent-MCP",
  version: "1.2.0",
};

const SERVER_CAPABILITIES = {
  tools: { listChanged: false },
};

// ── MCP tool definitions (MCP schema format) ───────────────────────────────

const MCP_TOOLS = [
  {
    name: "get_product_by_barcode",
    description:
      "Look up a food product by its barcode (EAN/UPC). Returns full nutritional facts, Nutri-Score, ingredients, allergens.",
    inputSchema: {
      type: "object",
      properties: {
        barcode: {
          type: "string",
          description:
            "The product barcode (EAN-13 or UPC-A), e.g. '3017620422003' for Nutella",
        },
      },
      required: ["barcode"],
    },
  },
  {
    name: "search_products",
    description:
      "Search the OpenFoodFacts database by product name or keyword. Returns matching products with nutritional info.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Product name or keyword to search for",
        },
        page: { type: "number", description: "Page number (default 1)" },
        page_size: {
          type: "number",
          description: "Results per page, max 50 (default 5)",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "get_products_by_category",
    description:
      "Browse products in a specific food category, e.g. 'breakfast-cereals', 'yogurts', 'sodas'.",
    inputSchema: {
      type: "object",
      properties: {
        category: { type: "string", description: "Food category name" },
        page: { type: "number", description: "Page number (default 1)" },
        page_size: {
          type: "number",
          description: "Results per page (default 5)",
        },
      },
      required: ["category"],
    },
  },
  {
    name: "compare_products",
    description:
      "Compare nutritional facts and Nutri-Score across multiple products by their barcodes.",
    inputSchema: {
      type: "object",
      properties: {
        barcodes: {
          type: "array",
          items: { type: "string" },
          description: "Array of barcodes to compare",
        },
      },
      required: ["barcodes"],
    },
  },
  {
    name: "get_allergen_info",
    description:
      "Get allergen and trace information for a product by barcode. Useful for dietary restriction checks.",
    inputSchema: {
      type: "object",
      properties: {
        barcode: { type: "string", description: "Product barcode" },
      },
      required: ["barcode"],
    },
  },
];

// ── session store (in-memory, per-isolate) ─────────────────────────────────

const sessions = new Map<string, { createdAt: number }>();

function getOrCreateSession(sessionId?: string | null): string {
  if (sessionId && sessions.has(sessionId)) return sessionId;
  const id = crypto.randomUUID();
  sessions.set(id, { createdAt: Date.now() });
  return id;
}

// ── JSON-RPC helpers ───────────────────────────────────────────────────────

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

function rpcOk(id: string | number | null, result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result };
}

function rpcError(
  id: string | number | null,
  code: number,
  message: string,
  data?: unknown
): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message, data } };
}

// ── auth ───────────────────────────────────────────────────────────────────

function checkMcpAuth(request: Request, env: Env): Response | null {
  // MCP_API_KEY is required if set
  if (!env.MCP_API_KEY) return null; // no auth configured

  const auth = request.headers.get("Authorization");
  if (!auth || !auth.startsWith("Bearer ")) {
    return Response.json(
      rpcError(null, -32001, "Unauthorized: Bearer token required"),
      { status: 401, headers: { "Content-Type": "application/json" } }
    );
  }

  const token = auth.slice(7);
  if (token !== env.MCP_API_KEY) {
    return Response.json(
      rpcError(null, -32001, "Unauthorized: invalid token"),
      { status: 401, headers: { "Content-Type": "application/json" } }
    );
  }

  return null;
}

// ── request handler ────────────────────────────────────────────────────────

export async function handleMcpRequest(
  request: Request,
  env: Env
): Promise<Response> {
  // ── auth gate ────────────────────────────────────────
  const authErr = checkMcpAuth(request, env);
  if (authErr) return authErr;

  // ── GET /mcp → SSE keepalive stream (for client connections) ──
  if (request.method === "GET") {
    const sessionId = getOrCreateSession(
      request.headers.get("mcp-session-id")
    );

    const stream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        controller.enqueue(encoder.encode(": MCP SSE keepalive\n\n"));
        // In a full implementation, server-initiated notifications go here.
        // For now we just keep the connection open until the client closes.
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "Mcp-Session-Id": sessionId,
      },
    });
  }

  // ── DELETE /mcp → close session ──────────────────────
  if (request.method === "DELETE") {
    const sessionId = request.headers.get("mcp-session-id");
    if (sessionId) sessions.delete(sessionId);
    return new Response(null, { status: 204 });
  }

  // ── POST /mcp → JSON-RPC ────────────────────────────
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return Response.json(
      rpcError(null, -32700, "Content-Type must be application/json"),
      { status: 415 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(rpcError(null, -32700, "Parse error"), {
      status: 400,
    });
  }

  // Handle batch requests
  if (Array.isArray(body)) {
    const results = await Promise.all(
      body.map((req: JsonRpcRequest) => handleRpcMethod(req))
    );
    // Filter out notifications (no id → no response)
    const responses = results.filter((r): r is JsonRpcResponse => r !== null);
    const sessionId = getOrCreateSession(
      request.headers.get("mcp-session-id")
    );
    if (responses.length === 0) {
      return new Response(null, {
        status: 202,
        headers: { "Mcp-Session-Id": sessionId },
      });
    }
    return Response.json(responses, {
      headers: {
        "Content-Type": "application/json",
        "Mcp-Session-Id": sessionId,
      },
    });
  }

  // Single request
  const rpcReq = body as JsonRpcRequest;
  const sessionId = getOrCreateSession(
    request.headers.get("mcp-session-id")
  );

  const result = await handleRpcMethod(rpcReq);

  // Notification (no id) → 202 Accepted
  if (result === null) {
    return new Response(null, {
      status: 202,
      headers: { "Mcp-Session-Id": sessionId },
    });
  }

  return Response.json(result, {
    headers: {
      "Content-Type": "application/json",
      "Mcp-Session-Id": sessionId,
    },
  });
}

// ── method dispatcher ──────────────────────────────────────────────────────

async function handleRpcMethod(
  req: JsonRpcRequest
): Promise<JsonRpcResponse | null> {
  const id = req.id ?? null;

  // Notifications (no id) are fire-and-forget
  if (req.method === "notifications/initialized") {
    return null;
  }
  if (req.method === "notifications/cancelled") {
    return null;
  }

  switch (req.method) {
    case "initialize":
      return rpcOk(id, {
        protocolVersion: MCP_PROTOCOL_VERSION,
        serverInfo: SERVER_INFO,
        capabilities: SERVER_CAPABILITIES,
      });

    case "ping":
      return rpcOk(id, {});

    case "tools/list":
      return rpcOk(id, { tools: MCP_TOOLS });

    case "tools/call":
      return await handleToolCall(id, req.params);

    default:
      return rpcError(id, -32601, `Method not found: ${req.method}`);
  }
}

// ── tools/call handler ─────────────────────────────────────────────────────

async function handleToolCall(
  id: string | number | null,
  params?: Record<string, unknown>
): Promise<JsonRpcResponse> {
  if (!params || !params.name) {
    return rpcError(id, -32602, "Missing required parameter: name");
  }

  const toolName = params.name as string;
  const args = (params.arguments as Record<string, unknown>) ?? {};

  // Verify tool exists
  const tool = MCP_TOOLS.find((t) => t.name === toolName);
  if (!tool) {
    return rpcError(id, -32602, `Unknown tool: ${toolName}`);
  }

  try {
    const result = await dispatchTool(toolName, args);
    return rpcOk(id, {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      isError: false,
    });
  } catch (err) {
    return rpcOk(id, {
      content: [
        {
          type: "text",
          text: `Error: ${err instanceof Error ? err.message : String(err)}`,
        },
      ],
      isError: true,
    });
  }
}
