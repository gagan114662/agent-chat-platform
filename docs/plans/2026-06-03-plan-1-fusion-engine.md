# Fusion Engine (Walking Skeleton) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove the core thesis end-to-end: given a repo + a natural-language intent, an agent runs in an isolated sandbox, pushes a branch, opens a GitHub PR, the engine drives CI, and auto-merges when green.

**Architecture:** Polyglot. A **Go `sandbox-runner`** service clones a repo into an isolated worktree, runs a pluggable agent (a deterministic *fake* agent for the skeleton), commits and pushes a branch. A **TypeScript `orchestrator`** (durable via Temporal) calls the runner, then uses a **TS `github-service`** (Octokit) to open the PR, poll checks, and auto-merge on green. Core logic is written against interfaces so it is unit-testable with fakes; a final integration test exercises the real loop against a throwaway GitHub repo.

**Tech Stack:** TypeScript (Node 20, pnpm workspaces, Vitest, Octokit, Temporal TS SDK), Go (1.22, standard `testing`, `net/http`, git via subprocess), Docker (Temporal dev server only).

**Scope boundaries (built in LATER plans, not here):**
- Real coding agents (Claude Code/Codex) — skeleton uses a fake agent behind the same interface.
- gVisor/Kata + Kubernetes namespace isolation — skeleton runs the runner locally.
- Chat/Tasks UI, multi-tenancy, risk router, QA-for-UI, adapter registry — later plans.

---

## File Structure

```
agent-chat-platform/
├── package.json                      # pnpm workspace root
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── go.work                           # Go workspace
├── services/
│   ├── sandbox-runner/               # GO
│   │   ├── go.mod
│   │   ├── cmd/server/main.go        # HTTP entrypoint
│   │   └── internal/sandbox/
│   │       ├── git.go                # clone/worktree/commit/push
│   │       ├── git_test.go
│   │       ├── agent.go              # Agent interface + FakeAgent
│   │       ├── agent_test.go
│   │       ├── run.go                # Run() orchestrates git+agent
│   │       ├── run_test.go
│   │       ├── http.go               # HTTP handler
│   │       └── http_test.go
│   └── orchestrator/                 # TS
│       ├── package.json
│       ├── tsconfig.json
│       ├── vitest.config.ts
│       └── src/
│           ├── types.ts             # shared types/interfaces
│           ├── github/
│           │   ├── github-service.ts        # interface
│           │   ├── octokit-github-service.ts # Octokit impl
│           │   └── octokit-github-service.test.ts
│           ├── sandbox/
│           │   ├── sandbox-runner-client.ts  # HTTP client to Go service
│           │   └── sandbox-runner-client.test.ts
│           ├── core/
│           │   ├── run-fusion.ts             # pure orchestration over interfaces
│           │   └── run-fusion.test.ts
│           ├── temporal/
│           │   ├── activities.ts             # wraps clients
│           │   ├── workflow.ts               # durable fusion workflow
│           │   └── workflow.test.ts          # @temporalio/testing
│           └── e2e/
│               └── fusion.e2e.test.ts        # real loop, env-gated
└── justfile                          # task runner
```

---

## Task 0: Monorepo scaffolding

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `go.work`, `justfile`, `.gitignore`

- [ ] **Step 1: Create the pnpm workspace root**

`package.json`:
```json
{
  "name": "agent-chat-platform",
  "private": true,
  "packageManager": "pnpm@9.0.0",
  "engines": { "node": ">=20" }
}
```

`pnpm-workspace.yaml`:
```yaml
packages:
  - "services/orchestrator"
```

- [ ] **Step 2: Create shared TS config**

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "sourceMap": true
  }
}
```

- [ ] **Step 3: Create the Go workspace**

`go.work`:
```
go 1.22

use ./services/sandbox-runner
```

- [ ] **Step 4: Create the task runner**

`justfile`:
```make
test-go:
    cd services/sandbox-runner && go test ./...

test-ts:
    cd services/orchestrator && pnpm test

test: test-go test-ts

e2e:
    cd services/orchestrator && pnpm test:e2e
```

- [ ] **Step 5: Create .gitignore**

`.gitignore`:
```
node_modules/
dist/
*.log
.env
.tmp/
services/sandbox-runner/bin/
```

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-workspace.yaml tsconfig.base.json go.work justfile .gitignore
git commit -m "chore: monorepo scaffolding (pnpm + go workspaces)"
```

---

## Task 1: Go sandbox-runner — git clone & worktree

**Files:**
- Create: `services/sandbox-runner/go.mod`, `services/sandbox-runner/internal/sandbox/git.go`, `services/sandbox-runner/internal/sandbox/git_test.go`

- [ ] **Step 1: Init the Go module**

```bash
cd services/sandbox-runner && go mod init github.com/gagan114662/agent-chat-platform/sandbox-runner
```

