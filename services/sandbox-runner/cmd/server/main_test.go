package main

import (
	"testing"
	"time"
)

func TestNewServerTimeouts(t *testing.T) {
	srv := newServer(":0")
	if srv.ReadTimeout == 0 || srv.WriteTimeout == 0 || srv.IdleTimeout == 0 || srv.ReadHeaderTimeout == 0 {
		t.Fatalf("server missing timeouts: %+v", srv)
	}
	if srv.WriteTimeout < time.Minute {
		t.Fatalf("write timeout too small for long runs: %v", srv.WriteTimeout)
	}
	if srv.Handler == nil {
		t.Fatal("handler not set")
	}
}
