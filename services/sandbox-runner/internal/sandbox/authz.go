package sandbox

import (
	"os"
	"strings"
)

// adapterAuthorized reports whether an adapter name may be invoked by this runner.
// "fake" (the safe no-op test adapter) is always allowed. Every other adapter —
// including code-executing ones like "claude-code" — must be listed in the
// comma-separated ACP_ALLOWED_ADAPTERS env (default-deny). Empty name → "fake".
func adapterAuthorized(name string) bool {
	if name == "" || name == "fake" {
		return true
	}
	for _, a := range strings.Split(os.Getenv("ACP_ALLOWED_ADAPTERS"), ",") {
		if strings.TrimSpace(a) == name {
			return true
		}
	}
	return false
}
