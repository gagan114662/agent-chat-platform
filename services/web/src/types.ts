export type AuthorKind = "human" | "agent";
export type MessageKind = "chat" | "system" | "pr_card" | "plan_card";

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
export interface Thread {
  id: string;
  orgId: string;
  channelId: string | null;
  title: string;
  repoId: string | null;
  kind: "channel" | "dm";
  dmPeerKind?: "human" | "agent" | null;
  dmPeerId?: string | null;
}

export interface ChangedFile {
  filename: string;
  additions: number;
  deletions: number;
  status: string;
  patch?: string; // unified diff hunks; omitted by GitHub for large/binary files
}

export interface Principal { kind: "human" | "agent"; id: string; name: string; }
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

export type MemoryKind = "decision" | "fact" | "preference" | "identity" | "artifact";
export type MemoryScope = "personal" | "project" | "team" | "org";
export interface MemoryNode { id: string; orgId: string; kind: MemoryKind; scope: MemoryScope; label: string; body: string; metadata: Record<string, unknown>; createdAt: string; }
export interface MemoryEdge { id: string; fromId: string; toId: string; relation: string; }
export interface MemoryGraph { nodes: MemoryNode[]; edges: MemoryEdge[]; }
export interface MemoryStats { nodes: number; edges: number; }
