package sandbox

import "regexp"

// matches scheme://userinfo@  (userinfo = anything up to the @, no slash/space)
var urlCredsRe = regexp.MustCompile(`([a-zA-Z][a-zA-Z0-9+.\-]*://)[^/@\s]+@`)

// redactCreds removes userinfo (user:pass@ or token@) from any URLs in s,
// so credentials never appear in errors, logs, or HTTP responses.
func redactCreds(s string) string {
	return urlCredsRe.ReplaceAllString(s, "${1}[redacted]@")
}
