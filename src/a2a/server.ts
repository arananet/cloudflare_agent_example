/**
 * A2A Protocol Server
 *
 * @developer Eduardo Arana
 *
 * Implements the Agent-to-Agent (A2A) protocol for NutriAgent, enabling
 * interoperability with other A2A-compatible agents and clients.
 *
 * Endpoints:
 *   GET  /.well-known/agent-card.json → Agent Card (public, no auth)
 *   POST /a2a                         → JSON-RPC (SendMessage, GetTask)
 *
 * Security:
 *   - A2A endpoint protected by Bearer token (A2A_API_KEY)
 *   - Agent Card is publicly accessible for discovery
 *
 * Spec: https://a2a-protocol.org/specification/
 */

import type { Env } from "../types";
import { McpClient } from "../mcp/client";
import type {
  AgentCard,
  A2AJsonRpcRequest,
  SendMessageParams,
  GetTaskParams,
  Task,
  Message,
  TaskState,
} from "./types";

// ── in-memory task store ───────────────────────────────────────────────────

const taskStore = new Map<string, Task>();

// ── agent card ─────────────────────────────────────────────────────────────

export function buildAgentCard(env: Env, baseUrl: string): AgentCard {
  return {
    name: "NutriAgent",
    description:
      "An AI-powered nutritional facts agent that helps users explore food products, " +
      "check nutritional information, compare items, and verify allergens using the " +
      "OpenFoodFacts database. Powered by GLM-4.7-Flash.",
    url: `${baseUrl}/a2a`,
    version: "1.2.0",
    protocolVersion: "0.3",
    provider: {
      organization: "Eduardo Arana",
      url: baseUrl,
    },
    capabilities: {
      streaming: false,
      pushNotifications: false,
      stateTransitionHistory: false,
    },
    securitySchemes: {
      bearer: {
        type: "http",
        scheme: "bearer",
        description: "Bearer token authentication using A2A_API_KEY",
      },
    },
    security: [{ bearer: [] }],
    defaultInputModes: ["text/plain"],
    defaultOutputModes: ["text/plain"],
    skills: [
      {
        id: "nutrition-lookup",
        name: "Nutrition Lookup",
        description:
          "Look up nutritional facts for any food product by barcode, name, or category",
        tags: ["nutrition", "food", "health", "barcode", "search"],
        examples: [
          "What are the nutritional facts for Nutella?",
          "Look up barcode 3017620422003",
          "Search for Greek yogurt products",
        ],
      },
      {
        id: "product-comparison",
        name: "Product Comparison",
        description:
          "Compare nutritional profiles, Nutri-Score, and NOVA groups across multiple food products",
        tags: ["comparison", "nutri-score", "nutrition"],
        examples: [
          "Compare Nutella vs peanut butter",
          "Which breakfast cereal has less sugar?",
        ],
      },
      {
        id: "allergen-check",
        name: "Allergen Check",
        description:
          "Check allergens and traces in food products for dietary restriction verification",
        tags: ["allergens", "dietary", "safety", "traces"],
        examples: [
          "Does this product contain gluten?",
          "Check allergens for barcode 3017620422003",
        ],
      },
    ],
  };
}

// ── Agent Card endpoint ────────────────────────────────────────────────────

