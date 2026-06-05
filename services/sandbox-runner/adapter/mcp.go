package adapter

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
)

// mcpCatalogEntry describes a built-in MCP server: the command + args used to
// launch it and a security tier that gates default authorization.
type mcpCatalogEntry struct {
	command string
	args    []string
	tier    string // "safe" | "sensitive" | "money"
}

// mcpCatalog is the built-in, curated MCP server catalog (name → launch + tier),
// drawn from the 50-essential-MCP-servers list (#97). Commands are best-effort
// `npx -y @modelcontextprotocol/server-<x>` / vendor packages and refined when
// wired live. Tiers gate default authorization:
//   - safe       — read-only / local; allowed by default.
//   - sensitive  — writes / external state; default-deny, needs ACP_ALLOWED_MCP.
//   - money      — irreversible / moves funds; default-deny, needs ACP_ALLOWED_MCP
//     AND the per-org approval gate (#16/#21). NEVER default-allowed.
var mcpCatalog = map[string]mcpCatalogEntry{
	// safe — read-only / local.
	"filesystem":          {command: "npx", args: []string{"-y", "@modelcontextprotocol/server-filesystem"}, tier: "safe"},
	"git":                 {command: "npx", args: []string{"-y", "@modelcontextprotocol/server-git"}, tier: "safe"},
	"fetch":               {command: "npx", args: []string{"-y", "@modelcontextprotocol/server-fetch"}, tier: "safe"},
	"time":                {command: "npx", args: []string{"-y", "@modelcontextprotocol/server-time"}, tier: "safe"},
	"sequential-thinking": {command: "npx", args: []string{"-y", "@modelcontextprotocol/server-sequential-thinking"}, tier: "safe"},
	"memory":              {command: "npx", args: []string{"-y", "@modelcontextprotocol/server-memory"}, tier: "safe"},
	"context7":            {command: "npx", args: []string{"-y", "@upstash/context7-mcp"}, tier: "safe"},
	"sqlite":              {command: "npx", args: []string{"-y", "@modelcontextprotocol/server-sqlite"}, tier: "safe"},
	"brave-search":        {command: "npx", args: []string{"-y", "@modelcontextprotocol/server-brave-search"}, tier: "safe"},

	// sensitive — writes / external state.
	"github":     {command: "npx", args: []string{"-y", "@modelcontextprotocol/server-github"}, tier: "sensitive"},
	"gitlab":     {command: "npx", args: []string{"-y", "@modelcontextprotocol/server-gitlab"}, tier: "sensitive"},
	"slack":      {command: "npx", args: []string{"-y", "@modelcontextprotocol/server-slack"}, tier: "sensitive"},
	"notion":     {command: "npx", args: []string{"-y", "@notionhq/notion-mcp-server"}, tier: "sensitive"},
	"linear":     {command: "npx", args: []string{"-y", "@linear/mcp-server"}, tier: "sensitive"},
	"postgres":   {command: "npx", args: []string{"-y", "@modelcontextprotocol/server-postgres"}, tier: "sensitive"},
	"redis":      {command: "npx", args: []string{"-y", "@modelcontextprotocol/server-redis"}, tier: "sensitive"},
	"supabase":   {command: "npx", args: []string{"-y", "@supabase/mcp-server-supabase"}, tier: "sensitive"},
	"sentry":     {command: "npx", args: []string{"-y", "@sentry/mcp-server"}, tier: "sensitive"},
	"gdrive":     {command: "npx", args: []string{"-y", "@modelcontextprotocol/server-gdrive"}, tier: "sensitive"},
	"cloudflare": {command: "npx", args: []string{"-y", "@cloudflare/mcp-server-cloudflare"}, tier: "sensitive"},
	"vercel":     {command: "npx", args: []string{"-y", "@vercel/mcp-server"}, tier: "sensitive"},
	"kubernetes": {command: "npx", args: []string{"-y", "mcp-server-kubernetes"}, tier: "sensitive"},
	"docker":     {command: "npx", args: []string{"-y", "mcp-server-docker"}, tier: "sensitive"},

	// money — irreversible / moves funds. NEVER default-allowed.
	"stripe":     {command: "npx", args: []string{"-y", "@stripe/mcp"}, tier: "money"},
	"paypal":     {command: "npx", args: []string{"-y", "@paypal/mcp"}, tier: "money"},
	"plaid":      {command: "npx", args: []string{"-y", "@plaid/mcp-server"}, tier: "money"},
	"quickbooks": {command: "npx", args: []string{"-y", "@intuit/quickbooks-mcp"}, tier: "money"},
	"alpaca":     {command: "npx", args: []string{"-y", "@alpacahq/mcp-server"}, tier: "money"},
	"ccxt":       {command: "npx", args: []string{"-y", "ccxt-mcp"}, tier: "money"},
	"etherscan":  {command: "npx", args: []string{"-y", "etherscan-mcp"}, tier: "money"},
	"coingecko":  {command: "npx", args: []string{"-y", "@coingecko/coingecko-mcp"}, tier: "money"},
}

// mcpAuthorized reports whether the named MCP server may be provisioned into a
// run. The name MUST exist in the catalog. `safe`-tier servers are allowed by
// default; any other tier (incl. `money`) requires the name to appear in the
// comma-separated ACP_ALLOWED_MCP env (default-deny). Unknown name → false.
func mcpAuthorized(name string) bool {
	entry, ok := mcpCatalog[name]
	if !ok {
		return false
	}
	if entry.tier == "safe" {
		return true
	}
	for _, a := range strings.Split(os.Getenv("ACP_ALLOWED_MCP"), ",") {
		if strings.TrimSpace(a) == name {
			return true
		}
	}
	return false
}

// mcpServerConfig is the per-server shape written into .mcp.json.
type mcpServerConfig struct {
	Command string   `json:"command"`
	Args    []string `json:"args,omitempty"`
}

// provisionMcpConfig writes repoDir/.mcp.json containing ONLY the authorized
// catalog servers from names, and returns the path written (empty if nothing
// was written) plus a cleanup that removes the file. If no requested name is
// authorized (or names is empty) it writes nothing, returns an empty path, and
// the cleanup is a no-op. Call AFTER quarantineRepoConfig + provisionBuiltinSkills
// (like the built-in skills) so the agent has them for this run and the
// committed tree stays clean.
func provisionMcpConfig(repoDir string, names []string) (string, func(), error) {
	servers := map[string]mcpServerConfig{}
	for _, name := range names {
		if !mcpAuthorized(name) {
			continue
		}
		entry := mcpCatalog[name]
		servers[name] = mcpServerConfig{Command: entry.command, Args: entry.args}
	}
	if len(servers) == 0 {
		return "", func() {}, nil
	}
	path := filepath.Join(repoDir, ".mcp.json")
	payload := map[string]any{"mcpServers": servers}
	b, err := json.MarshalIndent(payload, "", "  ")
	if err != nil {
		return "", func() {}, err
	}
	if err := os.WriteFile(path, b, 0o644); err != nil {
		return "", func() {}, err
	}
	return path, func() { _ = os.Remove(path) }, nil
}
