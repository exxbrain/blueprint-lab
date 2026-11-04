# Blueprint Lab

Hands-on software architecture: short lessons, live simulations and incident-style exercises.
The interface is available in English, Russian and Chinese: pick the language in the top bar.

[Русская версия](README.ru.md) · Deploying privately: [Cloudflare Workers + password](docs/deploy-cloudflare.md)

## Run locally

```bash
npm install
npm run dev
```

## What's inside

- **Apache Kafka** (`#/kafka`): 6 lessons with embedded simulations, a quiz, 5 incident exercises and a sandbox.
  The engine (`src/sim/kafka/engine.ts`) models partitions and keys, replication, ISR, high watermark, acks,
  min.insync.replicas, unclean leader election, consumer groups, rebalancing, offset commits, duplicates and ordering.
- **The architect's path** (`#/`, `#/profile`): the home page is a game-style level map. 52 challenges from every
  section are spread across four worlds (Junior → Middle → Senior → Architect, `src/levels.ts`); a world opens once
  every challenge of the previous one is solved. Challenges award XP (assessment stars add a bonus), and the player
  levels up from Intern to Architect.
- **Kubernetes** (`#/kubernetes`, `#/kubernetes/lab/<id>`): a lesson, a quiz and 12 incidents across all four worlds.
  Edit manifest fields and watch a second-by-second cluster model (`src/sim/k8s/engine.ts`): scheduler, probes,
  RollingUpdate / Recreate / canary, HPA, node and zone failures, drain with a PodDisruptionBudget, CPU contention, plus
  `kubectl get events`.
- **Architecture Builder** (`#/builder`): a graph of clients, load balancers, CDN, services, queues, cache and storages
  (PostgreSQL, Cassandra, MongoDB, Elasticsearch, ClickHouse, S3). Traffic carries a workload profile and every storage
  handles it with its own efficiency (`src/sim/builder/model.ts`). Sandbox mode, classic tasks, tool drills and
  system design tasks that start with a back-of-the-envelope estimate (`src/sim/builder/challenges.ts`). This is the
  heart of the app: the home page opens with a live diagram and the challenge catalog, and every challenge has its own
  link `#/builder/<id>`. Live traffic flows through the diagram (`src/sim/builder/emulate.ts`): real requests
  (`GET /api/products/1042`, `POST /ingest`), block operations (`GET product:1042` in Redis, SQL in PostgreSQL, CQL in
  Cassandra, `_search` in Elasticsearch, produce to Kafka) and real errors exactly where the model predicts them: 503s and
  timeouts under overload, `too many clients`, 502 from a dead end, an unsuitable storage, Seq Scan, consumer lag. A
  request log, a trace waterfall and a per-block log.
- **Breaking up the monolith** (`#/monolith`): each project starts with finding Bounded Contexts (Event Storming stickies,
  `src/sim/ddd`) and a Context Map, then the missions. Live traffic runs through the current split
  (`src/sim/monolith/emulate.ts`): in-process calls, REST between services, events via the broker, sagas, replicas, and
  real failures such as 404 without a facade, SQL into moved tables, lost events without an outbox and cascading timeouts.
  Three levels — online store, food delivery and an online bank,
  16 missions with a budget, a review of the final architecture and of the decomposition order. Strangler Fig step by
  step: extracting modules, separate databases, sagas, event-carried replicas, outbox, circuit breakers,
  27 microservice patterns, 16 stress tests and detection of unnecessary patterns
  (`src/sim/monolith/model.ts`, `src/sim/monolith/patterns.ts`).
- **C4 model** (`#/c4`): lessons, a quiz and a diagram editor with exercises — context, containers, components
  and "find the mistakes" in someone else's diagram (`src/sim/c4`).
- **Distributed data** (`#/data`): CAP and quorums (N/W/R, network partitions, sloppy quorum, last write wins vs merge)
  and Event Sourcing (reversals, rebuilding projections, snapshots, event versioning, concurrency) — `src/sim/cap`, `src/sim/es`.

## Solvability check

```bash
npm run check
```

Every mission and exercise has a reference solution. `scripts/check.ts` runs them through the models in all three
languages and fails if a reference misses a goal, exceeds the budget, a known trap solves a task, or a task is
already solved in its initial state. The last pass also checks that text parsing gives the same result in every
language: the builder's on-canvas hints and the kind of requests a client sends in live traffic (from its name).

## Translations

UI and content come in three languages via `tr('русский', 'English', '中文')` from `src/i18n.ts`; a missing Chinese
variant falls back to English. Long lessons have separate `…En` / `…Zh` components. The language is chosen once per
page load (saved choice, `?lang=en|ru|zh`, or the browser language).

## License

Proprietary, all rights reserved. Use, copying and distribution require the author's written permission. See [LICENSE](LICENSE).
