---
description: await as the commit point, atomic segments, determinism, reachability, non-transactional externs, delegate jobs, versioning; read before changing what commits or when
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-19
last_updated: 2026-11-19
tags: [language, spec]
---

# 14. Persistence

`await` is the only persistence point, and it is allowed only inside an `async fn`, where it waits in its code's kind (§9.1): live code waits in memory, never committing or reaching the store, and ista code, the only code an instance runs, commits. The compiler checks only those rules; persistence itself is the runtime's job. The runtime executes the compiled program over an instance's memory snapshot. **Every `await` in ista code commits**, whether or not its future has already resolved: the snapshot is persisted (locals, call frames, position in the code and pending futures), and only then does the instance wait. The code alone therefore tells you what is durable: the code between two `await`s is one atomic segment, and every `await` ends one. The one `await` that doesn't end a segment is an async callee's first, reached inside its caller's segment: it hands control back to the caller, whose next `await` commits both (§6.1). The runtime may skip a physical write that would change nothing observable. To commit without waiting, write `await runtime.commit()`.

- **Frames are data.** A call suspended at an `await` keeps its frame in the snapshot, not on the host's stack, so an `await` at any depth in a call chain can be persisted and resumed. Calls running within a segment nest as deep as the implementation allows, at least 1,000 calls; a call nesting deeper panics with `A call nests deeper than the runtime allows.` (§12).
- **Atomic segments.** The code between two `await`s runs in memory. Its effects (state changes, slot operations and disposals) commit atomically at the next `await`. If the segment is interrupted before it commits, by a crash or a panic, it never happened.
- **Disposal points.** Since segments are atomic, disposing a running execution can only stop it at an `await`.
- **Determinism.** In ista code, `now()` returns the time its segment started (in live code, the clock), so every call within one segment sees the same time, and so does a re-run of that segment; so do the values it draws from `random` (§19.2).
- **Memory is reachability-based.** A snapshot persists only what is still reachable from the instance's live state, so unreachable shared structs and closure environments simply disappear. A disposable value is disposed at the point its last holder releases it instead, so that disposal is predictable (§16).
- **Persisted values nest at most 256 levels deep.** A deeper value works within a segment, but a segment that would commit one, reachable or as the outcome, panics instead (§12), so the instance stays at its last commit.
- **Extern effects aren't transactional.** The runtime doesn't make `extern fn` calls atomic with the segment. If a segment is discarded, the effects of extern calls it made remain, and a re-run calls them again. Idempotency is the developer's responsibility; an extern can, for example, return its own commit and abort handles for the workflow to call once it decides. Slot operations are exactly-once; anything the host provides is the host's responsibility.
- **Effects through `delegate`.** Ista code acts on the world through jobs: `runtime.delegate`, `ista fn delegate<R is Encodable & Decodable>(job: sendable live async fn() -> R) -> Future<R, "ista">`, called as a deferred call, `await runtime.delegate charge(card, total)` (§6.5). The job is queued when its segment commits, so a discarded segment queues none, and the runtime serving the instance (§17.1) runs it as live code, and again, after a restart, until its result commits into the future: it runs at least once, and only for committed history. Letting go of its future withdraws it (§16): a job not yet run never runs, and a running one is cancelled, so a job whose future loses a `select` stops as a losing call does (§15.4). Its result crosses back as JSON, so `R` needs its codecs (§17.4) rather than sendability; the job itself crosses as a sendable function. A job that panics panics the live code serving it, so it runs again once that code runs again.

```python
ista async fn remindLater(role: String):
    await time.delay(1d)              # persisted; resumes after a day
    notifications(role).send(Notice{text: "Reminder"})
```

**Versioning.** An instance's code is fixed for its whole lifetime: the definition is snapshotted when the instance is created and persisted with it. Nothing that refers to an instance's memory is sendable (§7.4), and what refers to code, a sendable function value, goes only to an instance of the same program, through `spawn`, so nothing crosses between versions. When a new version is deployed, its host starts its `main`. Everything else about the transition, such as keeping an old version's services running, is up to the program, and how what the host provides deals with versions is up to the host.
