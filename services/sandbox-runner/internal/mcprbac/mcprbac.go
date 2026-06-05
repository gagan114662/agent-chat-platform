// Package mcprbac is the role-based authorization layer for the central MCP proxy
// (#112). Every agent tool call carries the acting role; this decides whether that
// role may reach a tool of a given security tier ("safe" | "sensitive" | "money",
// matching the adapter MCP catalog). It is deny-by-default: unknown roles/tiers
// get nothing. Pairs with paymentgate/mcpproxy — RBAC gates WHO may call a tool;
// the payment gate gates money calls behind a human regardless of role.
package mcprbac

type Policy struct {
	// role → the set of tiers that role may invoke. Absent role = no access.
	RoleTiers map[string][]string `json:"roleTiers"`
}

// DefaultPolicy: admins reach everything (money still hits the human gate),
// members reach safe+sensitive, viewers reach only safe (read-only) tools.
func DefaultPolicy() Policy {
	return Policy{RoleTiers: map[string][]string{
		"admin":  {"safe", "sensitive", "money"},
		"member": {"safe", "sensitive"},
		"viewer": {"safe"},
	}}
}

// Allowed reports whether `role` may invoke a tool of `tier`. Deny-by-default.
func (p Policy) Allowed(role, tier string) bool {
	tiers, ok := p.RoleTiers[role]
	if !ok {
		return false
	}
	for _, t := range tiers {
		if t == tier {
			return true
		}
	}
	return false
}
