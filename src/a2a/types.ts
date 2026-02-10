/**
 * A2A Protocol Types
 *
 * @developer Eduardo Arana
 *
 * Type definitions for the Agent-to-Agent (A2A) protocol.
 * Based on the A2A specification: https://a2a-protocol.org/specification/
 *
 * Implements the JSON-RPC binding with core operations:
 *   - Agent Card discovery (.well-known/agent-card.json)
 *   - SendMessage (message/send → SendMessage)
 *   - GetTask
 */

// ── Agent Card ─────────────────────────────────────────────────────────────

export interface AgentCard {
  name: string;
  description: string;
  url: string;
  version: string;
  protocolVersion?: string;
  provider?: AgentProvider;
  capabilities: AgentCapabilities;
  securitySchemes?: Record<string, SecurityScheme>;
  security?: Record<string, string[]>[];
  defaultInputModes: string[];
  defaultOutputModes: string[];
  skills: AgentSkill[];
}

export interface AgentProvider {
  organization: string;
  url?: string;
}

export interface AgentCapabilities {
  streaming: boolean;
  pushNotifications: boolean;
  stateTransitionHistory?: boolean;
}

export interface AgentSkill {
  id: string;
  name: string;
  description: string;
  tags: string[];
  examples: string[];
  inputModes?: string[];
  outputModes?: string[];
}

export interface SecurityScheme {
  type: string;
  scheme?: string;
  in?: string;
  name?: string;
  description?: string;
}

// ── Core Protocol Objects ──────────────────────────────────────────────────

export type TaskState =
  | "submitted"
  | "working"
  | "input-required"
  | "completed"
  | "failed"
  | "canceled"
  | "rejected"
  | "auth-required"
  | "unknown";

export interface Task {
  id: string;
  contextId: string;
  status: TaskStatus;
  artifacts?: Artifact[];
  history?: Message[];
  metadata?: Record<string, unknown>;
}

export interface TaskStatus {
  state: TaskState;
  message?: Message;
  timestamp?: string;
}

export type Role = "user" | "agent";

export interface Message {
  role: Role;
  parts: Part[];
  messageId: string;
  taskId?: string;
  contextId?: string;
}

export type Part = TextPart | FilePart | DataPart;

export interface TextPart {
  type?: "text";
  text: string;
}

export interface FilePart {
  type: "file";
  file: { uri?: string; bytes?: string; mimeType?: string; name?: string };
}

export interface DataPart {
  type: "data";
  data: Record<string, unknown>;
}

export interface Artifact {
  artifactId: string;
  name?: string;
  parts: Part[];
}

// ── JSON-RPC ───────────────────────────────────────────────────────────────

export interface A2AJsonRpcRequest {
  jsonrpc: "2.0";
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

export interface SendMessageParams {
  message: Message;
  configuration?: {
    acceptedOutputModes?: string[];
    blocking?: boolean;
  };
}

export interface GetTaskParams {
  id: string;
  historyLength?: number;
}