export function handleAgentCard(request: Request, env: Env): Response {
  const baseUrl = new URL(request.url).origin;
  const card = buildAgentCard(env, baseUrl);

  return Response.json(card, {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=3600",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

// ── A2A auth ───────────────────────────────────────────────────────────────

function checkA2AAuth(request: Request, env: Env): Response | null {
  if (!env.A2A_API_KEY) return null; // no auth configured

  const auth = request.headers.get("Authorization");
  if (!auth || !auth.startsWith("Bearer ")) {
    return Response.json(
      {
        jsonrpc: "2.0",
        id: null,
        error: { code: -32001, message: "Unauthorized: Bearer token required" },
      },
      { status: 401, headers: { "Content-Type": "application/json" } }
    );
  }

  if (auth.slice(7) !== env.A2A_API_KEY) {
    return Response.json(
      {
        jsonrpc: "2.0",
        id: null,
        error: { code: -32001, message: "Unauthorized: invalid token" },
      },
      { status: 401, headers: { "Content-Type": "application/json" } }
    );
  }

  return null;
}

// ── A2A JSON-RPC endpoint ──────────────────────────────────────────────────

export async function handleA2ARequest(
  request: Request,
  env: Env
): Promise<Response> {
  // CORS preflight
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers":
          "Content-Type, Authorization, Accept",
      },
    });
  }

  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  // Auth gate
  const authErr = checkA2AAuth(request, env);
  if (authErr) return authErr;

  // Parse JSON-RPC request
  let rpcReq: A2AJsonRpcRequest;
  try {
    rpcReq = (await request.json()) as A2AJsonRpcRequest;
  } catch {
    return Response.json(
      {
        jsonrpc: "2.0",
        id: null,
        error: { code: -32700, message: "Parse error" },
      },
      { status: 400 }
    );
  }

  if (rpcReq.jsonrpc !== "2.0" || !rpcReq.method) {
    return Response.json(
      {
        jsonrpc: "2.0",
        id: rpcReq.id ?? null,
        error: { code: -32600, message: "Invalid JSON-RPC request" },
      },
      { status: 400 }
    );
  }

  // Dispatch method
  let result: unknown;
  try {
    switch (rpcReq.method) {
      case "SendMessage":
        result = await handleSendMessage(rpcReq.params as unknown as SendMessageParams, env, request);
        break;
      case "GetTask":
        result = handleGetTask(rpcReq.params as unknown as GetTaskParams);
        break;
      default:
        return Response.json(
          {
            jsonrpc: "2.0",
            id: rpcReq.id,
            error: {
              code: -32601,
              message: `Method not found: ${rpcReq.method}`,
            },
          },
          { status: 200 }
        );
    }
  } catch (err) {
    return Response.json(
      {
        jsonrpc: "2.0",
        id: rpcReq.id,
        error: {
          code: -32000,
          message: err instanceof Error ? err.message : String(err),
        },
      },
      { status: 200 }
    );
  }

  return Response.json(
    { jsonrpc: "2.0", id: rpcReq.id, result },
    { headers: { "Content-Type": "application/json" } }
  );
}

// ── SendMessage handler ────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are NutriAgent, a friendly and knowledgeable nutrition assistant.
You help users explore food products, check nutritional facts, compare items,
and understand food labels using the OpenFoodFacts database.

CAPABILITIES (via tools):
• Look up any product by barcode (EAN/UPC)
• Search products by name or keyword
• Browse products by category
• Compare nutritional profiles across products
• Check allergens and traces for dietary restrictions