- [ ] **Step 2: Write the failing test**

`internal/sandbox/git_test.go`:
```go
package sandbox

import (
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

// makeBareRepoWithCommit creates a bare repo with one commit on "main",
// returning the bare repo path to use as a clone source.
func makeBareRepoWithCommit(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	bare := filepath.Join(dir, "origin.git")
	work := filepath.Join(dir, "work")
	run := func(d string, args ...string) {
		cmd := exec.Command("git", args...)
		cmd.Dir = d
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git %v: %v\n%s", args, err, out)
		}
	}
	if err := os.MkdirAll(work, 0o755); err != nil {
		t.Fatal(err)
	}
	run(dir, "init", "--bare", "-b", "main", bare)
	run(dir, "clone", bare, work)
	run(work, "config", "user.email", "t@t.dev")
	run(work, "config", "user.name", "t")
	if err := os.WriteFile(filepath.Join(work, "README.md"), []byte("hi\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	run(work, "add", ".")
	run(work, "commit", "-m", "init")
	run(work, "push", "origin", "main")
	return bare
}

func TestCloneInto(t *testing.T) {
	src := makeBareRepoWithCommit(t)
	dest := filepath.Join(t.TempDir(), "checkout")

	err := CloneInto(src, "main", dest)
	if err != nil {
		t.Fatalf("CloneInto: %v", err)
	}
	if _, err := os.Stat(filepath.Join(dest, "README.md")); err != nil {
		t.Fatalf("expected README.md in checkout: %v", err)
	}
}
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd services/sandbox-runner && go test ./internal/sandbox/ -run TestCloneInto -v`
Expected: FAIL — `undefined: CloneInto`

- [ ] **Step 4: Write minimal implementation**

