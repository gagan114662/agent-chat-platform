package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/gagan114662/agent-chat-platform/sandbox-runner/internal/sandbox"
)

// newServer builds the HTTP server with sane timeouts (no Slowloris / runaway).
func newServer(addr string) *http.Server {
	return &http.Server{
		Addr:              addr,
		Handler:           sandbox.NewHandler(),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      10 * time.Minute, // a run can take minutes
		IdleTimeout:       60 * time.Second,
	}
}

func main() {
	addr := os.Getenv("SANDBOX_ADDR")
	if addr == "" {
		addr = ":8090"
	}
	srv := newServer(addr)

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	go func() {
		log.Printf("sandbox-runner listening on %s", addr)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatal(err)
		}
	}()

	<-ctx.Done()
	log.Println("shutting down…")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		log.Printf("graceful shutdown error: %v", err)
	}
}
