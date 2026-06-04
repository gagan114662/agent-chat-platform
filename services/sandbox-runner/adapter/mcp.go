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

// mcpCatalog is the built-in MCP server catalog (name → launch + tier).
// Commands are best-effort `npx -y @modelcontextprotocol/server-<x>`-style and
// refined later (#97). `safe`-tier servers are allowed by default; everything
// else (incl. `money`) requires the name in ACP_ALLOWED_MCP. A `money`-tier
// entry is included to prove default-deny applies to it too.
var mcpCatalog = map[string]mcpCatalogEntry{
	"filesystem":          {command: "npx", args: []string{"-y", "@modelcontextprotocol/server-filesystem"}, tier: "safe"},
	"git":                 {command: "npx", args: []string{"-y", "@modelcontextprotocol/server-git"}, tier: "safe"},
	"fetch":               {command: "npx", args: []string{"-y", "@modelcontextprotocol/server-fetch"}, tier: "safe"},
	"sequential-thinking": {command: "npx", args: []string{"-y", "@modelcontextprotocol/server-sequential-thinking"}, tier: "safe"},
	"memory":              {command: "npx", args: []string{"-y", "@modelcontextprotocol/server-memory"}, tier: "safe"},
	"github":              {command: "npx", args: []string{"-y", "@modelcontextprotocol/server-github"}, tier: "sensitive"},
	"stripe":              {command: "npx", args: []string{"-y", "@modelcontextprotocol/server-stripe"}, tier: "money"},
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
