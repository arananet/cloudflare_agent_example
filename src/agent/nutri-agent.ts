/**
 * NutriAgent — Cloudflare Durable Object Agent
 *
 * @developer Eduardo Arana
 *
 * A stateful agent that uses GLM-4 (via z.ai / BigModel API) and MCP tools
 * backed by the OpenFoodFacts database to answer nutritional questions.
 *
 * Architecture (3-layer):
 *   User ↔ WebSocket ↔ NutriAgent (DO) ↔ MCP Server ↔ OpenFoodFacts API
 *                                         ↕
 *                              GLM-4.7-Flash LLM (z.ai)
 *
 * The agent calls tools via the MCP Streamable HTTP server (/mcp)
 * rather than importing tool functions directly.
 */

import { Agent, type Connection, type WSMessage } from "agents";
import { McpClient } from "../mcp/client";
import type { Env } from "../types";

// ── system prompt ──────────────────────────────────────────────────────────

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

// ── message types ──────────────────────────────────────────────────────────

interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
}

interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

interface AgentState {
  messages: ChatMessage[];
  conversationId: string;
}

// ── agent ──────────────────────────────────────────────────────────────────

export class NutriAgent extends Agent<Env, AgentState> {
  // initialise empty conversation state
  initialState: AgentState = {
    messages: [],
    conversationId: crypto.randomUUID(),
  };

  // MCP client singleton (per DO instance)
  private mcpClient: McpClient | null = null;
  private llmTools: { type: "function"; function: { name: string; description: string; parameters: unknown } }[] | null = null;

  /** Lazily create MCP client pointing at our Worker's MCP endpoint. */
  private getMcpClient(): McpClient {
    if (!this.mcpClient) {
      // Construct internal URL to same Worker's /mcp endpoint
      // In Cloudflare Workers, we use the worker's own origin
      const baseUrl = "https://nutri-agent.workers.dev/mcp";
      this.mcpClient = new McpClient(baseUrl, this.env.MCP_API_KEY);
    }
    return this.mcpClient;
  }

  /** Get tools from MCP server in LLM function-calling format. */
  private async getLLMTools() {
    if (this.llmTools) return this.llmTools;

    try {
      const mcp = this.getMcpClient();
      const mcpTools = await mcp.listTools();
      this.llmTools = mcpTools.map((t) => ({
        type: "function" as const,
        function: {
          name: t.name,
          description: t.description as string,
          parameters: t.inputSchema,
        },
      }));
    } catch {
      // Fallback: use hardcoded tool definitions if MCP server unreachable
      // This keeps the agent functional during local dev or if MCP is down
      const { TOOL_DEFINITIONS } = await import("../tools");
      this.llmTools = TOOL_DEFINITIONS as any;
    }
    return this.llmTools!;
  }

  /** Execute a tool call via MCP server, with direct fallback. */
  private async executeTool(
    name: string,
    args: Record<string, unknown>
  ): Promise<string> {
    try {
      const mcp = this.getMcpClient();
      return await mcp.callTool(name, args);
    } catch {
      // Fallback: direct dispatch if MCP server is unreachable
      const { dispatchTool } = await import("../tools");
      const result = await dispatchTool(name, args);
      return JSON.stringify(result, null, 2);
    }
  }

  // ── pipeline status helper ──────────────────────────────────────────────

  /** Send a real-time pipeline progress event so the UI can visualise the flow. */
  private sendPipeline(
    connection: Connection,
    step: string,
    status: "active" | "complete",
    detail?: string
  ) {
    connection.send(
      JSON.stringify({ type: "pipeline", step, status, detail: detail ?? "" })
    );
  }

  // ── WebSocket lifecycle ────────────────────────────────────────────────

  async onConnect(connection: Connection) {
    connection.send(
      JSON.stringify({
        type: "welcome",
        message:
          "👋 Welcome to NutriAgent! Ask me about any food product — search by name, scan a barcode, or compare items.",
      })
    );
  }

  async onMessage(connection: Connection, message: WSMessage) {
    if (typeof message !== "string") return;

    let parsed: { type: string; content?: string };
    try {
      parsed = JSON.parse(message);
    } catch {
      parsed = { type: "chat", content: message };
    }

    if (parsed.type === "chat" && parsed.content) {
      await this.handleChat(connection, parsed.content);
    }
  }

  // ── core chat loop (tool-use loop) ─────────────────────────────────────

