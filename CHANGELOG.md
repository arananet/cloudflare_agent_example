# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.0] - 2026-02-10

### Added
- **MCP Streamable HTTP server** (`src/mcp/server.ts`) — exposes nutritional tools
  via the Model Context Protocol with JSON-RPC 2.0 over HTTP. Supports `initialize`,
  `tools/list`, `tools/call`, `ping`, session management via `Mcp-Session-Id` header,
  and batch requests. Secured by Bearer token (`MCP_API_KEY`).
- **MCP client** (`src/mcp/client.ts`) — used by the Agent layer to call tools
  through the MCP server instead of importing them directly. Handles protocol
  handshake, session tracking, and error handling with direct-dispatch fallback.
- **A2A protocol support** (`src/a2a/`) — Agent-to-Agent interoperability:
  - Agent Card at `/.well-known/agent-card.json` (public, no auth)
  - JSON-RPC endpoint at `/a2a` with `SendMessage` and `GetTask` methods
  - Three skills: Nutrition Lookup, Product Comparison, Allergen Check
  - Task lifecycle: submitted → working → completed/failed
  - Secured by Bearer token (`A2A_API_KEY`)
- **3-layer architecture** — UI, Agent, and MCP Server are logically separated
  with independent authentication per layer
- New secrets: `MCP_API_KEY`, `A2A_API_KEY` for per-layer auth
- Health endpoint now returns layer discovery info
- Full README rewrite with API reference, curl examples, and security model docs

### Changed
- Agent now calls tools via MCP client (`McpClient`) instead of direct import,
  with graceful fallback to direct dispatch if MCP server is unreachable
- Worker entry point reorganized with dedicated route handlers per layer
- `Env` type updated with `MCP_API_KEY` and `A2A_API_KEY` bindings

### Architecture
```
UI (Basic Auth) → Agent DO (WebSocket/REST) → MCP Server (Bearer) → OpenFoodFacts
                  A2A Endpoint (Bearer) ────────────────┘
```

## [1.1.0] - 2026-02-10

### Added
- "New Chat" button (↺) in header to return to the welcome screen
- Grain texture overlay and ambient glow for atmosphere
- Proper block-level markdown parser (tables, code blocks, lists, paragraphs)
- Table styling with header row detection, hover highlights, and bordered layout
- Left accent border on assistant message cards
- Floating animation on welcome icon
- Focus ring glow on input field

### Changed
- Welcome screen is now a separate view (not embedded in chat scroll)
- Rewrote markdown renderer from regex-replace to line-by-line block parser
- Improved chip hover animation with translateY lift and shadow
- Header redesigned with subtitle row and action buttons area
- Footer simplified and moved to bg background
- Applied `frontend-design` skill guidelines throughout UI

### Fixed
- Tables rendering inline instead of as proper HTML table elements
- Chat area not scrollable when content exceeds viewport
- Messages overflowing horizontally on long content

## [1.0.0] - 2026-02-10

### Added
- NutriAgent Durable Object with stateful chat via WebSocket
- GLM-4.7-Flash (BigModel / z.ai) integration with function-calling tool loop
- Five MCP tools: barcode lookup, product search, category browse, compare, allergen check
- OpenFoodFacts API client with lean product summaries
- Chat UI with dark theme, quick-start chips, tool-call visibility
- Health endpoint at `/health`
- Wrangler configuration for local dev and Cloudflare deploy