GUIDELINES:
• Always use the tools to get real data — never make up nutritional values.
• Present nutrient data in a clear, readable format.
• Explain Nutri-Score (A-E), NOVA group (1-4), and Eco-Score when relevant.
• If a product is not found, suggest alternative searches.
• Be concise but thorough. Use tables when comparing products.
• When listing nutrients use per-100g values with units.
• Proactively warn about allergens when they appear in results.`;

async function handleSendMessage(
  params: SendMessageParams,
  env: Env,
  request: Request
): Promise<{ task: Task } | { message: Message }> {
  const userMessage = params.message;
  const userText = userMessage.parts
    .filter((p): p is { text: string } => "text" in p)
    .map((p) => p.text)
    .join("\n");

  if (!userText.trim()) {
    throw new Error("Message must contain at least one text part");
  }

  // Create a task
  const taskId = crypto.randomUUID();
  const contextId = userMessage.contextId ?? crypto.randomUUID();
  const baseUrl = new URL(request.url).origin;

  const task: Task = {
    id: taskId,
    contextId,
    status: {
      state: "working",
      timestamp: new Date().toISOString(),
    },
  };
  taskStore.set(taskId, task);

  try {
    // Build MCP client pointing at our own MCP server
    const mcpUrl = `${baseUrl}/mcp`;
    const mcpClient = new McpClient(mcpUrl, env.MCP_API_KEY);

    // Get available tools from MCP server
    const mcpTools = await mcpClient.listTools();

    // Convert MCP tools to OpenAI function-calling format for the LLM
    const llmTools = mcpTools.map((t) => ({
      type: "function" as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.inputSchema,
      },
    }));

    // Chat messages for LLM
    const messages = [
      { role: "system" as const, content: SYSTEM_PROMPT },
      { role: "user" as const, content: userText },
    ];

    // Call LLM with tool-use loop
    const apiKey = env.GLM_API_KEY;
    const baseUrlApi = env.GLM_BASE_URL ?? "https://api.z.ai/api/paas/v4";
    const model = env.GLM_MODEL ?? "GLM-4.7-Flash";

    let assistantMsg = await callLLM(baseUrlApi, apiKey, model, messages, llmTools);
    let iterations = 8;

    while (assistantMsg.tool_calls && assistantMsg.tool_calls.length > 0 && iterations-- > 0) {
      messages.push(assistantMsg as any);

      for (const tc of assistantMsg.tool_calls) {
        let result: string;
        try {
          const args = JSON.parse(tc.function.arguments);
          result = await mcpClient.callTool(tc.function.name, args);
        } catch (err) {
          result = JSON.stringify({ error: String(err) });
        }

        messages.push({
          role: "tool" as const,
          tool_call_id: tc.id,
          content: result,
        } as any);
      }

      assistantMsg = await callLLM(baseUrlApi, apiKey, model, messages, llmTools);
    }

    const responseText = assistantMsg.content ?? "";

    // Update task to completed
    const completedTask: Task = {
      id: taskId,
      contextId,
      status: {
        state: "completed",
        timestamp: new Date().toISOString(),
      },
      artifacts: [
        {
          artifactId: crypto.randomUUID(),
          name: "response",
          parts: [{ text: responseText }],
        },
      ],
    };

    taskStore.set(taskId, completedTask);
    return { task: completedTask };
  } catch (err) {
    // Update task to failed
    const failedTask: Task = {
      id: taskId,
      contextId,
      status: {
        state: "failed" as TaskState,
        message: {
          role: "agent",
          parts: [
            { text: `Error: ${err instanceof Error ? err.message : String(err)}` },
          ],
          messageId: crypto.randomUUID(),
        },
        timestamp: new Date().toISOString(),
      },
    };

    taskStore.set(taskId, failedTask);
    return { task: failedTask };
  }
}

// ── GetTask handler ────────────────────────────────────────────────────────

function handleGetTask(params: GetTaskParams): Task {
  const task = taskStore.get(params.id);
  if (!task) {
    throw new Error(`Task not found: ${params.id}`);
  }
  return task;
}

// ── LLM helper (same as agent but standalone) ──────────────────────────────

interface LLMMessage {
  role: string;
  content?: string;
  tool_call_id?: string;
  tool_calls?: { id: string; type: string; function: { name: string; arguments: string } }[];
}

async function callLLM(
  baseUrl: string,
  apiKey: string,
  model: string,
  messages: LLMMessage[],
  tools: unknown[]
): Promise<LLMMessage> {
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      tools,
      tool_choice: "auto",
      temperature: 0.4,
      max_tokens: 2048,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GLM API ${res.status}: ${text}`);
  }

  const data = (await res.json()) as {
    choices: { message: LLMMessage & { reasoning_content?: string } }[];
  };

  const msg = data.choices[0].message;
  if (!msg.content && msg.reasoning_content) {
    msg.content = msg.reasoning_content;
  }
  return msg;
}
