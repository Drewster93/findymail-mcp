# Findymail MCP Server

An MCP (Model Context Protocol) server that wraps the [Findymail API](https://app.findymail.com), giving AI assistants access to email finding, verification, and enrichment tools.

## Setup

### 1. Install dependencies and build

```bash
npm install
npm run build
```

### 2. Get your API key

Retrieve your API token from the [Findymail API page](https://app.findymail.com/api).

### 3. Configure in your MCP client

Add to your MCP client configuration (e.g., Claude Desktop `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "findymail": {
      "command": "node",
      "args": ["/path/to/findymail-mcp/dist/index.js"],
      "env": {
        "FINDYMAIL_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

## Available Tools

### Email Finder
- **find_email_by_name** - Find email from a person's name and company domain
- **find_email_by_domain** - Find contacts at a domain by role (max 3 roles, 5 concurrent sync requests)
- **find_email_by_linkedin** - Find email from a LinkedIn profile URL (30 concurrent sync requests)

### Email Verifier
- **verify_email** - Verify if an email address is valid (1 credit per attempt)

### Contacts
- **list_contact_lists** / **create_contact_list** / **update_contact_list** / **delete_contact_list**
- **get_contact** - Get a contact by ID

### Misc Search
- **reverse_email_lookup** - Look up a person from their email
- **search_company** - Get company information by domain
- **search_employees** - Find employees at a company

### Phone Finder
- **find_phone** - Find a phone number from a LinkedIn profile

### Intellimatch
- **intellimatch_search** / **intellimatch_status** / **intellimatch_data**
- **lookalike_search** - Find lookalike companies

### Exclusion Lists
- **list_exclusion_lists** / **create_exclusion_list** / **get_exclusion_list** / **update_exclusion_list** / **delete_exclusion_list**
- **list_excluded_domains** / **add_excluded_domains** / **remove_excluded_domains**

### Signals
- **list_signals** / **get_signal**
- **list_signal_monitors** / **create_signal_monitor** / **update_signal_monitor** / **delete_signal_monitor**

### Usage
- **get_credits** - Check credit balance
- **get_credits_summary** - Credit usage summary
- **get_team_credits_summary** - Team credit usage summary

## Rate Limits

All endpoints have a concurrent rate limit of 300 simultaneous requests unless otherwise noted:
- `find_email_by_domain`: 5 concurrent synchronous requests
- `find_email_by_linkedin`: 30 concurrent synchronous requests

## License

ISC
