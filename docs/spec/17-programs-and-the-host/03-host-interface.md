---
description: what a host can do, extern keys, the three forms of communication, ista run; read before changing the host API or the CLI's run
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-19
last_updated: 2026-11-19
tags: [language, spec]
---

# 17.3 Host interface

**Host interface.** The language has no I/O of its own. Its only contact with the outside world is the host (the runtime and the applications around it), which provides the `extern` declarations a program uses (§17.2). Beyond that, the host can:

- **Start** live or simple code, on the version it chooses, with arguments as JSON, as a live run whose end the host learns. Everything the function holds is disposed when it returns. A host may start a top-level function, or a top-level constant holding a sendable lambda (§6.4), that isn't generic and takes all its parameters by value with types that can be read from JSON. It never starts ista code, which live code calls in a context.
- **Inspect** any instance: its state (waiting, panicked, finished or terminated) and where each of its executions waits, by waypoint (§18) or source location; a panicked one, or one terminated after its panic, also gives its message and trace.
- **Wake watchers:** a waiting instance names the instances whose end it waits for through `result()`. Once one of them has ended, the host wakes it, and the runtime reads that end from the instance's last commit, so no outcome passes through the host.
- **Operate** panicked instances: retry one from its last snapshot, where the failed segment runs again with the time it first started at (§14), or terminate it, which ends it as terminated and disposes what it holds (§12, §16).
- **Learn of spawned instances:** advancing an instance tells the host which instances it spawned, so the host runs them too.
- **Receive logs:** advancing an instance also gives the log records its committed segments wrote, in order (§19.2). They aren't kept in the snapshot, so a host that crashes before taking them loses them.

A host names what it starts, and each extern it implements, by its key: the module's name, the function's or constant's name and its parameter types, as in `purchase.chargeCard(String, Int)`, `purchase.dispose(purchase.Sent)` or `purchase.approvalDeadline`, a `T | None` spelled through its alias, `prelude.Optional<T>`, and a function type with its kind, `ista fn() -> prelude.Future<R, "ista">`. Overloads therefore have distinct keys, and every instantiation of a generic extern shares one. A host written in JavaScript works with JSON as `JSON.parse` gives it, except that every integer is a `bigint`, so an `Int` keeps every digit and reads apart from a `Float`; it may give back a `bigint` or a whole number for one. What it gives back is read as `JSON.stringify` would write it, so `undefined` is `null`, or a missing field inside an object: a function returning nothing gives `Unit` or `none`.

Communication across this boundary takes only three forms: the program calls an `extern fn`, the host resolves a live future its extern gave, or the host starts live code. The host never calls program functions directly. Asynchronous host work hands live code something to wait on instead of taking a callback, for example `extern live async fn fetch(req: Request) -> Response`, whose future the host resolves when it can (§17.2); ista code waits on it through a job, `await runtime.delegate fetch(req)` (§14). An extern's result, a value an extern constant gives, or JSON a host's future resolves with, that doesn't fit its declared type panics the code that called it, as a promise that rejects does; an instance started with JSON that doesn't fit fails the host's call instead.

**Running a program locally.** `ista run <entry>` is a host for development. It compiles the program whose entry module is `entry`, which must declare `live async fn main()`, and runs nothing if any module has errors. It then runs `main` as a live run, with the contexts it calls and every instance they spawn, until `main` ends, and prints `main`'s outcome as JSON, using the mapping of §17.4. A panic of `main` prints the panic's message and trace instead. An instance that panics with no call into it waiting to hear it, one a context spawned or a context whose caller is gone, prints its name, message and trace to the error stream, and the run exits with a failure; one that `runtime.isolate` terminated was handled, so it fails nothing. Each log record goes to the error stream as one line of JSON. Two options stand in for what a real host provides:
- `--store <dir>` is the host's store: it keeps the compiled program and every commit of the run's contexts in a directory, so a run can stop, and running a program again on the same store resumes the contexts it left, each on the program it started with. A run with a store prints its name, the key of `main`'s context, to the error stream.
- `--host <module>` loads a JavaScript module whose default export implements the program's externs, keyed by their keys: each takes and returns JSON values, and one for an `extern live async fn` may return a promise, which resolves the future when it settles, or panics the code waiting on it when it rejects. A run that waits on nothing left to wake it, no timer and no promise that can still settle, reports where it waits and fails.
