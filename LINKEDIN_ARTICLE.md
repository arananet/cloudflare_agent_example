# Building an AI Agent on the Edge: Exploring Cloudflare's Agents SDK

**By Eduardo Arana**

---

The AI agent landscape is evolving fast. Every major cloud provider is racing to offer agent frameworks — but what if your agent could run at the edge, in over 300 cities worldwide, with zero cold starts and built-in state management?

That's exactly the promise of **Cloudflare's Agents SDK**, and I decided to put it to the test by building a fully functional proof of concept: **NutriAgent** — a nutritional intelligence agent that can look up any food product, compare nutritional profiles, decode labels, and check allergens from a database of over 4 million products.

Here's what I learned, what surprised me, and what I think it means for the future of agentic AI on the edge.

---

## Why Cloudflare for AI Agents?

When we think about deploying AI agents, the usual suspects come to mind — AWS Lambda, Azure Functions, or a long-running server somewhere. But Cloudflare Workers with Durable Objects offer something genuinely different:

**Stateful by default.** Durable Objects give each agent instance persistent state backed by SQLite — no external database needed. Your agent remembers the conversation, the context, and the session across requests automatically.

**Edge-native.** Your agent runs in the data center closest to the user. For real-time WebSocket interactions, this means sub-millisecond routing latency.

**WebSocket-first.** The Agents SDK provides first-class WebSocket support for building real-time chat interfaces. No polling, no SSE hacks — proper bidirectional communication baked into the framework.

**Zero cold starts.** Unlike traditional serverless functions, Durable Objects are essentially "warm" stateful microservices. Once instantiated, they stay alive and responsive.

These aren't just incremental improvements — they fundamentally change the architecture of what an AI agent can be.

---

## The Architecture: Three Layers, One Worker

One of my key design goals was to build a proper **3-layer architecture** within a single Cloudflare Worker, proving that edge-based agents can be just as well-structured as traditional backend systems.

```
┌──────────────────────────────────────────────────────────────────┐
│                     Cloudflare Worker (Edge)                     │
│                                                                  │
│   ┌───────────┐    ┌──────────────────┐    ┌─────────────────┐  │
│   │  Chat UI  │◄──►│   NutriAgent DO  │◄──►│ MCP Server      │  │
│   │  (HTML)   │ WS │  (Agent Layer)   │HTTP│ (Tool Layer)    │  │
│   └───────────┘    │                  │    │                 │  │
│   Basic Auth       │  ┌────────────┐  │    │ 5 Tools for     │  │
│                    │  │ GLM-4.7    │  │    │ OpenFoodFacts   │  │
│   ┌───────────┐    │  │ Flash LLM  │  │    │ API             │  │
│   │ A2A Proto │◄──►│  └────────────┘  │    └────────┬────────┘  │
│   │ Endpoint  │    └──────────────────┘             │           │
│   └───────────┘                           ┌─────────▼─────────┐ │
│                                           │  OpenFoodFacts    │ │
│                                           │  (4M+ products)   │ │
│                                           └───────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
```

### Layer 1: The Chat UI

A single-file HTML application — zero JavaScript dependencies, no npm, no bundler. Dark organic theme with grain textures, Playfair Display typography, real-time WebSocket communication, and full markdown rendering including tables. It even shows a live **processing pipeline** widget that visualizes the flow between Agent → LLM → MCP → Tools in real-time as your query is being processed.

Why single-file? Because it ships as a static asset inside the Worker bundle. There's no CDN, no S3 bucket, no separate frontend deployment. Just one artifact that includes everything.

### Layer 2: The Agent (Durable Object)

The heart of the system. NutriAgent is a Cloudflare Durable Object that:

- Maintains conversation history across messages
- Runs an autonomous **tool-use loop** (up to 8 iterations) where the LLM decides which tools to call
- Communicates with the LLM via the OpenAI-compatible chat completions API
- Calls tools through the MCP protocol rather than importing them directly
- Streams real-time status events over WebSocket so the UI can show exactly what's happening

### Layer 3: The MCP Server (Streamable HTTP)

The tools live behind a **Model Context Protocol** server — the same open standard that's rapidly becoming the lingua franca for tool-callable AI services. My implementation uses the Streamable HTTP transport with JSON-RPC 2.0, supporting:

