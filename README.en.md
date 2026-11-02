# Blueprint Lab

Hands-on software architecture: short lessons, live simulations and incident-style exercises.
Live: https://exxbrain.github.io/blueprint-lab/ — switch RU / EN in the top bar.

[Русская версия](README.md)

## Run locally

```bash
npm install
npm run dev
```

## What's inside

- **Apache Kafka** (`#/kafka`): 6 lessons with embedded simulations, a quiz, 5 incident exercises and a sandbox.
  The engine (`src/sim/kafka/engine.ts`) models partitions and keys, replication, ISR, high watermark, acks,
  min.insync.replicas, unclean leader election, consumer groups, rebalancing, offset commits, duplicates and ordering.
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
- **Breaking up the monolith** (`#/monolith`): three levels — online store, food delivery and an online bank,
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

Every mission and exercise has a reference solution. `scripts/check.ts` runs them through the models in both
languages and fails if a reference misses a goal, exceeds the budget, a known trap solves a task, or a task is
already solved in its initial state.

## Translations

UI and content are bilingual via `tr('русский', 'English')` from `src/i18n.ts`. The language is chosen once per page load
(saved choice, `?lang=en`, or the browser language).

## License

[MIT](LICENSE)
