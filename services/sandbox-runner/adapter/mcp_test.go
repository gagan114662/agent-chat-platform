package adapter

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

// TestMcpAuthorized verifies default-deny authz by catalog tier: safe servers
// allowed by default; sensitive/money require ACP_ALLOWED_MCP; unknown → false.
func TestMcpAuthorized(t *testing.T) {
	// safe tier: allowed with no env.
	if !mcpAuthorized("filesystem") {
		t.Fatal("filesystem (safe) must be allowed by default")
	}
	// sensitive tier: denied without the env.
	if mcpAuthorized("github") {
		t.Fatal("github (sensitive) must be denied without ACP_ALLOWED_MCP")
	}
	// money tier: denied without the env.
	if mcpAuthorized("stripe") {
		t.Fatal("stripe (money) must be denied without ACP_ALLOWED_MCP")
	}
	// unknown name: always denied.
	if mcpAuthorized("unknown") {
		t.Fatal("unknown server must be denied")
	}

	t.Setenv("ACP_ALLOWED_MCP", "github,stripe")
	if !mcpAuthorized("github") {
		t.Fatal("github must be allowed when listed in ACP_ALLOWED_MCP")
	}
	if !mcpAuthorized("stripe") {
		t.Fatal("stripe (money) must be allowed when explicitly listed in ACP_ALLOWED_MCP")
	}
	if mcpAuthorized("unknown") {
		t.Fatal("unknown server must stay denied even with ACP_ALLOWED_MCP set")
	}
}

// TestProvisionMcpConfig verifies .mcp.json is written with ONLY authorized
// servers (filesystem in, unauthorized github out) and that cleanup removes it.
func TestProvisionMcpConfig(t *testing.T) {
	repo := t.TempDir()
	_, cleanup, err := provisionMcpConfig(repo, []string{"filesystem", "github"})
	if err != nil {
		t.Fatalf("provisionMcpConfig: %v", err)
	}
	path := filepath.Join(repo, ".mcp.json")
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("expected .mcp.json written: %v", err)
	}
	var doc struct {
		McpServers map[string]mcpServerConfig `json:"mcpServers"`
	}
	if err := json.Unmarshal(b, &doc); err != nil {
		t.Fatalf("unmarshal .mcp.json: %v", err)
	}
	if _, ok := doc.McpServers["filesystem"]; !ok {
		t.Fatal("filesystem (authorized) must be in .mcp.json")
	}
	if _, ok := doc.McpServers["github"]; ok {
		t.Fatal("github (unauthorized) must NOT be in .mcp.json")
	}
	if len(doc.McpServers) != 1 {
		t.Fatalf("expected exactly 1 authorized server, got %d", len(doc.McpServers))
	}
	if doc.McpServers["filesystem"].Command == "" {
		t.Fatal("filesystem entry must carry its launch command")
	}

	cleanup()
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatalf(".mcp.json must be removed after cleanup: %v", err)
	}
}

// TestProvisionMcpConfigNoneAuthorized verifies that when no requested server is
// authorized, nothing is written and the cleanup is a no-op.
func TestProvisionMcpConfigNoneAuthorized(t *testing.T) {
	repo := t.TempDir()
	_, cleanup, err := provisionMcpConfig(repo, []string{"github", "unknown"})
	if err != nil {
		t.Fatalf("provisionMcpConfig: %v", err)
	}
	if _, err := os.Stat(filepath.Join(repo, ".mcp.json")); !os.IsNotExist(err) {
		t.Fatal(".mcp.json must NOT be written when no server is authorized")
	}
	cleanup() // no-op, must not panic
}

// TestProvisionMcpConfigEmpty verifies an empty/nil names list writes nothing.
func TestProvisionMcpConfigEmpty(t *testing.T) {
	repo := t.TempDir()
	_, cleanup, err := provisionMcpConfig(repo, nil)
	if err != nil {
		t.Fatalf("provisionMcpConfig: %v", err)
	}
	if _, err := os.Stat(filepath.Join(repo, ".mcp.json")); !os.IsNotExist(err) {
		t.Fatal(".mcp.json must NOT be written for empty names")
	}
	cleanup()
}
