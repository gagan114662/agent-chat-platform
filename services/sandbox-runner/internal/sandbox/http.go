package sandbox

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"

	"github.com/gagan114662/agent-chat-platform/sandbox-runner/adapter"
)

// NewHandler returns the sandbox-runner HTTP mux.
func NewHandler() http.Handler {
	limits := LimitsFromEnv()
	sem := newSemaphore(limits.MaxConcurrent) // shared across both routes
	mux := http.NewServeMux()
	mux.HandleFunc("POST /run", func(w http.ResponseWriter, r *http.Request) {
		r.Body = http.MaxBytesReader(w, r.Body, 1<<20) // cap request body at 1 MiB
		if !sem.tryAcquire() {
			http.Error(w, "too many concurrent runs", http.StatusServiceUnavailable)
			return
		}
		defer sem.release()
		ctx, cancel := context.WithTimeout(r.Context(), limits.Timeout)
		defer cancel()
		var req RunRequest
		dec := json.NewDecoder(r.Body)
		dec.DisallowUnknownFields()
		if err := dec.Decode(&req); err != nil {
			http.Error(w, redactCreds(err.Error()), http.StatusBadRequest)
			return
		}
		if err := req.Validate(); err != nil {
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

		name := req.Adapter
		if name == "" {
			name = "fake"
		}
		if !adapterAuthorized(name) {
			http.Error(w, "adapter not authorized: "+name, http.StatusForbidden)
			return
		}
		factory, ok := adapter.DefaultRegistry().Get(name)
		if !ok {
			http.Error(w, "unknown adapter: "+name, http.StatusBadRequest)
			return
		}
		ad := factory()
		if err := ad.Prepare(ctx, adapter.PrepareContext{RepoDir: req.WorkDir, Intent: req.Intent, Model: req.Model, Provider: req.Provider}); err != nil {
			http.Error(w, redactCreds(err.Error()), http.StatusBadRequest)
			return
		}
		var ag Agent = adapter.AsAgent(ad)

		res, err := Run(ctx, req, ag, limits)
		if err != nil {
			http.Error(w, redactCreds(err.Error()), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(res)
	})
	mux.HandleFunc("POST /plan", func(w http.ResponseWriter, r *http.Request) {
		r.Body = http.MaxBytesReader(w, r.Body, 1<<20) // cap request body at 1 MiB
		if !sem.tryAcquire() {
			http.Error(w, "too many concurrent runs", http.StatusServiceUnavailable)
			return
		}
		defer sem.release()
		ctx, cancel := context.WithTimeout(r.Context(), limits.Timeout)
		defer cancel()
		var req PlanRequest
		dec := json.NewDecoder(r.Body)
		dec.DisallowUnknownFields()
		if err := dec.Decode(&req); err != nil {
			http.Error(w, redactCreds(err.Error()), http.StatusBadRequest)
			return
		}
		if err := req.Validate(); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		work, err := os.MkdirTemp("", "sbx-plan-*")
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		defer os.RemoveAll(work)
		req.WorkDir = filepath.Join(work, "repo")

		name := req.Adapter
		if name == "" {
			name = "fake"
		}
		if !adapterAuthorized(name) {
			http.Error(w, "adapter not authorized: "+name, http.StatusForbidden)
			return
		}
		factory, ok := adapter.DefaultRegistry().Get(name)
		if !ok {
			http.Error(w, "unknown adapter: "+name, http.StatusBadRequest)
			return
		}
		ad := factory()

		res, err := Plan(ctx, req, ad, limits)
		if err != nil {
			http.Error(w, redactCreds(err.Error()), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(res)
	})
	mux.HandleFunc("POST /feedback", func(w http.ResponseWriter, r *http.Request) {
		r.Body = http.MaxBytesReader(w, r.Body, 1<<20) // cap request body at 1 MiB
		if !sem.tryAcquire() {
			http.Error(w, "too many concurrent runs", http.StatusServiceUnavailable)
			return
		}
		defer sem.release()
		ctx, cancel := context.WithTimeout(r.Context(), limits.Timeout)
		defer cancel()
		var req FeedbackRequest
		dec := json.NewDecoder(r.Body)
		dec.DisallowUnknownFields()
		if err := dec.Decode(&req); err != nil {
			http.Error(w, redactCreds(err.Error()), http.StatusBadRequest)
			return
		}
		if err := req.Validate(); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		work, err := os.MkdirTemp("", "sbx-fb-*")
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		defer os.RemoveAll(work)
		req.WorkDir = filepath.Join(work, "repo")

		name := req.Adapter
		if name == "" {
			name = "fake"
		}
		if !adapterAuthorized(name) {
			http.Error(w, "adapter not authorized: "+name, http.StatusForbidden)
			return
		}
		factory, ok := adapter.DefaultRegistry().Get(name)
		if !ok {
			http.Error(w, "unknown adapter: "+name, http.StatusBadRequest)
			return
		}
		ad := factory()

		res, err := Feedback(ctx, req, ad, limits)
		if err != nil {
			http.Error(w, redactCreds(err.Error()), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(res)
	})
	return mux
}