- `initialize` — protocol handshake with capability negotiation
- `tools/list` — dynamic tool discovery
- `tools/call` — tool invocation with structured input/output
- Session management via `Mcp-Session-Id` headers
- Batch request support

This means NutriAgent's tools aren't just callable by the agent — they're callable by **any MCP-compatible client**. Claude Desktop, Cursor, custom agents — they can all connect to the same MCP endpoint and use the same nutritional tools.

---

## The A2A Protocol: Agent Interoperability

Beyond MCP, I implemented the **Agent-to-Agent (A2A)** protocol — an emerging standard for agents to discover and communicate with each other. NutriAgent exposes:

- A public **Agent Card** at `/.well-known/agent-card.json` — a standardized discovery document that describes the agent's capabilities, skills, and endpoint
- A JSON-RPC endpoint at `/a2a` supporting `SendMessage` and `GetTask` methods
- A task lifecycle model: `submitted → working → completed/failed`

Why does this matter? Imagine a wellness app agent that orchestrates multiple specialized agents — a meal planner, a fitness tracker, and NutriAgent for nutritional data. With A2A, they can discover and talk to each other without any custom integration code.

This is where the industry is heading: **composable, interoperable agents** rather than monolithic all-in-one systems.

---

## GLM-4.7-Flash: A Free-Tier LLM That Actually Works

One of the most interesting parts of this exploration was the LLM choice. Instead of reaching for GPT-4o or Claude, I went with **GLM-4.7-Flash** from Zhipu AI (BigModel / z.ai) — a free-tier model that supports function calling.

### What worked well:

- **OpenAI-compatible API** — The z.ai endpoint follows the same chat completions format, so switching models is trivial
- **Function calling** — GLM-4.7-Flash correctly handles tool definitions, generates structured tool call arguments, and follows multi-turn tool-use patterns
- **Free tier** — No credit card, no usage limits that matter for development and prototyping
- **Reasonable quality** — For a specialized domain agent (nutrition data lookup), the model performs well since it's mostly routing queries to tools rather than generating creative content

### Gotchas and considerations:

- **Case-sensitive model name** — The model identifier `GLM-4.7-Flash` must be exact. Sending `glm-4` or `GLM-4.7-flash` returns errors. This cost me some debugging time.
- **`reasoning_content` vs `content`** — The Flash model sometimes returns its response in a `reasoning_content` field instead of the standard `content` field. I had to add a fallback:

```typescript
const msg = data.choices[0].message;
if (!msg.content && msg.reasoning_content) {
  msg.content = msg.reasoning_content;
}
```

- **Temperature tuning** — For tool-routing agents, lower temperatures (0.3-0.4) work better than defaults. The agent needs to be precise about when to call tools, not creative.

The key insight: **for domain-specific agents that primarily orchestrate tools, the model tier matters less than you'd think.** The intelligence is in the tool design and system prompt, not in the raw model capabilities.

---

## MCP Tools: Designing for the Agent Loop

The five nutritional tools are backed by the OpenFoodFacts API — the world's largest open food database:

| Tool | What it does |
|---|---|
| `get_product_by_barcode` | Full nutritional data by EAN/UPC code |
| `search_products` | Keyword search with pagination |
| `get_products_by_category` | Browse products by category |
| `compare_products` | Side-by-side comparison of multiple products |
| `get_allergen_info` | Allergen and trace analysis |

### Design choices that matter for agents:

1. **Lean responses.** The raw OpenFoodFacts API returns massive JSON payloads (nutrients, images, ingredient lists, data quality scores). I wrote extractors that return only what's relevant — brand, name, Nutri-Score, NOVA group, key macronutrients, and allergens. Agents have context windows; every wasted token is a cost.

2. **Descriptive parameter schemas.** Each tool has Zod-validated input with clear descriptions. The LLM uses these descriptions to decide which tool to call and how to fill parameters. Vague schemas lead to wrong tool calls.

3. **Graceful failure.** Tools return structured error objects rather than throwing. An agent that crashes on a 404 from OpenFoodFacts is useless — one that tells the user "Product not found, try searching by name instead" is helpful.

4. **Fallback architecture.** The agent calls tools via MCP, but if the MCP server is unreachable (local dev, configuration issue), it falls back to direct function dispatch. The user never knows the difference.

---

## Security: Per-Layer Authentication

