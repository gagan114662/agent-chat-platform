test-go:
    cd services/sandbox-runner && go test ./...

test-ts:
    cd services/orchestrator && pnpm test

test: test-go test-ts

e2e:
    cd services/orchestrator && pnpm test:e2e
