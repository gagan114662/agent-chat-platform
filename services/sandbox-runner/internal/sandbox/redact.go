package sandbox

import "regexp"

// matches scheme://userinfo@  (userinfo = anything up to the @, no slash/space)
var urlCredsRe = regexp.MustCompile(`([a-zA-Z][a-zA-Z0-9+.\-]*://)[^/@\s]+@`)

// bareTokenRes catch credentials that appear OUTSIDE a URL userinfo (raw in
// logs, headers, argv echoes). Order matters: x-access-token:<tok> is handled
// before the generic ghp_ rule so the whole "key:value" is redacted.
var bareTokenRes = []*regexp.Regexp{
	regexp.MustCompile(`x-access-token:[^@\s/]+`),
	regexp.MustCompile(`gh[pousr]_[0-9A-Za-z]+`),
	regexp.MustCompile(`github_pat_[0-9A-Za-z_]+`),
	regexp.MustCompile(`Bearer\s+[\w.\-]+`),
	regexp.MustCompile(`AKIA[0-9A-Z]{16}`),
}

// redactCreds removes userinfo (user:pass@ or token@) from any URLs in s AND
// any bare tokens (GitHub PATs, OAuth tokens, Bearer headers, AWS keys), so
// credentials never appear in errors, logs, or HTTP responses.
func redactCreds(s string) string {
	s = urlCredsRe.ReplaceAllString(s, "${1}[redacted]@")
	for _, re := range bareTokenRes {
		s = re.ReplaceAllString(s, "[redacted]")
	}
	return s
}
