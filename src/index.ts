#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { mcpAuthRouter, getOAuthProtectedResourceMetadataUrl } from "@modelcontextprotocol/sdk/server/auth/router.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import type { OAuthServerProvider, AuthorizationParams } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { OAuthRegisteredClientsStore } from "@modelcontextprotocol/sdk/server/auth/clients.js";
import type { OAuthClientInformationFull, OAuthTokenRevocationRequest, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import express from "express";
import type { Response } from "express";
import cors from "cors";
import { z } from "zod";

const PORT = parseInt(process.env.PORT || "3000", 10);
const FINDYMAIL_API_KEY = process.env.FINDYMAIL_API_KEY || null;
const SERVER_URL = process.env.RAILWAY_PUBLIC_DOMAIN
  ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
  : `http://localhost:${PORT}`;

const BASE_URL = "https://app.findymail.com";

function getApiKey(): string {
  if (!FINDYMAIL_API_KEY) {
    throw new Error(
      "FINDYMAIL_API_KEY environment variable is required. Get your token at https://app.findymail.com/api"
    );
  }
  return FINDYMAIL_API_KEY;
}

async function apiRequest(
  method: string,
  path: string,
  body?: Record<string, unknown>
): Promise<{ status: number; data: unknown }> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${getApiKey()}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }

  if (!response.ok) {
    if (response.status === 402) {
      throw new Error("Not enough credits. Please top up your Findymail account.");
    }
    if (response.status === 423) {
      throw new Error("Subscription is paused. Please reactivate your Findymail subscription.");
    }
    throw new Error(`API error ${response.status}: ${JSON.stringify(data)}`);
  }

  return { status: response.status, data };
}