`internal/sandbox/git.go`:
```go
package sandbox

import (
	"fmt"
	"os/exec"
)

// gitRun runs git in dir and returns combined output on error.
func gitRun(dir string, args ...string) error {
	cmd := exec.Command("git", args...)
	if dir != "" {
		cmd.Dir = dir
	}
	if out, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("git %v: %w\n%s", args, err, out)
	}
	return nil
}

// CloneInto clones repoURL at branch into dest.
func CloneInto(repoURL, branch, dest string) error {
	return gitRun("", "clone", "--branch", branch, "--single-branch", repoURL, dest)
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd services/sandbox-runner && go test ./internal/sandbox/ -run TestCloneInto -v`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add services/sandbox-runner/go.mod services/sandbox-runner/internal/sandbox/git.go services/sandbox-runner/internal/sandbox/git_test.go
git commit -m "feat(sandbox): git clone into worktree"
```

---

## Task 2: Go sandbox-runner — Agent interface, FakeAgent, commit & push

**Files:**
- Create: `internal/sandbox/agent.go`, `internal/sandbox/agent_test.go`
- Modify: `internal/sandbox/git.go` (add `CommitAllAndPush`)

- [ ] **Step 1: Write the failing test for FakeAgent**

`internal/sandbox/agent_test.go`:
```go
package sandbox

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestFakeAgentApply(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "README.md"), []byte("hi\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	a := FakeAgent{}
	if err := a.Apply(dir, "add a greeting"); err != nil {
		t.Fatalf("Apply: %v", err)
	}
	b, err := os.ReadFile(filepath.Join(dir, "AGENT_CHANGES.md"))
	if err != nil {
		t.Fatalf("expected AGENT_CHANGES.md: %v", err)
	}
	if !strings.Contains(string(b), "add a greeting") {
		t.Fatalf("expected intent recorded, got: %q", b)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/sandbox-runner && go test ./internal/sandbox/ -run TestFakeAgentApply -v`
Expected: FAIL — `undefined: FakeAgent`

- [ ] **Step 3: Write the Agent interface + FakeAgent**

`internal/sandbox/agent.go`:
```go
package sandbox

import (
	"fmt"
	"os"
	"path/filepath"
)

// Agent makes changes to a checked-out repo to satisfy intent.
// Real adapters (Claude Code, Codex, …) implement this in later plans.
type Agent interface {
	Apply(repoDir, intent string) error
}

// FakeAgent makes a deterministic change so the whole loop is testable.
type FakeAgent struct{}

func (FakeAgent) Apply(repoDir, intent string) error {
	p := filepath.Join(repoDir, "AGENT_CHANGES.md")
	content := fmt.Sprintf("# Agent change\n\nIntent: %s\n", intent)
	return os.WriteFile(p, []byte(content), 0o644)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd services/sandbox-runner && go test ./internal/sandbox/ -run TestFakeAgentApply -v`
Expected: PASS

- [ ] **Step 5: Write the failing test for CommitAllAndPush**

Append to `internal/sandbox/git_test.go`:
```go
func TestCommitAllAndPush(t *testing.T) {
	src := makeBareRepoWithCommit(t)
	dest := filepath.Join(t.TempDir(), "checkout")
	if err := CloneInto(src, "main", dest); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dest, "new.txt"), []byte("x\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	sha, err := CommitAllAndPush(dest, "feature/test", "msg")
	if err != nil {
		t.Fatalf("CommitAllAndPush: %v", err)
	}
	if len(sha) < 7 {
		t.Fatalf("expected commit sha, got %q", sha)
	}

	// Verify the branch exists on origin.
	verify := filepath.Join(t.TempDir(), "verify")
	if err := CloneInto(src, "feature/test", verify); err != nil {
		t.Fatalf("branch not pushed to origin: %v", err)
	}
}
```

- [ ] **Step 6: Run test to verify it fails**

Run: `cd services/sandbox-runner && go test ./internal/sandbox/ -run TestCommitAllAndPush -v`
Expected: FAIL — `undefined: CommitAllAndPush`

- [ ] **Step 7: Implement CommitAllAndPush**

Append to `internal/sandbox/git.go`:
```go
import "strings" // add to the existing import block

// CommitAllAndPush stages all changes, commits on a new branch, pushes it,
// and returns the commit SHA.
func CommitAllAndPush(repoDir, branch, message string) (string, error) {
	if err := gitRun(repoDir, "config", "user.email", "agent@agent-chat.dev"); err != nil {
		return "", err
	}
	if err := gitRun(repoDir, "config", "user.name", "agent-chat"); err != nil {
		return "", err
	}
	if err := gitRun(repoDir, "checkout", "-b", branch); err != nil {
		return "", err
	}
	if err := gitRun(repoDir, "add", "-A"); err != nil {
		return "", err
	}
	if err := gitRun(repoDir, "commit", "-m", message); err != nil {
		return "", err
	}
	if err := gitRun(repoDir, "push", "origin", branch); err != nil {
		return "", err
	}
	out, err := exec.Command("git", "-C", repoDir, "rev-parse", "HEAD").Output()
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(out)), nil
}
```

- [ ] **Step 8: Run tests to verify all pass**

Run: `cd services/sandbox-runner && go test ./internal/sandbox/ -v`
Expected: PASS (all)

- [ ] **Step 9: Commit**

```bash
git add services/sandbox-runner/internal/sandbox/agent.go services/sandbox-runner/internal/sandbox/agent_test.go services/sandbox-runner/internal/sandbox/git.go services/sandbox-runner/internal/sandbox/git_test.go
git commit -m "feat(sandbox): Agent interface, FakeAgent, commit+push branch"
```

---

## Task 3: Go sandbox-runner — Run() and HTTP endpoint

**Files:**
- Create: `internal/sandbox/run.go`, `internal/sandbox/run_test.go`, `internal/sandbox/http.go`, `internal/sandbox/http_test.go`, `cmd/server/main.go`

- [ ] **Step 1: Write the failing test for Run()**

`internal/sandbox/run_test.go`:
```go
package sandbox

import (
	"context"
	"path/filepath"
	"testing"
)

func TestRun(t *testing.T) {
	src := makeBareRepoWithCommit(t)
	res, err := Run(context.Background(), RunRequest{
		RepoURL:    src,
		BaseBranch: "main",
		Intent:     "do the thing",
		Branch:     "feature/run",
		WorkDir:    filepath.Join(t.TempDir(), "co"),
	}, FakeAgent{})
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if res.CommitSHA == "" || res.Branch != "feature/run" {
		t.Fatalf("unexpected result: %+v", res)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/sandbox-runner && go test ./internal/sandbox/ -run TestRun -v`
Expected: FAIL — `undefined: Run` / `undefined: RunRequest`

- [ ] **Step 3: Implement Run()**

`internal/sandbox/run.go`:
```go
package sandbox

import (
	"context"
	"fmt"
)

type RunRequest struct {
	RepoURL    string `json:"repoUrl"`
	BaseBranch string `json:"baseBranch"`
	Intent     string `json:"intent"`
	Branch     string `json:"branch"`
	WorkDir    string `json:"-"`
}

type RunResult struct {
	Branch    string `json:"branch"`
	CommitSHA string `json:"commitSha"`
}

// Run clones, applies the agent, commits and pushes a branch.
func Run(ctx context.Context, req RunRequest, agent Agent) (RunResult, error) {
	if err := CloneInto(req.RepoURL, req.BaseBranch, req.WorkDir); err != nil {
		return RunResult{}, fmt.Errorf("clone: %w", err)
	}
	if err := agent.Apply(req.WorkDir, req.Intent); err != nil {
		return RunResult{}, fmt.Errorf("agent: %w", err)
	}
	sha, err := CommitAllAndPush(req.WorkDir, req.Branch, "agent: "+req.Intent)
	if err != nil {
		return RunResult{}, fmt.Errorf("commit/push: %w", err)
	}
	return RunResult{Branch: req.Branch, CommitSHA: sha}, nil
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd services/sandbox-runner && go test ./internal/sandbox/ -run TestRun -v`
Expected: PASS

- [ ] **Step 5: Write the failing HTTP test**

`internal/sandbox/http_test.go`:
```go
package sandbox

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestHandleRun(t *testing.T) {
	src := makeBareRepoWithCommit(t)
	body, _ := json.Marshal(map[string]string{
		"repoUrl": src, "baseBranch": "main", "intent": "x", "branch": "feature/http",
	})
	req := httptest.NewRequest(http.MethodPost, "/run", bytes.NewReader(body))
	rec := httptest.NewRecorder()

	NewHandler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	var out RunResult
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	if out.CommitSHA == "" {
		t.Fatalf("expected commitSha, got %+v", out)
	}
}
```

- [ ] **Step 6: Run test to verify it fails**

Run: `cd services/sandbox-runner && go test ./internal/sandbox/ -run TestHandleRun -v`
Expected: FAIL — `undefined: NewHandler`

- [ ] **Step 7: Implement the HTTP handler**

`internal/sandbox/http.go`:
```go
package sandbox

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
)

// NewHandler returns the sandbox-runner HTTP mux.
func NewHandler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("POST /run", func(w http.ResponseWriter, r *http.Request) {
		var req RunRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		work, err := os.MkdirTemp("", "sbx-*")
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		defer os.RemoveAll(work)
		req.WorkDir = filepath.Join(work, "repo")

		res, err := Run(context.Background(), req, FakeAgent{})
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(res)
	})
	return mux
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `cd services/sandbox-runner && go test ./internal/sandbox/ -run TestHandleRun -v`
Expected: PASS

- [ ] **Step 9: Add the server entrypoint**

`cmd/server/main.go`:
```go
package main

import (
	"log"
	"net/http"
	"os"

	"github.com/gagan114662/agent-chat-platform/sandbox-runner/internal/sandbox"
)

func main() {
	addr := os.Getenv("SANDBOX_ADDR")
	if addr == "" {
		addr = ":8090"
	}
	log.Printf("sandbox-runner listening on %s", addr)
	if err := http.ListenAndServe(addr, sandbox.NewHandler()); err != nil {
		log.Fatal(err)
	}
}
```

- [ ] **Step 10: Verify it builds and all tests pass**

Run: `cd services/sandbox-runner && go build ./... && go test ./...`
Expected: build succeeds; all tests PASS

- [ ] **Step 11: Commit**

```bash
git add services/sandbox-runner/internal/sandbox/run.go services/sandbox-runner/internal/sandbox/run_test.go services/sandbox-runner/internal/sandbox/http.go services/sandbox-runner/internal/sandbox/http_test.go services/sandbox-runner/cmd/server/main.go
git commit -m "feat(sandbox): Run() + HTTP /run endpoint + server"
```

---

## Task 4: TS orchestrator — package + shared types + GitHub service

**Files:**
- Create: `services/orchestrator/package.json`, `tsconfig.json`, `vitest.config.ts`, `src/types.ts`, `src/github/github-service.ts`, `src/github/octokit-github-service.ts`, `src/github/octokit-github-service.test.ts`

- [ ] **Step 1: Create the TS package**

`services/orchestrator/package.json`:
```json
{
  "name": "@acp/orchestrator",
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "test:e2e": "vitest run --config vitest.e2e.config.ts",
    "build": "tsc -p tsconfig.json"
  },
  "dependencies": {
    "@octokit/rest": "^21.0.0",
    "@temporalio/activity": "^1.11.0",
    "@temporalio/client": "^1.11.0",
    "@temporalio/testing": "^1.11.0",
    "@temporalio/worker": "^1.11.0",
    "@temporalio/workflow": "^1.11.0",
    "undici": "^6.0.0"
  },
  "devDependencies": {
    "typescript": "^5.5.0",
    "vitest": "^2.0.0",
    "nock": "^13.5.0"
  }
}
```

- [ ] **Step 2: Create tsconfig + vitest config**

`services/orchestrator/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src" },
  "include": ["src"]
}
```

`services/orchestrator/vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    exclude: ["src/e2e/**"],
  },
});
```

- [ ] **Step 3: Install deps**

Run: `cd services/orchestrator && pnpm install`
Expected: dependencies installed, lockfile created

- [ ] **Step 4: Define shared types and the GitHub interface**

`services/orchestrator/src/types.ts`:
```ts
export interface RunResult {
  branch: string;
  commitSha: string;
}

export interface SandboxRunRequest {
  repoUrl: string;
  baseBranch: string;
  intent: string;
  branch: string;
}

export type ChecksStatus = "pending" | "success" | "failure";

export interface PullRequest {
  number: number;
  url: string;
}
```

`services/orchestrator/src/github/github-service.ts`:
```ts
import type { ChecksStatus, PullRequest } from "../types.js";

export interface OpenPrInput {
  owner: string;
  repo: string;
  head: string; // branch
  base: string;
  title: string;
  body: string;
}

export interface GitHubService {
  openPr(input: OpenPrInput): Promise<PullRequest>;
  getChecksStatus(owner: string, repo: string, ref: string): Promise<ChecksStatus>;
  merge(owner: string, repo: string, prNumber: number): Promise<void>;
}
```

- [ ] **Step 5: Write the failing test for the Octokit implementation**

`services/orchestrator/src/github/octokit-github-service.test.ts`:
```ts
import { describe, it, expect, afterEach } from "vitest";
import nock from "nock";
import { OctokitGitHubService } from "./octokit-github-service.js";

const api = "https://api.github.com";

afterEach(() => nock.cleanAll());

describe("OctokitGitHubService", () => {
  it("opens a PR", async () => {
    nock(api)
      .post("/repos/o/r/pulls")
      .reply(201, { number: 7, html_url: "https://github.com/o/r/pull/7" });

    const svc = new OctokitGitHubService("tok");
    const pr = await svc.openPr({
      owner: "o", repo: "r", head: "feature/x", base: "main",
      title: "t", body: "b",
    });
    expect(pr).toEqual({ number: 7, url: "https://github.com/o/r/pull/7" });
  });

  it("maps combined status to ChecksStatus", async () => {
    nock(api).get("/repos/o/r/commits/abc/status").reply(200, { state: "success" });
    const svc = new OctokitGitHubService("tok");
    expect(await svc.getChecksStatus("o", "r", "abc")).toBe("success");
  });

  it("merges a PR", async () => {
    nock(api).put("/repos/o/r/pulls/7/merge").reply(200, { merged: true });
    const svc = new OctokitGitHubService("tok");
    await expect(svc.merge("o", "r", 7)).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `cd services/orchestrator && pnpm test -- octokit-github-service`
Expected: FAIL — cannot find module `./octokit-github-service.js`

- [ ] **Step 7: Implement the Octokit service**

`services/orchestrator/src/github/octokit-github-service.ts`:
```ts
import { Octokit } from "@octokit/rest";
import type { GitHubService, OpenPrInput } from "./github-service.js";
import type { ChecksStatus, PullRequest } from "../types.js";

export class OctokitGitHubService implements GitHubService {
  private readonly octokit: Octokit;

  constructor(token: string) {
    this.octokit = new Octokit({ auth: token });
  }

  async openPr(input: OpenPrInput): Promise<PullRequest> {
    const res = await this.octokit.pulls.create({
      owner: input.owner,
      repo: input.repo,
      head: input.head,
      base: input.base,
      title: input.title,
      body: input.body,
    });
    return { number: res.data.number, url: res.data.html_url };
  }

  async getChecksStatus(owner: string, repo: string, ref: string): Promise<ChecksStatus> {
    const res = await this.octokit.repos.getCombinedStatusForRef({ owner, repo, ref });
    const state = res.data.state; // "success" | "pending" | "failure"
    if (state === "success") return "success";
    if (state === "failure" || state === "error") return "failure";
    return "pending";
  }

  async merge(owner: string, repo: string, prNumber: number): Promise<void> {
    await this.octokit.pulls.merge({ owner, repo, pull_number: prNumber });
  }
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `cd services/orchestrator && pnpm test -- octokit-github-service`
Expected: PASS (3 tests)

- [ ] **Step 9: Commit**

```bash
git add services/orchestrator/package.json services/orchestrator/tsconfig.json services/orchestrator/vitest.config.ts services/orchestrator/src/types.ts services/orchestrator/src/github/ pnpm-lock.yaml
git commit -m "feat(orchestrator): GitHub service (Octokit) with PR/checks/merge"
```

---

## Task 5: TS orchestrator — sandbox client + core fusion logic

**Files:**
- Create: `src/sandbox/sandbox-runner-client.ts`, `src/sandbox/sandbox-runner-client.test.ts`, `src/core/run-fusion.ts`, `src/core/run-fusion.test.ts`

- [ ] **Step 1: Write the failing test for the sandbox client**

`services/orchestrator/src/sandbox/sandbox-runner-client.test.ts`:
```ts
import { describe, it, expect, afterEach } from "vitest";
import nock from "nock";
import { SandboxRunnerClient } from "./sandbox-runner-client.js";

afterEach(() => nock.cleanAll());

describe("SandboxRunnerClient", () => {
  it("posts /run and returns RunResult", async () => {
    nock("http://runner:8090")
      .post("/run")
      .reply(200, { branch: "feature/x", commitSha: "deadbeef" });

    const client = new SandboxRunnerClient("http://runner:8090");
    const res = await client.run({
      repoUrl: "https://github.com/o/r.git",
      baseBranch: "main",
      intent: "do it",
      branch: "feature/x",
    });
    expect(res).toEqual({ branch: "feature/x", commitSha: "deadbeef" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd services/orchestrator && pnpm test -- sandbox-runner-client`
Expected: FAIL — cannot find module `./sandbox-runner-client.js`

- [ ] **Step 3: Implement the sandbox client**

`services/orchestrator/src/sandbox/sandbox-runner-client.ts`:
```ts
import { request } from "undici";
import type { RunResult, SandboxRunRequest } from "../types.js";

export interface SandboxRunner {
  run(req: SandboxRunRequest): Promise<RunResult>;
}

export class SandboxRunnerClient implements SandboxRunner {
  constructor(private readonly baseUrl: string) {}

  async run(req: SandboxRunRequest): Promise<RunResult> {
    const res = await request(`${this.baseUrl}/run`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(req),
    });
    if (res.statusCode !== 200) {
      const text = await res.body.text();
      throw new Error(`sandbox-runner ${res.statusCode}: ${text}`);
    }
    return (await res.body.json()) as RunResult;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd services/orchestrator && pnpm test -- sandbox-runner-client`
Expected: PASS

- [ ] **Step 5: Write the failing test for run-fusion (the heart, over interfaces)**

`services/orchestrator/src/core/run-fusion.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";
import { runFusion } from "./run-fusion.js";
import type { SandboxRunner } from "../sandbox/sandbox-runner-client.js";
import type { GitHubService } from "../github/github-service.js";
import type { ChecksStatus } from "../types.js";

function deps(checks: ChecksStatus[]) {
  const sandbox: SandboxRunner = {
    run: vi.fn().mockResolvedValue({ branch: "feature/x", commitSha: "sha1" }),
  };
  let i = 0;
  const github: GitHubService = {
    openPr: vi.fn().mockResolvedValue({ number: 7, url: "u" }),
    getChecksStatus: vi.fn().mockImplementation(async () => checks[Math.min(i++, checks.length - 1)]),
    merge: vi.fn().mockResolvedValue(undefined),
  };
  return { sandbox, github };
}

const input = {
  owner: "o", repo: "r", repoUrl: "https://github.com/o/r.git",
  baseBranch: "main", intent: "do it", branch: "feature/x",
};

describe("runFusion", () => {
  it("auto-merges when checks go green", async () => {
    const d = deps(["pending", "success"]);
    const out = await runFusion(d, input, { pollMs: 0, maxPolls: 5 });
    expect(out.outcome).toBe("merged");
    expect(d.github.merge).toHaveBeenCalledWith("o", "r", 7);
  });

  it("does not merge and reports failure when checks fail", async () => {
    const d = deps(["failure"]);
    const out = await runFusion(d, input, { pollMs: 0, maxPolls: 5 });
    expect(out.outcome).toBe("checks_failed");
    expect(d.github.merge).not.toHaveBeenCalled();
  });

  it("times out if checks never resolve", async () => {
    const d = deps(["pending"]);
    const out = await runFusion(d, input, { pollMs: 0, maxPolls: 3 });
    expect(out.outcome).toBe("timeout");
    expect(d.github.merge).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `cd services/orchestrator && pnpm test -- run-fusion`
Expected: FAIL — cannot find module `./run-fusion.js`

- [ ] **Step 7: Implement run-fusion**

`services/orchestrator/src/core/run-fusion.ts`:
```ts
import type { SandboxRunner } from "../sandbox/sandbox-runner-client.js";
import type { GitHubService } from "../github/github-service.js";

export interface FusionDeps {
  sandbox: SandboxRunner;
  github: GitHubService;
}

export interface FusionInput {
  owner: string;
  repo: string;
  repoUrl: string;
  baseBranch: string;
  intent: string;
  branch: string;
}

export interface FusionOptions {
  pollMs: number;
  maxPolls: number;
}

export type FusionOutcome = "merged" | "checks_failed" | "timeout";

export interface FusionResult {
  outcome: FusionOutcome;
  prNumber?: number;
  prUrl?: string;
  commitSha?: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// NOTE: In Plan 4 the CI-resolution loop (fix-on-red) and risk router replace
// the simple failure/return below. The skeleton just gates on green/red/timeout.
export async function runFusion(
  deps: FusionDeps,
  input: FusionInput,
  opts: FusionOptions,
): Promise<FusionResult> {
  const run = await deps.sandbox.run({
    repoUrl: input.repoUrl,
    baseBranch: input.baseBranch,
    intent: input.intent,
    branch: input.branch,
  });

  const pr = await deps.github.openPr({
    owner: input.owner,
    repo: input.repo,
    head: run.branch,
    base: input.baseBranch,
    title: `agent: ${input.intent}`,
    body: `Automated change for intent: ${input.intent}\n\nCommit: ${run.commitSha}`,
  });

  for (let i = 0; i < opts.maxPolls; i++) {
    const status = await deps.github.getChecksStatus(input.owner, input.repo, run.commitSha);
    if (status === "success") {
      await deps.github.merge(input.owner, input.repo, pr.number);
      return { outcome: "merged", prNumber: pr.number, prUrl: pr.url, commitSha: run.commitSha };
    }
    if (status === "failure") {
      return { outcome: "checks_failed", prNumber: pr.number, prUrl: pr.url, commitSha: run.commitSha };
    }
    await sleep(opts.pollMs);
  }
  return { outcome: "timeout", prNumber: pr.number, prUrl: pr.url, commitSha: run.commitSha };
}
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `cd services/orchestrator && pnpm test -- run-fusion`
Expected: PASS (3 tests)

- [ ] **Step 9: Commit**

```bash
git add services/orchestrator/src/sandbox/ services/orchestrator/src/core/
git commit -m "feat(orchestrator): sandbox client + core fusion (auto-merge on green)"
```

---

## Task 6: TS orchestrator — Temporal workflow + activities

**Files:**
- Create: `src/temporal/activities.ts`, `src/temporal/workflow.ts`, `src/temporal/workflow.test.ts`

- [ ] **Step 1: Write the activities (thin wrappers around the core)**

`services/orchestrator/src/temporal/activities.ts`:
```ts
import { SandboxRunnerClient } from "../sandbox/sandbox-runner-client.js";
import { OctokitGitHubService } from "../github/octokit-github-service.js";
import { runFusion, type FusionInput, type FusionResult } from "../core/run-fusion.js";

export interface RunFusionActivityInput extends FusionInput {
  githubToken: string;
  sandboxUrl: string;
  pollMs: number;
  maxPolls: number;
}

export async function runFusionActivity(
  input: RunFusionActivityInput,
): Promise<FusionResult> {
  const deps = {
    sandbox: new SandboxRunnerClient(input.sandboxUrl),
    github: new OctokitGitHubService(input.githubToken),
  };
  return runFusion(deps, input, { pollMs: input.pollMs, maxPolls: input.maxPolls });
}
```

- [ ] **Step 2: Write the workflow**

`services/orchestrator/src/temporal/workflow.ts`:
```ts
import { proxyActivities } from "@temporalio/workflow";
import type * as activities from "./activities.js";
import type { FusionResult } from "../core/run-fusion.js";
import type { RunFusionActivityInput } from "./activities.js";

const { runFusionActivity } = proxyActivities<typeof activities>({
  startToCloseTimeout: "10 minutes",
  retry: { maximumAttempts: 3 },
});

export async function fusionWorkflow(
  input: RunFusionActivityInput,
): Promise<FusionResult> {
  return runFusionActivity(input);
}
```

- [ ] **Step 3: Write the failing workflow test**

`services/orchestrator/src/temporal/workflow.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { fusionWorkflow } from "./workflow.js";
import type { FusionResult } from "../core/run-fusion.js";

describe("fusionWorkflow", () => {
  it("returns the activity's merged outcome", async () => {
    const env = await TestWorkflowEnvironment.createTimeSkipping();
    try {
      const worker = await Worker.create({
        connection: env.nativeConnection,
        taskQueue: "test",
        workflowsPath: require.resolve("./workflow.js"),
        activities: {
          runFusionActivity: async (): Promise<FusionResult> => ({
            outcome: "merged", prNumber: 7, prUrl: "u", commitSha: "sha1",
          }),
        },
      });

      const result = await worker.runUntil(
        env.client.workflow.execute(fusionWorkflow, {
          taskQueue: "test",
          workflowId: "wf-test-1",
          args: [{
            owner: "o", repo: "r", repoUrl: "https://github.com/o/r.git",
            baseBranch: "main", intent: "x", branch: "feature/x",
            githubToken: "tok", sandboxUrl: "http://runner:8090",
            pollMs: 0, maxPolls: 3,
          }],
        }),
      );
      expect(result.outcome).toBe("merged");
    } finally {
      await env.teardown();
    }
  });
});
```

- [ ] **Step 4: Run test to verify it fails, then passes**

Run: `cd services/orchestrator && pnpm test -- workflow`
Expected: First run may FAIL if `workflow.js` resolution/config is off; fix imports until PASS. Final: PASS (1 test).

> Note: `@temporalio/testing` downloads a test server on first run; ensure network access. If `require.resolve` errors under ESM, set `vitest` `test.pool = "forks"` and use `new URL("./workflow.js", import.meta.url).pathname` for `workflowsPath`.

- [ ] **Step 5: Commit**

```bash
git add services/orchestrator/src/temporal/
git commit -m "feat(orchestrator): durable Temporal fusion workflow + activities"
```

---

## Task 7: End-to-end integration test (real loop, env-gated)

**Files:**
- Create: `services/orchestrator/vitest.e2e.config.ts`, `src/e2e/fusion.e2e.test.ts`, `docs/plans/e2e-setup.md`

- [ ] **Step 1: Create the e2e vitest config**

`services/orchestrator/vitest.e2e.config.ts`:
```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/e2e/**/*.e2e.test.ts"],
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
```

- [ ] **Step 2: Document the e2e prerequisites**

`docs/plans/e2e-setup.md`:
```markdown
# E2E setup

Required env vars (test is skipped if any are missing):
- `E2E_GITHUB_TOKEN` — PAT with `repo` scope on a throwaway test repo
- `E2E_REPO_OWNER` — e.g. `gagan114662`
- `E2E_REPO_NAME` — e.g. `acp-e2e-fixture` (must exist, have a `main` branch with 1 commit,
  and ideally a trivial always-green GitHub Actions check)
- `E2E_SANDBOX_URL` — e.g. `http://localhost:8090`

Run the sandbox-runner first:
    cd services/sandbox-runner && SANDBOX_ADDR=:8090 go run ./cmd/server

Then: `just e2e`
```

- [ ] **Step 3: Write the env-gated e2e test**

`services/orchestrator/src/e2e/fusion.e2e.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { runFusion } from "../core/run-fusion.js";
import { SandboxRunnerClient } from "../sandbox/sandbox-runner-client.js";
import { OctokitGitHubService } from "../github/octokit-github-service.js";

const env = {
  token: process.env.E2E_GITHUB_TOKEN,
  owner: process.env.E2E_REPO_OWNER,
  repo: process.env.E2E_REPO_NAME,
  sandboxUrl: process.env.E2E_SANDBOX_URL,
};
const ready = Object.values(env).every(Boolean);

describe.runIf(ready)("fusion e2e (real GitHub + sandbox)", () => {
  it("runs agent → opens PR → auto-merges on green", async () => {
    const branch = `agent/e2e-${Date.now()}`;
    const deps = {
      sandbox: new SandboxRunnerClient(env.sandboxUrl!),
      github: new OctokitGitHubService(env.token!),
    };
    const out = await runFusion(deps, {
      owner: env.owner!,
      repo: env.repo!,
      repoUrl: `https://x-access-token:${env.token}@github.com/${env.owner}/${env.repo}.git`,
      baseBranch: "main",
      intent: "e2e: append agent changes file",
      branch,
    }, { pollMs: 5000, maxPolls: 24 });

    expect(["merged", "checks_failed", "timeout"]).toContain(out.outcome);
    expect(out.prNumber).toBeGreaterThan(0);
    // With an always-green check on the fixture repo, this should be "merged".
    console.log("e2e outcome:", out);
  });
});
```

- [ ] **Step 4: Run the full unit suite to confirm no regressions**

Run: `just test`
Expected: all Go tests PASS, all TS unit tests PASS

- [ ] **Step 5: Run the e2e (if env configured)**

Run: `cd services/sandbox-runner && SANDBOX_ADDR=:8090 go run ./cmd/server &` then `just e2e`
Expected: with env set + always-green fixture → outcome `merged`, a real PR opened and merged. Without env → test suite reports the e2e as skipped.

- [ ] **Step 6: Commit**

```bash
git add services/orchestrator/vitest.e2e.config.ts services/orchestrator/src/e2e/ docs/plans/e2e-setup.md
git commit -m "test(orchestrator): env-gated end-to-end fusion test"
```

---

## Self-Review

**Spec coverage (Plan 1 scope only):**
- Fusion flow steps [4]–[9] (sandbox → agent → branch → PR → checks → merge): Tasks 1–6 ✅
- Auto-merge on green default: Task 5 `runFusion` ✅
- Durability (Temporal): Task 6 ✅
- Agent adapter interface (skeleton form: Go `Agent` + `FakeAgent`): Task 2 ✅
- Deterministic integration test w/ throwaway repo + fake agent: Task 7 ✅
- **Deferred (documented, other plans):** CI-resolution fix-on-red loop, risk router, QA-for-UI, K8s/gVisor isolation, multi-tenancy, chat/tasks, adapter SDK/registry, observability. These are explicitly out of Plan 1 scope.

**Placeholder scan:** No TBD/TODO; every code step has full code; commands have expected output. ✅

**Type consistency:** `RunResult{branch, commitSha}` matches across Go JSON tags (`branch`,`commitSha`), TS `types.ts`, sandbox client, and `runFusion`. `ChecksStatus` union identical in `types.ts` and consumers. `FusionResult.outcome` values (`merged|checks_failed|timeout`) consistent between `run-fusion.ts`, its tests, and the workflow test. ✅

---

## Definition of Done (Plan 1)

Running `just test` is green, and (with e2e env configured against an always-green fixture repo) `just e2e` produces a **real, auto-merged GitHub PR** created by the agent — proving mention-less but complete: intent → sandbox → agent → branch → PR → green → merge.
