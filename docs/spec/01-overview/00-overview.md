---
description: what Istalang is for and its design principles (visible persistence, one coordination primitive, predictable disposal, value semantics); read to understand why the rules are as they are
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-19
last_updated: 2026-11-19
tags: [language, spec]
---

# 1. Overview

This is a strongly typed, Python-like language for durable, long-running workflows. Persistence happens only in `ista` code: its execution state is persisted as a snapshot at every `await` and can resume days later, across restarts. A program's `main` is `live` and enters ista code through a runtime (§17.1).

Design principles:

- **Visible persistence.** `await` is the only place execution can suspend. Code is marked with the data it may handle (§9.1): in `ista` code every `await` commits, and `live` code waits in memory and never commits. The compiler keeps the two kinds apart.
- **One coordination primitive.** Instances coordinate through slots. Inboxes, request/response, broadcast and fan-out are library types built on them.
- **Predictable disposal.** Resources such as pending futures, slots and inboxes are disposed when the last block holding them ends: by default, the block that created them.
- **Explicit over implicit.** Every send states whether it is durable or revertible, by calling `send` or `sendRevertible`. There is no default.
- **Strong static typing.** Every variable, parameter, field and return value has a static type, with generics. Variables are block scoped.
- **Value semantics.** Structs and collections are copied when assigned, passed, returned or sent. Data that other code holds changes only through an explicit `&` reference, a handle, such as a `Shared` value (§5.4), or a `let` that a closure captured, whose cell the closure shares (§6.4).
- **Everything that branches is an expression.** `if`, `match` and `select` produce values, and the compiler checks that all branches agree on one type.
