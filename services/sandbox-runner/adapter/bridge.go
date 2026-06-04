package adapter

import "context"

// agentBridge adapts an Adapter to the legacy simple Agent contract
// (Apply(repoDir, intent) error) by running it and discarding the event stream.
type agentBridge struct{ a Adapter }

func (b agentBridge) Apply(repoDir, intent string) error {
	return b.a.Run(context.Background(), repoDir, intent, func(Event) {})
}

// AsAgent wraps an Adapter so it structurally satisfies sandbox.Agent.
// Lets any SDK adapter drop into the existing Run() loop.
func AsAgent(a Adapter) interface{ Apply(repoDir, intent string) error } {
	return agentBridge{a}
}
