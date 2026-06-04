package sandbox

import (
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

		res, err := Run(r.Context(), req, FakeAgent{})
		if err != nil {
			http.Error(w, redactCreds(err.Error()), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(res)
	})
	return mux
}
