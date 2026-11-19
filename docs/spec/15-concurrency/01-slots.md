---
description: slots, their three operations and their one queue; read before changing slots
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-19
last_updated: 2026-11-19
tags: [language, spec]
---

# 15.1 Slots

**Slots.** A `Slot<T>` is the runtime's one primitive for communication: a place that is either empty or full, shared by the concurrent executions of one instance and persisted with it. It is created empty with `Slot.create<T>()`, and three operations use it, each returning a future:

| Operation | Waits until | Then |
| --- | --- | --- |
| `slot.put(v)` | the slot is empty | fills it with `v` |
| `slot.take()` | the slot is full | empties it and yields the value |
| `slot.read()` | the slot is full | yields the value and leaves it there |

- **One queue.** A slot's waiting operations, of every kind, form one queue, longest waiter first. Competing takes are therefore atomic: exactly one gets each value, the one that has waited longest; waiting puts fill the slot in the same order.
- **Serving the queue.** When a value arrives, the waiters are served in queue order: every `read` before the first `take` yields the value, and that `take` empties the slot. The next waiting `put` then fills it again, and the queue goes on.
- **At once when it can.** An operation that can complete when it is called (a `put` on an empty slot, a `take` or `read` on a full one) completes then, inside the caller's segment, and its future is already resolved.
- **Awaiting still commits.** Awaiting any of these futures commits, like every `await`, even one already resolved, and the execution then runs after every execution that became ready before it.

When the runtime fills a slot, it wakes the waiters even if the whole instance is suspended and persisted, which only the runtime can do.
