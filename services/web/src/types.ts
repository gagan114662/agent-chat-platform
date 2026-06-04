export type AuthorKind = "human" | "agent";
export type MessageKind = "chat" | "system" | "pr_card";

export interface Message {
  id: string;
  orgId: string;
  threadId: string;
  authorKind: AuthorKind;
  authorId: string;
  kind: MessageKind;
  body: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

// Dev-auth stub headers the backend expects (Phase 2.2 replaces with real auth).
export const DEV_HEADERS = { "x-org-id": "o1", "x-user-id": "m1" } as const;

export interface Channel { id: string; orgId: string; workspaceId: string; name: string; }
export interface Thread { id: string; orgId: string; channelId: string; title: string; repoId: string | null; }
export interface Repo {
  id: string; orgId: string; workspaceId: string;
  githubOwner: string; githubName: string; defaultBranch: string; tokenEnvVar: string;
}

export interface SearchResult {
  messageId: string;
  threadId: string;
  threadTitle: string;
  body: string;
  kind: MessageKind;
  createdAt: string;
}
