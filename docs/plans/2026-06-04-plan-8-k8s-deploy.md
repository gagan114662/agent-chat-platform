# Plan 8 — Kubernetes Deploy: namespace-per-org isolation manifests

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Checkbox steps.

**Design (author's call):** The spec §8 production topology as deployable artifacts: an app Dockerfile + a kustomize layout with a **base** (app + sandbox-runner Deployments/Services, hardened securityContext) and a **per-org overlay** (Namespace, **ResourceQuota**, default-deny **NetworkPolicy** with an egress allowlist). Validated WITHOUT a live cluster: `docker build` the app image + `kubectl kustomize` renders the overlay. Deploying/validating against a real cluster needs OrbStack Kubernetes enabled (a GUI toggle) or any cluster — documented. Postgres/Temporal are referenced as external services (managed deps), not run in-cluster here.

**Tech Stack:** Docker, Kubernetes (kustomize via `kubectl kustomize`). Branch `plan-8-k8s-deploy` (off `main`). Commit with `-c user.name="gagan114662" -c user.email="gagan@getfoolish.com"`.

---

## Task 0: App Dockerfile

**Files:** Create `services/app/Dockerfile`, `services/app/.dockerignore`

> The app runs `.ts` over `tsx` (the orchestrator workspace dep exports `.ts` sources; the Temporal worker bundles workflows from source at runtime). So the image ships the monorepo source + deps and runs via `tsx`.

- [ ] **Step 1: `services/app/Dockerfile`** (build context = repo root):
```dockerfile
# Build context is the REPO ROOT (see deploy README). Runs the app via tsx over source.
FROM node:20-slim AS deps
RUN corepack enable
WORKDIR /repo
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY services/orchestrator/package.json services/orchestrator/package.json
COPY services/app/package.json services/app/package.json
RUN pnpm install --frozen-lockfile

FROM node:20-slim AS run
RUN corepack enable && apt-get update && apt-get install -y git ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /repo
COPY --from=deps /repo/node_modules ./node_modules
COPY --from=deps /repo/services/orchestrator/node_modules ./services/orchestrator/node_modules
COPY --from=deps /repo/services/app/node_modules ./services/app/node_modules
COPY . .
WORKDIR /repo/services/app
EXPOSE 8080
ENV PORT=8080
USER node
CMD ["node", "--import", "tsx", "src/server.ts"]
```

- [ ] **Step 2: `services/app/.dockerignore`**:
```
**/node_modules
**/dist
**/.git
**/*.log
services/web/node_modules
```

- [ ] **Step 3: Validate the image builds** (build context = repo root):
```
cd /Users/gaganarora/Desktop/my\ projects/agent-chat-platform
docker build -f services/app/Dockerfile -t acp-app:dev .
```
Expected: builds successfully. Paste the final lines. (If a `node_modules` COPY path doesn't exist because pnpm hoists differently, simplify the run stage to `COPY --from=deps /repo /repo` minus source, then `COPY . .` — adjust to make the build succeed; the goal is a working image. Report what you settled on.)

- [ ] **Step 4: commit**
```bash
git add services/app/Dockerfile services/app/.dockerignore
git -c user.name="gagan114662" -c user.email="gagan@getfoolish.com" commit -m "feat(deploy): app Dockerfile (tsx-over-source)"
```

---

## Task 1: K8s base manifests

**Files:** Create `deploy/k8s/base/{app.yaml,sandbox-runner.yaml,kustomization.yaml}`

- [ ] **Step 1: `deploy/k8s/base/app.yaml`** (Deployment + Service; hardened):
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: app
  labels: { app: acp-app }
spec:
  replicas: 1
  selector: { matchLabels: { app: acp-app } }
  template:
    metadata: { labels: { app: acp-app } }
    spec:
      automountServiceAccountToken: false
      securityContext:
        runAsNonRoot: true
        seccompProfile: { type: RuntimeDefault }
      containers:
        - name: app
          image: acp-app:dev
          ports: [{ containerPort: 8080 }]
          envFrom: [{ secretRef: { name: acp-app-env } }]
          securityContext:
            allowPrivilegeEscalation: false
            capabilities: { drop: ["ALL"] }
          resources:
            requests: { cpu: "100m", memory: "256Mi" }
            limits: { cpu: "1", memory: "1Gi" }
---
apiVersion: v1
kind: Service
metadata: { name: app }
spec:
  selector: { app: acp-app }
  ports: [{ port: 80, targetPort: 8080 }]
```

- [ ] **Step 2: `deploy/k8s/base/sandbox-runner.yaml`**:
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: sandbox-runner
  labels: { app: acp-sandbox-runner }
spec:
  replicas: 1
  selector: { matchLabels: { app: acp-sandbox-runner } }
  template:
    metadata: { labels: { app: acp-sandbox-runner } }
    spec:
      automountServiceAccountToken: false
      securityContext:
        runAsNonRoot: true
        runAsUser: 65532
        seccompProfile: { type: RuntimeDefault }
      # NOTE: production runs this pod on a gVisor/Kata RuntimeClass (kernel/microVM
      # boundary for untrusted agent code). Set `runtimeClassName: gvisor` once the
      # node runtime is installed.
      containers:
        - name: sandbox-runner
          image: acp-sandbox-runner:dev
          ports: [{ containerPort: 8090 }]
          env: [{ name: SANDBOX_ADDR, value: ":8090" }]
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            capabilities: { drop: ["ALL"] }
          volumeMounts: [{ name: work, mountPath: /tmp }]
          resources:
            requests: { cpu: "200m", memory: "256Mi" }
            limits: { cpu: "2", memory: "2Gi" }
      volumes: [{ name: work, emptyDir: {} }]
---
apiVersion: v1
kind: Service
metadata: { name: sandbox-runner }
spec:
  selector: { app: acp-sandbox-runner }
  ports: [{ port: 8090, targetPort: 8090 }]
```

- [ ] **Step 3: `deploy/k8s/base/kustomization.yaml`**:
```yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - app.yaml
  - sandbox-runner.yaml
```

- [ ] **Step 4:** validate base renders: `kubectl kustomize deploy/k8s/base >/dev/null && echo OK`.
- [ ] **Step 5: commit**
```bash
git add deploy/k8s/base
git -c user.name="gagan114662" -c user.email="gagan@getfoolish.com" commit -m "feat(deploy): k8s base manifests (app + sandbox-runner, hardened securityContext)"
```

---

## Task 2: Per-org overlay (namespace + ResourceQuota + NetworkPolicy)

**Files:** Create `deploy/k8s/overlays/org/{namespace.yaml,resourcequota.yaml,networkpolicy.yaml,kustomization.yaml}`

- [ ] **Step 1: `deploy/k8s/overlays/org/namespace.yaml`** (template — `org-REPLACE` is replaced per tenant):
```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: org-REPLACE
  labels: { acp.org: "REPLACE" }
```

- [ ] **Step 2: `deploy/k8s/overlays/org/resourcequota.yaml`** (caps concurrent sandboxes / spend per org):
```yaml
apiVersion: v1
kind: ResourceQuota
metadata: { name: org-quota }
spec:
  hard:
    pods: "20"
    requests.cpu: "4"
    requests.memory: 8Gi
    limits.cpu: "16"
    limits.memory: 32Gi
```

- [ ] **Step 3: `deploy/k8s/overlays/org/networkpolicy.yaml`** (default-deny + egress allowlist: DNS, HTTPS, intra-namespace):
```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: { name: default-deny-all }
spec:
  podSelector: {}
  policyTypes: ["Ingress", "Egress"]
---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: { name: allow-egress }
spec:
  podSelector: {}
  policyTypes: ["Egress"]
  egress:
    # DNS
    - to: []
      ports: [{ protocol: UDP, port: 53 }, { protocol: TCP, port: 53 }]
    # HTTPS to git remotes / LLM APIs / package registries (anti-exfiltration: only 443)
    - to: []
      ports: [{ protocol: TCP, port: 443 }]
    # intra-namespace (app <-> sandbox-runner)
    - to: [{ podSelector: {} }]
---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: { name: allow-intra-ingress }
spec:
  podSelector: {}
  policyTypes: ["Ingress"]
  ingress:
    - from: [{ podSelector: {} }]
```

- [ ] **Step 4: `deploy/k8s/overlays/org/kustomization.yaml`**:
```yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
namespace: org-REPLACE
resources:
  - ../../base
  - namespace.yaml
  - resourcequota.yaml
  - networkpolicy.yaml
```

- [ ] **Step 5:** validate the overlay renders: `kubectl kustomize deploy/k8s/overlays/org >/dev/null && echo OK`. Render to a file and eyeball that the namespace, quota, and 3 NetworkPolicies are present alongside the base Deployments/Services.
- [ ] **Step 6: commit**
```bash
git add deploy/k8s/overlays
git -c user.name="gagan114662" -c user.email="gagan@getfoolish.com" commit -m "feat(deploy): per-org overlay (namespace + ResourceQuota + egress-allowlist NetworkPolicy)"
```

---

## Task 3: Deploy README

**Files:** Create `deploy/k8s/README.md`

- [ ] **Step 1: `deploy/k8s/README.md`**:
```markdown
# Kubernetes deploy (spec §8: namespace-per-org isolation)

## Build images
    docker build -f services/app/Dockerfile -t acp-app:dev .          # context = repo root
    docker build -f services/sandbox-runner/Dockerfile -t acp-sandbox-runner:dev services/sandbox-runner

## Provision a tenant namespace
Replace `REPLACE` with the org id (e.g. `o1`) in `overlays/org/` (or `sed`/kustomize var), then:
    kubectl apply -k deploy/k8s/overlays/org

This creates `org-<id>` with:
- **ResourceQuota** — caps pods/CPU/memory per org (no noisy-neighbor).
- **NetworkPolicy** — default-deny + egress allowlist (DNS + HTTPS 443 + intra-namespace only) for anti-exfiltration.
- **app** + **sandbox-runner** Deployments/Services with hardened securityContext (non-root, drop ALL caps, seccomp RuntimeDefault; sandbox-runner read-only rootfs).

## Secrets / external deps
- `acp-app-env` Secret must provide `DATABASE_URL`, `TEMPORAL_ADDRESS`, `SANDBOX_URL`, `AUTH_REQUIRE_SESSION`, and the GitHub token env var. Postgres + Temporal are external managed services (not in these manifests).

## Untrusted-code isolation (production)
Set `runtimeClassName: gvisor` (or kata) on the sandbox-runner pod once the node runtime is installed — the kernel/microVM boundary for untrusted agent code (spec §8). Not enabled in these base manifests (needs a node runtime).

## Validate without a cluster
    kubectl kustomize deploy/k8s/overlays/org   # renders all manifests
```

- [ ] **Step 2:** final validation: `kubectl kustomize deploy/k8s/overlays/org >/dev/null && echo RENDER_OK`.
- [ ] **Step 3: commit**
```bash
git add deploy/k8s/README.md
git -c user.name="gagan114662" -c user.email="gagan@getfoolish.com" commit -m "docs(deploy): k8s deploy README"
```

---

## Self-Review
- Coverage (spec §8 production topology, as artifacts): namespace-per-org (overlay), ResourceQuota, default-deny + egress-allowlist NetworkPolicy, hardened securityContext (non-root, drop caps, seccomp, read-only rootfs for the runner), gVisor/Kata via RuntimeClass (documented hook). App Dockerfile. ✅
- Validation here is `docker build` (app image) + `kubectl kustomize` (renders) — **not** a live deploy (needs OrbStack Kubernetes enabled or any cluster). The manifests are deploy-ready; live validation is the next step once a cluster is available.
- Note: Postgres/Temporal are external managed deps (not in-cluster); cluster-per-org (premium tier) and the gVisor RuntimeClass install are future infra.

## Definition of Done (8)
`docker build -f services/app/Dockerfile .` succeeds and `kubectl kustomize deploy/k8s/overlays/org` renders the full per-org topology (namespace + quota + network policies + hardened app/runner). Deploying to a real cluster (OrbStack k8s once enabled, or any cluster) is the remaining infra step.
