package mcpproxy

import (
	"encoding/json"
	"errors"
	"io"
	"math"
	"net/http"

	"github.com/gagan114662/agent-chat-platform/sandbox-runner/internal/paymentgate"
)

// MCP tool calls arrive as JSON-RPC: method "tools/call", params {name, arguments}.
// jsonRPCRequest is the slice we care about for gating.
type jsonRPCRequest struct {
	Method string         `json:"method"`
	Params map[string]any `json:"params"`
}

// CallFromMCP extracts the gate's Call (tool + amount + recipient) and the agent's
// justification from an MCP tools/call params object. Amount accepts either
// `amount_cents` (integer minor units) or `amount` (major units, ×100).
func CallFromMCP(params map[string]any) (paymentgate.Call, string) {
	var call paymentgate.Call
	var justification string
	name, _ := params["name"].(string)
	call.Tool = name
	args, _ := params["arguments"].(map[string]any)
	if args != nil {
		call.AmountCents = amountCents(args)
		call.Recipient, _ = args["recipient"].(string)
		justification, _ = args["justification"].(string)
	}
	return call, justification
}

func amountCents(args map[string]any) int64 {
	if v, ok := args["amount_cents"]; ok {
		if f, ok := v.(float64); ok {
			return int64(f)
		}
	}
	if v, ok := args["amount"]; ok {
		if f, ok := v.(float64); ok {
			return int64(math.Round(f * 100))
		}
	}
	return 0
}

// Handler returns an http.Handler that gates each incoming MCP tools/call. Non
// tools/call requests pass straight to the upstream. The body is forwarded
// verbatim on approve so the agent resumes unaware.
func (p *Proxy) Handler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, err := io.ReadAll(r.Body)
		if err != nil {
			http.Error(w, "read body", http.StatusBadRequest)
			return
		}
		var req jsonRPCRequest
		_ = json.Unmarshal(body, &req)
		// Only tools/call invocations are gated; everything else (initialize,
		// tools/list, …) forwards untouched.
		if req.Method != "tools/call" {
			out, ferr := p.Up.Forward(r.Context(), body)
			writeResult(w, out, ferr)
			return
		}
		call, justification := CallFromMCP(req.Params)
		out, herr := p.Handle(r.Context(), call, justification, body)
		writeResult(w, out, herr)
	})
}

func writeResult(w http.ResponseWriter, out []byte, err error) {
	w.Header().Set("Content-Type", "application/json")
	if err != nil {
		// Map gate verdicts to status codes; agent sees a clean JSON-RPC-ish error.
		code := http.StatusBadGateway
		if errors.Is(err, ErrDenied) {
			code = http.StatusForbidden
		} else if errors.Is(err, ErrDeclined) {
			code = http.StatusForbidden
		}
		w.WriteHeader(code)
		_ = json.NewEncoder(w).Encode(map[string]any{"error": err.Error()})
		return
	}
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(out)
}