Each of the three exposure layers has independent authentication:

| Layer | Auth | Secret |
|---|---|---|
| Chat UI + Agent | Basic Auth | `AUTH_USER` / `AUTH_PASS` |
| MCP Server | Bearer Token | `MCP_API_KEY` |
| A2A Endpoint | Bearer Token | `A2A_API_KEY` |
| Agent Card + Health | Public | — |

All secrets are stored as Cloudflare Worker secrets — encrypted at rest, never in code. The Agent Card is intentionally public (that's the discovery protocol), and the health endpoint is public for monitoring.

This means you can expose the MCP endpoint to a team of Claude Desktop users with one token, while keeping the A2A endpoint locked to specific agents with a different token, while the chat UI uses traditional username/password auth.

---

## Real-Time Processing Pipeline

One of the features I'm most proud of is the **live processing pipeline** in the UI. When you send a query, instead of just showing a generic "thinking..." spinner, the UI displays an animated flow diagram:

```
🤖 Agent  →  🧠 LLM  →  🔌 MCP  →  ⚡ Tools
```

Each node lights up and pulses as that step is active, with a detail line showing exactly what's happening — "Reasoning with GLM-4.7-Flash", "Routing tool calls via MCP Server", "Executing search_products". When processing completes, the pipeline collapses into a compact summary that stays in the chat history.

This was made possible by the WebSocket-first architecture. The agent sends granular `pipeline` events as it moves through each processing phase, and the UI renders them in real-time. No polling, no delays — you see the agent's thought process as it happens.

---

## Lessons Learned

### 1. Durable Objects are the perfect abstraction for agents
The combination of persistent state, WebSocket support, and single-threaded execution model maps perfectly to the agent paradigm. Each conversation gets its own stateful object instance with isolated state. This is exactly what agents need.

### 2. MCP changes the game for tool interoperability
By putting tools behind an MCP server, they become reusable assets. The same tools that power NutriAgent's chat can be used by any MCP-compatible client — an IDE, another agent, a data pipeline. Build once, expose everywhere.

### 3. Edge deployment matters for real-time agents
When your agent is running in the city closest to the user, WebSocket latency drops dramatically. For interactive chat, this creates a noticeably snappier experience compared to a centralized deployment.

### 4. Single-Worker architecture keeps things simple
Having the UI, agent, MCP server, and A2A endpoint all in one Worker might sound like a compromise — but with proper route organization and layer separation, it's actually cleaner than managing four separate services. One deploy, one bundle, one URL.

### 5. The free-tier LLM landscape is surprisingly capable
For tool-routing agents where the LLM is primarily deciding which tool to call rather than generating novel content, free-tier models like GLM-4.7-Flash are genuinely viable. The agentic loop architecture means you can start with a free model and upgrade to a premium one later by changing a single environment variable.

---

## What's Next

This POC demonstrates that Cloudflare's Agents SDK is ready for serious agent development. The combination of Durable Objects for state, Workers for edge execution, and standard protocols (MCP + A2A) for interoperability creates a compelling platform.

I'm particularly excited about the **multi-agent composition** possibilities. With A2A support, NutriAgent can be a building block in larger agent workflows — a meal planning agent that delegates nutritional queries, a health monitoring system that pulls food data automatically, or a grocery shopping assistant that compares products in real-time.

The full source code is available for reference, and I'd love to hear from others who are exploring agentic architectures on the edge.

---

## Tech Stack

- **Runtime:** Cloudflare Workers + Durable Objects
- **Agent Framework:** Cloudflare Agents SDK v0.0.50
- **LLM:** GLM-4.7-Flash (z.ai / BigModel API)
- **Protocols:** MCP (Streamable HTTP), A2A (JSON-RPC)
- **Data Source:** OpenFoodFacts API (4M+ products)
- **Frontend:** Zero-dependency single-file HTML/CSS/JS
- **Lang:** TypeScript, served at the edge

---

*What's your experience with building AI agents on edge platforms? I'd love to hear about different approaches and architectures in the comments.*

#AI #ArtificialIntelligence #CloudflareWorkers #Cloudflare #AIAgents #MCP #ModelContextProtocol #A2A #EdgeComputing #Serverless #TypeScript #MachineLearning #WebDevelopment #OpenSource #AgenticAI #LLM #FoodTech #Innovation