function createFindymailServer(): McpServer {
const server = new McpServer({
  name: "findymail",
  version: "1.0.0",
});

// ── Email Verifier ──────────────────────────────────────────────────────────

server.tool(
  "verify_email",
  "Verify if an email address is valid. Uses one verifier credit per attempt.",
  { email: z.string().describe("Email address to verify") },
  async ({ email }) => {
    const { data } = await apiRequest("POST", "/api/verify", { email });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

// ── Email Finder ────────────────────────────────────────────────────────────

server.tool(
  "find_email_by_name",
  "Find someone's email from their name and company domain/name. Uses one finder credit if a verified email is found.",
  {
    name: z.string().describe("Person's full name"),
    domain: z.string().describe("Company domain (best) or company name"),
    webhook_url: z
      .string()
      .optional()
      .describe(
        "Optional webhook URL to receive results asynchronously"
      ),
  },
  async ({ name, domain, webhook_url }) => {
    const body: Record<string, unknown> = { name, domain };
    if (webhook_url) body.webhook_url = webhook_url;
    const { data } = await apiRequest("POST", "/api/search/name", body);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  "find_email_by_domain",
  "Find contacts with valid emails at a domain for given roles. Limited to 5 concurrent synchronous requests. Async jobs can take up to 24 hours.",
  {
    domain: z.string().describe("Email domain to search"),
    roles: z
      .array(z.string())
      .max(3)
      .describe("Target roles related to the domain (max 3)"),
    webhook_url: z
      .string()
      .optional()
      .describe(
        "Optional webhook URL to receive results asynchronously"
      ),
  },
  async ({ domain, roles, webhook_url }) => {
    const body: Record<string, unknown> = { domain, roles };
    if (webhook_url) body.webhook_url = webhook_url;
    const { data } = await apiRequest("POST", "/api/search/domain", body);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  "find_email_by_linkedin",
  "Find someone's email from their LinkedIn profile URL. Uses one finder credit if a verified email is found. Limited to 30 concurrent synchronous requests.",
  {
    linkedin_url: z
      .string()
      .describe(
        'LinkedIn profile URL (full URL like "https://linkedin.com/in/johndoe" or username "johndoe")'
      ),
    webhook_url: z
      .string()
      .optional()
      .describe(
        "Optional webhook URL to receive results asynchronously"
      ),
  },
  async ({ linkedin_url, webhook_url }) => {
    const body: Record<string, unknown> = { linkedin_url };
    if (webhook_url) body.webhook_url = webhook_url;
    const { data } = await apiRequest(
      "POST",
      "/api/search/business-profile",
      body
    );
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

// ── Contacts / Lists ────────────────────────────────────────────────────────

server.tool(
  "list_contact_lists",
  "Get all contact lists.",
  {},
  async () => {
    const { data } = await apiRequest("GET", "/api/lists");
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  "create_contact_list",
  "Create a new contact list.",
  {
    name: z.string().describe("Name for the new contact list"),
  },
  async ({ name }) => {
    const { data } = await apiRequest("POST", "/api/lists", { name });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  "update_contact_list",
  "Update an existing contact list.",
  {
    id: z.number().describe("Contact list ID"),
    name: z.string().describe("New name for the contact list"),
  },
  async ({ id, name }) => {
    const { data } = await apiRequest("PUT", `/api/lists/${id}`, { name });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  "delete_contact_list",
  "Delete a contact list.",
  { id: z.number().describe("Contact list ID to delete") },
  async ({ id }) => {
    const { data } = await apiRequest("DELETE", `/api/lists/${id}`);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  "get_contact",
  "Get a specific contact by ID.",
  { id: z.number().describe("Contact ID") },
  async ({ id }) => {
    const { data } = await apiRequest("GET", `/api/contacts/get/${id}`);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

// ── Misc Search ─────────────────────────────────────────────────────────────

server.tool(
  "reverse_email_lookup",
  "Look up information about a person from their email address.",
  {
    email: z.string().describe("Email address to look up"),
  },
  async ({ email }) => {
    const { data } = await apiRequest("POST", "/api/search/reverse-email", {
      email,
    });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  "search_company",
  "Search for company information.",
  {
    domain: z.string().describe("Company domain to search"),
  },
  async ({ domain }) => {
    const { data } = await apiRequest("POST", "/api/search/company", {
      domain,
    });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  "search_employees",
  "Search for employees at a company.",
  {
    domain: z.string().describe("Company domain to search employees for"),
  },
  async ({ domain }) => {
    const { data } = await apiRequest("POST", "/api/search/employees", {
      domain,
    });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

// ── Phone Finder ────────────────────────────────────────────────────────────

server.tool(
  "find_phone",
  "Find a phone number for a contact.",
  {
    linkedin_url: z.string().describe("LinkedIn profile URL of the person"),
  },
  async ({ linkedin_url }) => {
    const { data } = await apiRequest("POST", "/api/search/phone", {
      linkedin_url,
    });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

// ── Exclusion Lists ─────────────────────────────────────────────────────────

server.tool(
  "list_exclusion_lists",
  "Get all Intellimatch exclusion lists.",
  {},
  async () => {
    const { data } = await apiRequest(
      "GET",
      "/api/intellimatch/exclusion-lists"
    );
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  "create_exclusion_list",
  "Create a new Intellimatch exclusion list.",
  {
    name: z.string().describe("Name for the exclusion list"),
  },
  async ({ name }) => {
    const { data } = await apiRequest(
      "POST",
      "/api/intellimatch/exclusion-lists",
      { name }
    );
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  "get_exclusion_list",
  "Get a specific Intellimatch exclusion list.",
  {
    id: z.number().describe("Exclusion list ID"),
  },
  async ({ id }) => {
    const { data } = await apiRequest(
      "GET",
      `/api/intellimatch/exclusion-lists/${id}`
    );
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  "update_exclusion_list",
  "Update an Intellimatch exclusion list.",
  {
    id: z.number().describe("Exclusion list ID"),
    name: z.string().describe("New name for the exclusion list"),
  },
  async ({ id, name }) => {
    const { data } = await apiRequest(
      "PUT",
      `/api/intellimatch/exclusion-lists/${id}`,
      { name }
    );
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  "delete_exclusion_list",
  "Delete an Intellimatch exclusion list.",
  {
    id: z.number().describe("Exclusion list ID to delete"),
  },
  async ({ id }) => {
    const { data } = await apiRequest(
      "DELETE",
      `/api/intellimatch/exclusion-lists/${id}`
    );
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  "list_excluded_domains",
  "Get all excluded domains from Intellimatch.",
  {},
  async () => {
    const { data } = await apiRequest("GET", "/api/intellimatch/domains");
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  "add_excluded_domains",
  "Add domains to the Intellimatch exclusion list.",
  {
    domains: z.array(z.string()).describe("List of domains to exclude"),
    list_id: z.number().optional().describe("Optional exclusion list ID to add domains to"),
  },
  async ({ domains, list_id }) => {
    const body: Record<string, unknown> = { domains };
    if (list_id !== undefined) body.list_id = list_id;
    const { data } = await apiRequest(
      "POST",
      "/api/intellimatch/domains",
      body
    );
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  "remove_excluded_domains",
  "Remove domains from the Intellimatch exclusion list.",
  {
    domains: z.array(z.string()).describe("List of domains to remove from exclusion"),
  },
  async ({ domains }) => {
    const { data } = await apiRequest(
      "DELETE",
      "/api/intellimatch/domains",
      { domains }
    );
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

// ── Intellimatch ────────────────────────────────────────────────────────────

server.tool(
  "intellimatch_search",
  "Run an Intellimatch search.",
  {
    domain: z.string().describe("Domain to search"),
    roles: z.array(z.string()).optional().describe("Target roles to search for"),
  },
  async ({ domain, roles }) => {
    const body: Record<string, unknown> = { domain };
    if (roles) body.roles = roles;
    const { data } = await apiRequest(
      "POST",
      "/api/intellimatch/search",
      body
    );
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  "intellimatch_status",
  "Check the status of an Intellimatch search.",
  {},
  async () => {
    const { data } = await apiRequest("GET", "/api/intellimatch/status");
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  "intellimatch_data",
  "Get results from an Intellimatch search.",
  {},
  async () => {
    const { data } = await apiRequest("GET", "/api/intellimatch/data");
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  "lookalike_search",
  "Run a lookalike company search.",
  {
    domain: z.string().describe("Domain to find lookalike companies for"),
  },
  async ({ domain }) => {
    const { data } = await apiRequest("POST", "/api/lookalike/search", {
      domain,
    });
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

// ── Signals ─────────────────────────────────────────────────────────────────

server.tool(
  "list_signals",
  "Get all signals.",
  {},
  async () => {
    const { data } = await apiRequest("GET", "/api/signals");
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  "get_signal",
  "Get a specific signal by ID.",
  { id: z.number().describe("Signal ID") },
  async ({ id }) => {
    const { data } = await apiRequest("GET", `/api/signals/${id}`);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  "list_signal_monitors",
  "Get all signal monitors.",
  {},
  async () => {
    const { data } = await apiRequest("GET", "/api/signals/monitors");
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  "create_signal_monitor",
  "Create a new signal monitor.",
  {
    name: z.string().describe("Name for the signal monitor"),
    domain: z.string().optional().describe("Domain to monitor"),
  },
  async ({ name, domain }) => {
    const body: Record<string, unknown> = { name };
    if (domain) body.domain = domain;
    const { data } = await apiRequest("POST", "/api/signals/monitors", body);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  "update_signal_monitor",
  "Update an existing signal monitor.",
  {
    id: z.number().describe("Signal monitor ID"),
    name: z.string().optional().describe("New name for the monitor"),
  },
  async ({ id, name }) => {
    const body: Record<string, unknown> = {};
    if (name) body.name = name;
    const { data } = await apiRequest(
      "PATCH",
      `/api/signals/monitors/${id}`,
      body
    );
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  "delete_signal_monitor",
  "Delete a signal monitor.",
  { id: z.number().describe("Signal monitor ID to delete") },
  async ({ id }) => {
    const { data } = await apiRequest(
      "DELETE",
      `/api/signals/monitors/${id}`
    );
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

// ── Usage / Credits ─────────────────────────────────────────────────────────

server.tool(
  "get_credits",
  "Get current credit balance.",
  {},
  async () => {
    const { data } = await apiRequest("GET", "/api/credits");
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  "get_credits_summary",
  "Get a summary report of credit usage.",
  {},
  async () => {
    const { data } = await apiRequest("GET", "/api/credits/report/summary");
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  "get_team_credits_summary",
  "Get a team summary report of credit usage.",
  {},
  async () => {
    const { data } = await apiRequest(
      "GET",
      "/api/credits/report/team-summary"
    );
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

return server;
}

// ── OAuth 2.1 Provider (for Claude client auth) ────────────────────────────

class McpOAuthClientsStore implements OAuthRegisteredClientsStore {
  private clients = new Map<string, OAuthClientInformationFull>();

  async getClient(clientId: string): Promise<OAuthClientInformationFull | undefined> {
    return this.clients.get(clientId) || undefined;
  }

  async registerClient(clientMetadata: OAuthClientInformationFull): Promise<OAuthClientInformationFull> {
    const clientId = clientMetadata.client_id || randomUUID();
    const isPublicClient = clientMetadata.token_endpoint_auth_method === "none";
    const client: OAuthClientInformationFull = {
      ...clientMetadata,
      client_id: clientId,
      ...(isPublicClient ? {} : { client_secret: randomUUID() }),
      client_id_issued_at: Math.floor(Date.now() / 1000),
    };
    this.clients.set(clientId, client);
    return client;
  }
}

class McpOAuthProvider implements OAuthServerProvider {
  private _clientsStore = new McpOAuthClientsStore();
  private codes = new Map<string, { client: OAuthClientInformationFull; params: AuthorizationParams; createdAt: number }>();
  private tokens = new Map<string, { clientId: string; scopes: string[]; expiresAt: number; resource?: URL }>();

  get clientsStore(): OAuthRegisteredClientsStore {
    return this._clientsStore;
  }

  async authorize(client: OAuthClientInformationFull, params: AuthorizationParams, res: Response): Promise<void> {
    const code = randomUUID();
    this.codes.set(code, { client, params, createdAt: Date.now() });

    const targetUrl = new URL(params.redirectUri);
    targetUrl.searchParams.set("code", code);
    if (params.state) {
      targetUrl.searchParams.set("state", params.state);
    }
    res.redirect(targetUrl.toString());
  }

  async challengeForAuthorizationCode(_client: OAuthClientInformationFull, authorizationCode: string): Promise<string> {
    const codeData = this.codes.get(authorizationCode);
    if (!codeData) throw new Error("Invalid authorization code");
    return codeData.params.codeChallenge;
  }

  async exchangeAuthorizationCode(client: OAuthClientInformationFull, authorizationCode: string, _codeVerifier?: string, _redirectUri?: string, _resource?: URL): Promise<OAuthTokens> {
    const codeData = this.codes.get(authorizationCode);
    if (!codeData) throw new Error("Invalid authorization code");
    if (codeData.client.client_id !== client.client_id) {
      throw new Error("Authorization code was not issued to this client");
    }
    this.codes.delete(authorizationCode);

    const accessToken = randomUUID();
    const refreshToken = randomUUID();
    const expiresIn = 3600;
    const tokenData = {
      clientId: client.client_id,
      scopes: codeData.params.scopes || [],
      expiresAt: Math.floor(Date.now() / 1000) + expiresIn,
      resource: codeData.params.resource,
    };
    this.tokens.set(accessToken, tokenData);

    return {
      access_token: accessToken,
      token_type: "bearer",
      expires_in: expiresIn,
      refresh_token: refreshToken,
      scope: (codeData.params.scopes || []).join(" "),
    };
  }

  async exchangeRefreshToken(_client: OAuthClientInformationFull, _refreshToken: string, _scopes?: string[], _resource?: URL): Promise<OAuthTokens> {
    const accessToken = randomUUID();
    const expiresIn = 3600;
    const tokenData = {
      clientId: _client.client_id,
      scopes: [],
      expiresAt: Math.floor(Date.now() / 1000) + expiresIn,
    };
    this.tokens.set(accessToken, tokenData);

    return {
      access_token: accessToken,
      token_type: "bearer",
      expires_in: expiresIn,
      scope: "",
    };
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const tokenData = this.tokens.get(token);
    if (!tokenData) throw new Error("Invalid token");
    if (tokenData.expiresAt < Math.floor(Date.now() / 1000)) {
      this.tokens.delete(token);
      throw new Error("Token expired");
    }
    return {
      token,
      clientId: tokenData.clientId,
      scopes: tokenData.scopes,
      expiresAt: tokenData.expiresAt,
    };
  }

  async revokeToken(_client: OAuthClientInformationFull, request: OAuthTokenRevocationRequest): Promise<void> {
    this.tokens.delete(request.token);
  }
}

const mcpOAuthProvider = new McpOAuthProvider();

// ── Express app setup ───────────────────────────────────────────────────────

const app = express();
app.set("trust proxy", 1);

app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Accept", "mcp-session-id", "Authorization", "Last-Event-ID"],
  exposedHeaders: ["mcp-session-id"],
}));
app.use(express.json());

// ── OAuth 2.1 endpoints for client authentication ───────────────────────────

const mcpServerUrl = new URL(`${SERVER_URL}/mcp`);
const issuerUrl = new URL(SERVER_URL);

// OAuth protected resource metadata for /sse path (some clients try this)
const sseServerUrl = new URL(`${SERVER_URL}/sse`);
const sseProtectedResourceMetadataUrl = getOAuthProtectedResourceMetadataUrl(sseServerUrl);
app.get(new URL(sseProtectedResourceMetadataUrl).pathname, (_req, res) => {
  res.json({
    resource: sseServerUrl.href,
    authorization_servers: [issuerUrl.href],
    bearer_methods_supported: ["header"],
    scopes_supported: [],
  });
});

// OAuth protected resource metadata for root path (fallback discovery)
const rootProtectedResourceMetadataUrl = getOAuthProtectedResourceMetadataUrl(issuerUrl);
const rootMetadataPath = new URL(rootProtectedResourceMetadataUrl).pathname;
const mcpMetadataPath = new URL(getOAuthProtectedResourceMetadataUrl(mcpServerUrl)).pathname;
if (rootMetadataPath !== mcpMetadataPath) {
  app.get(rootMetadataPath, (_req, res) => {
    res.json({
      resource: mcpServerUrl.href,
      authorization_servers: [issuerUrl.href],
      bearer_methods_supported: ["header"],
      scopes_supported: [],
    });
  });
}

// Mount the OAuth auth router
app.use(mcpAuthRouter({
  provider: mcpOAuthProvider,
  issuerUrl,
  baseUrl: issuerUrl,
  resourceServerUrl: mcpServerUrl,
  scopesSupported: [],
}));

// Bearer auth middleware for MCP endpoint
const mcpBearerAuth = requireBearerAuth({
  verifier: mcpOAuthProvider,
  requiredScopes: [],
  resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(mcpServerUrl),
});

// ── Session management ──────────────────────────────────────────────────────

interface Session {
  transport: StreamableHTTPServerTransport;
  server: McpServer;
}

const sessions = new Map<string, Session>();

// ── Health check ────────────────────────────────────────────────────────────

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    server: "findymail-mcp",
    version: "1.0.0",
    findymailApiKeyConfigured: !!FINDYMAIL_API_KEY,
  });
});

// ── MCP endpoint — protected by OAuth 2.1 bearer auth ──────────────────────

async function handleMcp(req: express.Request, res: express.Response) {
  if (!FINDYMAIL_API_KEY) {
    res.status(503).json({
      error: { code: "service_unavailable", message: "FINDYMAIL_API_KEY environment variable is not configured on the server." },
    });
    return;
  }

  const sessionId = req.headers["mcp-session-id"] as string | undefined;

  if (req.method === "GET" || req.method === "DELETE") {
    if (!sessionId || !sessions.has(sessionId)) {
      res.status(400).json({
        error: { code: "bad_request", message: "Invalid or missing session. Send a POST to initialize first." },
      });
      return;
    }
    const session = sessions.get(sessionId)!;
    if (req.method === "DELETE") {
      await session.transport.close();
      sessions.delete(sessionId);
      res.status(200).end();
      return;
    }
    await session.transport.handleRequest(req, res);
    return;
  }

  if (req.method === "POST") {
    // Existing session
    if (sessionId && sessions.has(sessionId)) {
      const session = sessions.get(sessionId)!;
      try {
        await session.transport.handleRequest(req, res, req.body);
      } catch (error) {
        console.error(`[session:${sessionId}] Error handling request:`, error);
        if (!res.headersSent) {
          res.status(500).json({ error: { code: "internal_error", message: (error as Error).message } });
        }
      }
      return;
    }

    // New session
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
    });

    const server = createFindymailServer();
    await server.connect(transport);

    const onClose = () => {
      const sid = transport.sessionId;
      if (sid) sessions.delete(sid);
    };
    transport.onclose = onClose;

    try {
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error("[new-session] Error handling request:", error);
      if (!res.headersSent) {
        res.status(500).json({ error: { code: "internal_error", message: (error as Error).message } });
      }
    }

    const newSessionId = transport.sessionId;
    if (newSessionId) {
      sessions.set(newSessionId, { transport, server });
    }
    return;
  }

  res.status(405).json({ error: { code: "method_not_allowed", message: "Use POST, GET, or DELETE" } });
}

// Protected MCP endpoints
app.all("/mcp", mcpBearerAuth, async (req, res) => handleMcp(req, res));
app.all("/", mcpBearerAuth, async (req, res) => handleMcp(req, res));

// ── Start server ────────────────────────────────────────────────────────────

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Findymail MCP server listening on ${SERVER_URL}`);
  console.log(`API key configured: ${!!FINDYMAIL_API_KEY}`);
  console.log(`MCP endpoint: ${SERVER_URL}/mcp`);
  console.log(`OAuth metadata: ${SERVER_URL}/.well-known/oauth-authorization-server`);
});