  private async handleChat(connection: Connection, userMessage: string) {
    // add user message to history
    const history = [...this.state.messages];
    history.push({ role: "user", content: userMessage });

    // ── pipeline: agent received query ──
    this.sendPipeline(connection, "agent", "active", "Processing your query");

    // signal legacy "thinking" for backwards compat
    connection.send(JSON.stringify({ type: "status", status: "thinking" }));

    try {
      // ── pipeline: calling LLM ──
      this.sendPipeline(connection, "llm", "active", "Reasoning with GLM-4.7-Flash");

      let assistantMessage = await this.callLLM(history);

      // agentic tool loop — keep calling tools until the model stops requesting them
      let maxIterations = 8;
      while (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0 && maxIterations-- > 0) {
        // push the assistant turn with tool_calls
        history.push(assistantMessage);

        // ── pipeline: routing through MCP ──
        this.sendPipeline(connection, "mcp", "active", "Routing tool calls via MCP Server");

        // execute each tool call via MCP server
        for (const tc of assistantMessage.tool_calls) {
          // ── pipeline: executing tool ──
          this.sendPipeline(
            connection,
            "tools",
            "active",
            `Executing ${tc.function.name}`
          );

          connection.send(
            JSON.stringify({
              type: "tool_call",
              tool: tc.function.name,
              args: tc.function.arguments,
            })
          );

          let result: string;
          try {
            const args = JSON.parse(tc.function.arguments);
            result = await this.executeTool(tc.function.name, args);
          } catch (err) {
            result = JSON.stringify({ error: String(err) });
          }

          // ── pipeline: tool complete ──
          this.sendPipeline(
            connection,
            "tools",
            "complete",
            `${tc.function.name} returned data`
          );

          history.push({
            role: "tool",
            tool_call_id: tc.id,
            content: result,
          });
        }

        // ── pipeline: re-calling LLM with results ──
        this.sendPipeline(connection, "llm", "active", "Analyzing tool results");

        // re-call LLM with tool results
        connection.send(JSON.stringify({ type: "status", status: "thinking" }));
        assistantMessage = await this.callLLM(history);
      }

      // final assistant reply
      history.push({ role: "assistant", content: assistantMessage.content ?? "" });

      // persist state
      this.setState({ ...this.state, messages: history });

      // ── pipeline: done ──
      this.sendPipeline(connection, "done", "complete", "Response ready");

      connection.send(
        JSON.stringify({
          type: "response",
          content: assistantMessage.content ?? "",
        })
      );
    } catch (err) {
      // ── pipeline: error ──
      this.sendPipeline(connection, "done", "complete", "Error encountered");

      connection.send(
        JSON.stringify({
          type: "error",
          message: `Sorry, something went wrong: ${err instanceof Error ? err.message : String(err)}`,
        })
      );
    }
  }

  // ── LLM call (GLM-4 via BigModel / z.ai compatible endpoint) ──────────

  private async callLLM(messages: ChatMessage[]): Promise<ChatMessage> {
    const apiKey = this.env.GLM_API_KEY;
    const baseUrl = this.env.GLM_BASE_URL ?? "https://api.z.ai/api/paas/v4";
    const model = this.env.GLM_MODEL ?? "GLM-4.7-Flash";

    // Get tools from MCP server (cached after first call)
    const tools = await this.getLLMTools();

    const body = {
      model,
      messages: [{ role: "system", content: SYSTEM_PROMPT }, ...messages],
      tools,
      tool_choice: "auto",
      temperature: 0.4,
      max_tokens: 2048,
    };

    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`GLM API ${res.status}: ${text}`);
    }

    const data = (await res.json()) as {
      choices: { message: ChatMessage & { reasoning_content?: string } }[];
    };

    const msg = data.choices[0].message;
    // GLM-4.7-Flash may return reasoning_content instead of content
    if (!msg.content && msg.reasoning_content) {
      msg.content = msg.reasoning_content;
    }
    return msg;
  }

  // ── HTTP fallback (non-WebSocket usage) ────────────────────────────────

  async onRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/chat" && request.method === "POST") {
      const { message } = (await request.json()) as { message: string };
      const history: ChatMessage[] = [...this.state.messages, { role: "user", content: message }];

      let assistantMsg = await this.callLLM(history);
      let iterations = 8;

      while (assistantMsg.tool_calls && assistantMsg.tool_calls.length > 0 && iterations-- > 0) {
        history.push(assistantMsg);
        for (const tc of assistantMsg.tool_calls) {
          let result: string;
          try {
            const args = JSON.parse(tc.function.arguments);
            result = await this.executeTool(tc.function.name, args);
          } catch (err) {
            result = JSON.stringify({ error: String(err) });
          }
          history.push({ role: "tool", tool_call_id: tc.id, content: result });
        }
        assistantMsg = await this.callLLM(history);
      }

      history.push({ role: "assistant", content: assistantMsg.content ?? "" });
      this.setState({ ...this.state, messages: history });

      return Response.json({ response: assistantMsg.content });
    }

    return new Response("NutriAgent is running", { status: 200 });
  }
}
