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
