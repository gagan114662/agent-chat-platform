# Kubernetes deploy (spec §8: namespace-per-org isolation)

## Build images
    docker build -f services/app/Dockerfile -t acp-app:dev .          # context = repo root
    docker build -f services/sandbox-runner/Dockerfile -t acp-sandbox-runner:dev services/sandbox-runner

The base manifests set `imagePullPolicy: Never` so a cluster that shares the local
Docker image store (e.g. **OrbStack Kubernetes**) uses the locally-built images directly —
no registry push needed. For a remote cluster, retag/push the images and change the
pull policy (or use a registry-qualified image name) instead.

## Provision a tenant namespace
The overlay in `overlays/org/` is a **template**: `org-REPLACE` / `REPLACE` are placeholders
for the org id. Render a concrete org without mutating the committed template by copying the
`deploy/k8s` tree (preserving the `../../base` relative path) and `sed`-ing the placeholder:

    rm -rf /tmp/acp-k8s && mkdir -p /tmp/acp-k8s
    cp -r deploy/k8s/base     /tmp/acp-k8s/base
    cp -r deploy/k8s/overlays /tmp/acp-k8s/overlays
    sed -i '' 's/REPLACE/o1/g' \
      /tmp/acp-k8s/overlays/org/kustomization.yaml \
      /tmp/acp-k8s/overlays/org/namespace.yaml
    kubectl apply -k /tmp/acp-k8s/overlays/org      # creates namespace org-o1

(On Linux use `sed -i 's/REPLACE/o1/g' ...` without the empty `''` argument.)

This creates `org-<id>` with:
- **ResourceQuota** — caps pods/CPU/memory per org (no noisy-neighbor). Enforced: pods that
  omit resource requests/limits are rejected once the quota is set.
- **NetworkPolicy** — default-deny + egress allowlist (DNS + HTTPS 443 + intra-namespace only)
  for anti-exfiltration. Requires a policy-enforcing CNI (Calico/Cilium). NOTE: OrbStack's
  built-in CNI does **not** enforce NetworkPolicy — the objects apply cleanly but traffic is
  not filtered there; enforcement is a prod-CNI concern.
- **app** + **sandbox-runner** Deployments/Services with hardened securityContext (non-root,
  drop ALL caps, seccomp RuntimeDefault; sandbox-runner read-only rootfs).

## Secrets / external deps
- `acp-app-env` Secret must provide `DATABASE_URL`, `TEMPORAL_ADDRESS`, `SANDBOX_URL`,
  `AUTH_REQUIRE_SESSION`, and the GitHub token env var. Postgres + Temporal are external
  managed services (not in these manifests). Without this Secret the **app** pod stays in
  `CreateContainerConfigError` (`secret "acp-app-env" not found`) — expected when only the
  k8s topology is being validated; `kubectl -n org-<id> scale deploy/app --replicas=0` parks it.

## Untrusted-code isolation (production)
Set `runtimeClassName: gvisor` (or kata) on the sandbox-runner pod once the node runtime is
installed — the kernel/microVM boundary for untrusted agent code (spec §8). Not enabled in
these base manifests (needs a node runtime).

## Validate without a cluster
    kubectl kustomize deploy/k8s/overlays/org   # renders all manifests (template form)

## Tear down a tenant
    kubectl delete ns org-o1
