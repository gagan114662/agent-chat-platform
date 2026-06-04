package sandbox

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"

	"github.com/gagan114662/agent-chat-platform/sandbox-runner/adapter"
)

// NewHandler returns the sandbox-runner HTTP mux.
func NewHandler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("POST /run", func(w http.ResponseWriter, r *http.Request) {
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
		factory, ok := adapter.DefaultRegistry().Get(name)
		if !ok {
			http.Error(w, "unknown adapter: "+name, http.StatusBadRequest)
			return
		}
		ad := factory()
		if err := ad.Prepare(r.Context(), adapter.PrepareContext{RepoDir: req.WorkDir, Intent: req.Intent}); err != nil {
			http.Error(w, redactCreds(err.Error()), http.StatusBadRequest)
			return
		}
		var ag Agent = adapter.AsAgent(ad)

		res, err := Run(r.Context(), req, ag)
		if err != nil {
			http.Error(w, redactCreds(err.Error()), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(res)
	})
	return mux
}
