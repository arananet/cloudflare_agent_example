# NutriAgent — Cloudflare AI Agent for Nutritional Facts

A stateful AI agent built on **Cloudflare Workers + Durable Objects** using the
[Agents SDK](https://developers.cloudflare.com/agents/). It answers nutritional
questions by autonomously calling tools via an **MCP Streamable HTTP** server
backed by the [OpenFoodFacts](https://world.openfoodfacts.org/) open database,
powered by **GLM-4.7-Flash** (via the BigModel / z.ai API).

Implements the **A2A (Agent-to-Agent)** protocol for interoperability with
other A2A-compatible agents and clients.

```
┌──────────────────────────────────────────────────────────────────────┐
│                     Cloudflare Worker (Edge)                        │
│                                                                     │
│   ┌───────────┐    ┌──────────────────┐    ┌─────────────────────┐  │
│   │  Chat UI  │◄──►│   NutriAgent DO  │◄──►│ MCP Server (HTTP)   │  │
│   │  (HTML)   │ WS │  (Agent Layer)   │POST│ (Tool Layer)        │  │
│   └───────────┘    │                  │    │                     │  │
│   Basic Auth       │  ┌────────────┐  │    │ • get_product_by_   │  │
│                    │  │ GLM-4.7    │  │    │   barcode           │  │
│   ┌───────────┐    │  │ Flash LLM  │  │    │ • search_products   │  │
│   │ A2A Proto │◄──►│  └────────────┘  │    │ • get_products_by_  │  │
│   │ Endpoint  │JSON│                  │    │   category          │  │
│   └───────────┘ RPC└──────────────────┘    │ • compare_products  │  │
│   Bearer Auth                              │ • get_allergen_info │  │
│                                            └────────┬────────────┘  │
│                                            Bearer Auth│             │
└────────────────────────────────────────────────────────┘             │
                                                         │             
                                              ┌──────────▼──────────┐
                                              │  OpenFoodFacts API  │
                                              │  (4M+ products)     │
                                              └─────────────────────┘
```

---

## Features

| Capability | Description |
|---|---|
| **Barcode Lookup** | Scan any EAN/UPC barcode to get full nutritional facts |
| **Product Search** | Search by name/keyword across 4 M+ products |
| **Category Browse** | Explore products in categories like yogurts, cereals, sodas |
| **Product Compare** | Side-by-side Nutri-Score & macros comparison |
| **Allergen Check** | Identify allergens and traces for dietary safety |
| **Stateful Chat** | Conversation history persisted in the Durable Object |
| **Real-time WS** | WebSocket streaming with tool-call visibility |
| **MCP Server** | Streamable HTTP transport — tools callable by any MCP client |
| **A2A Protocol** | Agent-to-Agent interoperability via JSON-RPC |
| **3-Layer Auth** | Separate auth for UI, MCP, and A2A layers |

## Architecture

```
src/
├── index.ts                  # Worker entry — routes all layers
├── types.ts                  # Env type bindings (secrets + vars)
├── auth.ts                   # Basic auth middleware (UI layer)
├── mcp/
│   ├── server.ts             # MCP Streamable HTTP server (JSON-RPC)
│   ├── client.ts             # MCP client (used by agent to call tools)
│   └── index.ts
├── a2a/
│   ├── server.ts             # A2A protocol handler (JSON-RPC)
│   ├── types.ts              # A2A type definitions
│   └── index.ts
├── agent/
│   └── nutri-agent.ts        # NutriAgent Durable Object (state, LLM loop)
├── tools/
│   └── openfoodfacts.ts      # Tool implementations + OpenFoodFacts API client
└── public/
    ├── index.html            # Chat UI (single-file, zero deps)
    └── login.html            # Login page
```

## Quick Start

### Prerequisites

- Node.js ≥ 20
- A [Cloudflare account](https://dash.cloudflare.com/) (for deploy)
- A GLM API key from [BigModel / z.ai](https://open.bigmodel.cn/)

### 1. Install

```bash
npm install
```

### 2. Configure

Create `.dev.vars` (git-ignored) with your secrets:

```env
GLM_API_KEY=your_glm_api_key_here

# Optional — remove to disable auth on each layer
AUTH_USER=admin
AUTH_PASS=your_password
MCP_API_KEY=your_mcp_token
A2A_API_KEY=your_a2a_token
```

The model and endpoint are set in `wrangler.toml` under `[vars]`.

### 3. Run Locally

```bash
npm start          # or: npx wrangler dev
```

Open [http://localhost:8787](http://localhost:8787) in your browser.

### 4. Deploy

```bash
# Store secrets
npx wrangler secret put GLM_API_KEY
npx wrangler secret put AUTH_USER
npx wrangler secret put AUTH_PASS
npx wrangler secret put MCP_API_KEY
npx wrangler secret put A2A_API_KEY

# Deploy
npm run deploy
```

---

## API Reference

### Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/` | Basic | Chat UI |
| `GET` | `/health` | None | Health check + layer discovery |
| `GET` | `/.well-known/agent-card.json` | None | A2A Agent Card (public discovery) |
| `POST` | `/a2a` | Bearer (`A2A_API_KEY`) | A2A JSON-RPC endpoint |
| `POST` | `/mcp` | Bearer (`MCP_API_KEY`) | MCP JSON-RPC endpoint |
| `GET` | `/mcp` | Bearer (`MCP_API_KEY`) | MCP SSE keepalive stream |
| `DELETE` | `/mcp` | Bearer (`MCP_API_KEY`) | Close MCP session |
| `*` | `/agents/*` | Basic | Agent SDK (WebSocket + REST) |

---

## MCP Server (Streamable HTTP)

The MCP server exposes nutritional tools via the **Model Context Protocol**
with Streamable HTTP transport ([spec](https://modelcontextprotocol.io/specification/2025-03-26/basic/transports#streamable-http)).

### Authentication

```
Authorization: Bearer <MCP_API_KEY>
```

If `MCP_API_KEY` is not set, the MCP endpoint is publicly accessible.

### Protocol Handshake

```bash
# 1. Initialize
curl -X POST https://your-worker.workers.dev/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <MCP_API_KEY>" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {
      "protocolVersion": "2025-03-26",
      "clientInfo": { "name": "my-client", "version": "1.0" },
      "capabilities": {}
    }
  }'

# Response includes Mcp-Session-Id header — use it in subsequent requests
```

### List Tools

```bash
curl -X POST https://your-worker.workers.dev/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <MCP_API_KEY>" \
  -H "Mcp-Session-Id: <session-id>" \
  -d '{"jsonrpc": "2.0", "id": 2, "method": "tools/list"}'
```

### Call a Tool

```bash
curl -X POST https://your-worker.workers.dev/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <MCP_API_KEY>" \
  -H "Mcp-Session-Id: <session-id>" \
  -d '{
    "jsonrpc": "2.0",
    "id": 3,
    "method": "tools/call",
    "params": {
      "name": "search_products",
      "arguments": { "query": "greek yogurt", "page_size": 3 }
    }
  }'
```

### Available MCP Tools

| Tool | Description | Parameters |
|---|---|---|
| `get_product_by_barcode` | Full product data by EAN/UPC | `barcode` |
| `search_products` | Keyword search | `query`, `page?`, `page_size?` |
| `get_products_by_category` | Browse by category | `category`, `page?`, `page_size?` |
| `compare_products` | Compare multiple products | `barcodes[]` |
| `get_allergen_info` | Allergen + trace data | `barcode` |

---

## A2A Protocol (Agent-to-Agent)

NutriAgent implements the **A2A protocol** ([spec](https://a2a-protocol.org/specification/))
for interoperability with other AI agents. Any A2A-compatible client can discover
and interact with NutriAgent programmatically.

### Agent Discovery

The Agent Card is publicly accessible at:

```
GET /.well-known/agent-card.json
```

Response (excerpt):

```json
{
  "name": "NutriAgent",
  "description": "An AI-powered nutritional facts agent...",
  "url": "https://your-worker.workers.dev/a2a",
  "version": "1.2.0",
  "capabilities": {
    "streaming": false,
    "pushNotifications": false
  },
  "skills": [
    {
      "id": "nutrition-lookup",
      "name": "Nutrition Lookup",
      "description": "Look up nutritional facts for any food product..."
    },
    {
      "id": "product-comparison",
      "name": "Product Comparison",
      "description": "Compare nutritional profiles across multiple products..."
    },
    {
      "id": "allergen-check",
      "name": "Allergen Check",
      "description": "Check allergens and traces in food products..."
    }
  ]
}
```

### Send a Message (A2A)

```bash
curl -X POST https://your-worker.workers.dev/a2a \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <A2A_API_KEY>" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "SendMessage",
    "params": {
      "message": {
        "role": "user",
        "parts": [{ "text": "What are the nutritional facts for Nutella?" }],
        "messageId": "msg-001"
      }
    }
  }'
```

Response:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "task": {
      "id": "task-uuid",
      "contextId": "context-uuid",
      "status": {
        "state": "completed",
        "timestamp": "2025-01-01T00:00:00.000Z"
      },
      "artifacts": [
        {
          "artifactId": "artifact-uuid",
          "name": "response",
          "parts": [{ "text": "Here are the nutritional facts for Nutella..." }]
        }
      ]
    }
  }
}
```

### Get Task Status

```bash
curl -X POST https://your-worker.workers.dev/a2a \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <A2A_API_KEY>" \
  -d '{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "GetTask",
    "params": { "id": "task-uuid" }
  }'
```

### A2A Task States

| State | Description |
|---|---|
| `submitted` | Task received, not yet started |
| `working` | Agent is processing the task |
| `completed` | Task finished successfully (artifacts available) |
| `failed` | Task failed with error message |
| `input-required` | Agent needs additional input |
| `canceled` | Task was canceled |

---

## Security Model

Each layer has independent authentication:

| Layer | Auth Type | Secret | Optional? |
|---|---|---|---|
| **UI / Agent** | Basic Auth | `AUTH_USER` + `AUTH_PASS` | Yes — public if unset |
| **MCP Server** | Bearer Token | `MCP_API_KEY` | Yes — public if unset |
| **A2A Endpoint** | Bearer Token | `A2A_API_KEY` | Yes — public if unset |
| **Agent Card** | None (public) | — | Always public for discovery |
| **Health** | None (public) | — | Always public |

For production, set all secrets via:

```bash
npx wrangler secret put AUTH_USER
npx wrangler secret put AUTH_PASS
npx wrangler secret put MCP_API_KEY
npx wrangler secret put A2A_API_KEY
npx wrangler secret put GLM_API_KEY
```

---

## LLM Configuration

The agent uses **GLM-4.7-Flash** via the OpenAI-compatible BigModel API.
The model supports function-calling, which drives the autonomous tool-use loop.
The Flash variant is free-tier and returns `reasoning_content` alongside `content`.

| Variable | Default | Description |
|---|---|---|
| `GLM_API_KEY` | — | API key (`.dev.vars` / Wrangler secrets) |
| `GLM_BASE_URL` | `https://api.z.ai/api/paas/v4` | API endpoint |
| `GLM_MODEL` | `GLM-4.7-Flash` | Model identifier (case-sensitive) |

---

## UI

Single-file chat interface (`src/public/index.html`) with:

- Dark organic theme with grain texture overlay and ambient glow
- Playfair Display + DM Sans typography pairing
- Welcome screen with quick-start chips (returns via "↺" button)
- Proper markdown rendering with table, list, and code block support
- Tool-call visibility badges
- Fully responsive — works on mobile and desktop

Design follows the `skills/frontend-design/SKILL.md` guidelines for distinctive,
non-generic UI aesthetics.

---

## Developed by

**Eduardo Arana**

## License

MIT
