/**
 * Environment bindings for the Cloudflare Worker + Durable Object.
 *
 * @developer Eduardo Arana
 *
 * Secrets (set via `wrangler secret put`):
 *   - GLM_API_KEY:  z.ai / BigModel API key
 *   - AUTH_USER:    Basic-auth username  (optional — disables auth if unset)
 *   - AUTH_PASS:    Basic-auth password  (optional — disables auth if unset)
 *   - MCP_API_KEY:  Bearer token for MCP Streamable HTTP server (optional)
 *   - A2A_API_KEY:  Bearer token for A2A protocol endpoint   (optional)
 *
 * Vars (set in wrangler.toml [vars]):
 *   - GLM_BASE_URL
 *   - GLM_MODEL
 */
export interface Env {
  // Durable Objects
  NUTRI_AGENT: DurableObjectNamespace;

  // Secrets
  GLM_API_KEY: string;
  AUTH_USER: string;
  AUTH_PASS: string;
  MCP_API_KEY: string;
  A2A_API_KEY: string;

  // Vars
  GLM_BASE_URL: string;
  GLM_MODEL: string;
}
