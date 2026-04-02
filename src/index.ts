#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const BASE_URL = "https://app.findymail.com";

function getApiKey(): string {
  const key = process.env.FINDYMAIL_API_KEY;
  if (!key) {
    throw new Error(
      "FINDYMAIL_API_KEY environment variable is required. Get your token at https://app.findymail.com/api"
    );
  }
  return key;
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

// ── Start Server ────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Findymail MCP server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
