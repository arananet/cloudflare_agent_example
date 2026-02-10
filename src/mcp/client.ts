/**
 * MCP Client — calls the MCP Streamable HTTP server.
 *
 * @developer Eduardo Arana
 *
 * Used by the Agent layer to invoke tools through the MCP protocol
 * instead of importing tool functions directly.
 *
 * Flow: Agent → McpClient.callTool() → POST /mcp (JSON-RPC) → MCP Server → Tool
 */

export class McpClient {
  private baseUrl: string;
  private apiKey: string | undefined;
  private sessionId: string | null = null;
  private initialized = false;

  constructor(baseUrl: string, apiKey?: string) {
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
  }

  // ── internal JSON-RPC call ───────────────────────────────────────────────

  private async rpc(
    method: string,
    params?: Record<string, unknown>,
    id?: number
  ): Promise<unknown> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };

    if (this.apiKey) {
      headers["Authorization"] = `Bearer ${this.apiKey}`;
    }
    if (this.sessionId) {
      headers["Mcp-Session-Id"] = this.sessionId;
    }

    const body: Record<string, unknown> = {
      jsonrpc: "2.0",
      method,
    };
    if (id !== undefined) body.id = id;
    if (params) body.params = params;

    const res = await fetch(this.baseUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    // Capture session header
    const sid = res.headers.get("mcp-session-id");
    if (sid) this.sessionId = sid;

    // Notifications (202) have no body
    if (res.status === 202) return null;

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`MCP server ${res.status}: ${text}`);
    }

    const data = (await res.json()) as {
      result?: unknown;
      error?: { code: number; message: string; data?: unknown };
    };

    if (data.error) {
      throw new Error(`MCP error ${data.error.code}: ${data.error.message}`);
    }

    return data.result;
  }

  // ── public API ───────────────────────────────────────────────────────────

  /** Perform MCP handshake (initialize + notifications/initialized). */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    await this.rpc(
      "initialize",
      {
        protocolVersion: "2025-03-26",
        clientInfo: { name: "NutriAgent", version: "1.2.0" },
        capabilities: {},
      },
      1
    );

    // Send initialized notification (no id)
    await this.rpc("notifications/initialized");

    this.initialized = true;
  }

  /** List available tools from the MCP server. */
  async listTools(): Promise<
    { name: string; description: string; inputSchema: unknown }[]
  > {
    await this.initialize();
    const result = (await this.rpc("tools/list", undefined, 2)) as {
      tools: { name: string; description: string; inputSchema: unknown }[];
    };
    return result.tools;
  }

  /**
   * Call a tool by name with the given arguments.
   * Returns the tool's text response or throws on error.
   */
  async callTool(
    name: string,
    args: Record<string, unknown>
  ): Promise<string> {
    await this.initialize();

    const result = (await this.rpc(
      "tools/call",
      { name, arguments: args },
      Date.now()
    )) as {
      content: { type: string; text: string }[];
      isError?: boolean;
    };

    const text = result.content
      .filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("\n");

    if (result.isError) {
      throw new Error(text);
    }

    return text;
  }
}
