---
description: memoization, kind tables, explicit stacks, cycle components and broken invariants — read before caching, dispatching on kind or walking graphs
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-10-29
last_updated: 2026-10-29
tags: [reuse, structures, memo, kind-table, invariants]
---

# Structures and invariants

## Units

- dispatch exhaustively over a discriminated union's `kind` → `Handlers`, `handlerOf` (`src/structures/kind-table.ts`)
- compute and cache a derived value once per key (including `undefined`) → `memo`, `MemoCache` (`src/structures/memo.ts`)
- compute results once per key, each recording what it read and the notes it made, with cycles answered by a stand-in whichever member was asked first, and taken over by a later revision whose reads answer alike → `Entries`, `EntryTable` (`table`), `input`, `release`, `RevisionOptions` (`src/structures/entries.ts`)
- compare results item by item, entry by entry, member by member or property by property → `sameItems`, `sameEntries`, `sameMembers`, `sameProperties`, `Equality` (`src/structures/equality.ts`)
- push an active item onto a work stack for the duration of a callback and pop in `finally` → `withPushed` (`src/structures/stack.ts`)
- push an iterable onto an explicit stack without overflowing the JS call stack → `pushAll` (`src/structures/stack.ts`)
- find the last of items kept in ascending order whose key is at most a value, by bisection → `lastIndexAtMost` (`src/structures/sorted.ts`)
- find strongly connected components or test whether an edge lies on a cycle → `stronglyConnected`, `GraphEdge` (`src/structures/strongly-connected.ts`)
- fail on a broken toolchain invariant → `unreachable`, `Unreachable` (`src/structures/unreachable.ts`)

## One-way rules

- Open dispatches over node or instruction kinds use `Handlers` (`src/structures/kind-table.ts`), never `switch` with `default` (`docs/arch/architecture.md`).
- Derived caches use `memo` (`src/structures/memo.ts`) keyed by immutable input; never store a copy or invalidate by hand (`docs/arch/architecture.md`).
- Recursive walks over unbounded values or heap graphs use an explicit stack (`pushAll`, `stronglyConnected`), never the JS call stack.
- Broken invariant → `unreachable`; invalid host call/text → `Refusal` / `FormatError`; language runtime failure → `Panic` or `Result`.
