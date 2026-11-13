---
description: memoization, kind tables, explicit stacks, cycle components and broken invariants — read before caching, dispatching on kind or walking graphs
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-13
last_updated: 2026-11-13
tags: [reuse, structures, memo, kind-table, invariants]
---

# Structures and invariants

## Units

- dispatch exhaustively over a discriminated union's `kind` → `Handlers`, `handlerOf` (`src/foundation/structures/kind-table.ts`)
- compute and cache a derived value once per key (including `undefined`) → `memo`, `MemoCache` (`src/foundation/structures/memo.ts`)
- cache a value derived from a sequence of objects (a module's items, a list of overloads), kept while they are → `SequenceMemo` (`src/foundation/structures/memo.ts`)
- cache what is derived from an owner that changes in place (an inference system), once per revision the owner names, every member of a cycle answering a stand-in whichever was asked first (as `Entries`) → `RevisionMemo` (`src/foundation/structures/revision-memo.ts`)
- compute results once per key, each recording what it read and the notes it made, with cycles answered by a stand-in whichever member was asked first, and taken over by a later revision whose reads answer alike → `Entries`, `EntryTable` (`table`), `input`, `release`, `RevisionOptions` (`src/foundation/structures/entries/index.ts`)
- compare results item by item, entry by entry, member by member or property by property → `sameItems`, `sameEntries`, `sameMembers`, `sameProperties`, `Equality` (`src/foundation/structures/equality.ts`)
- leave out the items of a list equal to one before them, by a given equality, bucketed by a key equal items share when the list is long → `distinctItems` (`src/foundation/structures/equality.ts`)
- push an active item onto a work stack for the duration of a callback and pop in `finally` → `withPushed` (`src/foundation/structures/stack.ts`)
- push an iterable onto an explicit stack without overflowing the JS call stack → `pushAll` (`src/foundation/structures/stack.ts`)
- keep a group of items per key, adding them one at a time → `addToGroup` (`src/foundation/structures/groups.ts`); group a whole list by a key every item has → `Map.groupBy`
- find the last of items kept in ascending order whose key is at most a value, by bisection → `lastIndexAtMost` (`src/foundation/structures/sorted.ts`); never a `while (low < high)` loop of your own
- find strongly connected components or test whether an edge lies on a cycle → `stronglyConnected`, `GraphEdge` (`src/foundation/structures/strongly-connected.ts`)
- collect the edges a graph known node by node reaches from some roots, each node's edges once → `edgesReachedFrom` (`src/foundation/structures/reachable.ts`)
- fail on a broken toolchain invariant → `unreachable`, `Unreachable` (`src/foundation/structures/unreachable.ts`)

## One-way rules

- Open dispatches over node or instruction kinds use `Handlers` (`src/foundation/structures/kind-table.ts`), never `switch` with `default` (`docs/arch/architecture.md`).
- Derived caches use `memo` (`src/foundation/structures/memo.ts`) keyed by immutable input, or `RevisionMemo` keyed by the revision a mutable owner bumps at every change; never store a copy or invalidate by hand (`docs/arch/architecture.md`).
- A group is filled in place (`addToGroup`, `Map.groupBy`), never copied to append one item (`[...group, item]`), which makes filling it quadratic; only a persistent update, whose old map keeps its group, copies it.
- Recursive walks over unbounded values or heap graphs use an explicit stack (`pushAll`, `stronglyConnected`), never the JS call stack.
- Broken invariant → `unreachable`; invalid host call/text → `Refusal` / `FormatError`; language runtime failure → `Panic` or `Result`.
- Comparing collections, grouping, bisecting, ordering or caching uses the unit here (`sameItems`, `addToGroup`, `lastIndexAtMost`, `compareOrdered`, `memo`), never a loop of your own; `docs/audit/dry-review-2026-11-13.md` finding 19 lists the copies to replace.
- A partial table over node kinds is a `Handlers`-like table in `kind-table.ts`, never `{ [K in Kind]?: … }` with a cast at each site (six in `editor/`, finding 11).
