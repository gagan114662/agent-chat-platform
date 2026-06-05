# Hot-path scaling: low-latency data layer (#96)

> **Status:** design recorded. **P2 / not urgent at current volume** — Postgres handles today's load. This documents the architecture so the data layer is built with the 50x path (Agoda's ScyllaDB feature-store migration) in mind. Implement when a hot path's p99 actually regresses.

## Principle
Postgres stays the **system of record**. For hot read/serving paths, introduce a denormalized **low-latency store** (ScyllaDB / Cassandra / DynamoDB-class) **behind a repository interface**, so the rest of the app is unaware which store answers a read.

## The hot paths (where Postgres will bottleneck first)
| Path | Today | At scale |
|---|---|---|
| **Memory recall** (#26/#40/#82) | ILIKE over `memory_nodes` | denormalized recall index / embeddings (pgvector → dedicated vector store) |
| **Log + event ingestion/query** (#55/#95/#93) | `log_events`/`run_events`/`incidents` rows | wide-row append + TTL, partition by (org, run/source, time) |
| **Autonomy signals** (#67 tick / #93 alerts) | per-tick aggregate queries | precomputed per-(org,repo,agent) signals — a real "feature store" |
| **Realtime fan-out** | LISTEN/NOTIFY + WS | unchanged for now (pub/sub is already low-latency) |

## The seam (do this first, cheaply)
Define a `Repository` interface per hot path (e.g. `MemoryRecallRepo`, `LogEventRepo`, `SignalRepo`) with a **Postgres implementation today**. Routes/services depend on the interface, never raw SQL for these paths. Swapping in a Scylla impl later is then a localized change, not a refactor.

```ts
interface LogEventRepo {
  append(orgId: string, source: string, events: LogEvent[]): Promise<void>;
  recentErrors(orgId: string, limit: number): Promise<LogEvent[]>;
}
// PgLogEventRepo today; ScyllaLogEventRepo when volume demands.
```

## Data modeling lessons (Agoda → ScyllaDB, the #96 reference)
- **Wide rows + denormalization**: store the read shape, not the normalized shape (one query, no joins).
- **Partition-key design**: partition by (org, run/source, time-bucket) to spread load + avoid hot partitions; never a monotonic single key.
- **TTL** for ephemeral data (log/event rows expire automatically — no batch deletes).
- **Tunable consistency**: reads can tolerate eventual consistency for serving paths.
- **Multi-DC replication** for HA/locality when we go multi-region.

## When to act
Trigger the migration of a specific path when its p99 read latency or write throughput regresses under real org volume — not before. The repository seam means we can move one path at a time. Until then this stays a design note.

Related: #26/#40/#82 (memory), #55/#95/#93 (logs/observability), #67 (autonomy signals).
