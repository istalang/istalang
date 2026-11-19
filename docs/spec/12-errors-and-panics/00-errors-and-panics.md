---
description: Result, ? propagation, Error traces, bugs versus expected failures, panic; read before changing error handling or panics
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-19
last_updated: 2026-11-19
tags: [language, spec]
---

# 12. Errors and panics

There is no `try`/`catch`. A function that can fail returns a `Result`, from the prelude:

```python fragment
enum Result<T, E = Error>:
    Ok(value: T)
    Err(error: E)

struct Error:
    message: String
    code: String
    trace: String = _trace()   # the frames where the Error is built
```

```python statements
ista async fn pay(req: PurchaseRequest) -> Result<String>:
    const receipt = chargeCard(req.id, req.amount)?    # returns early on Err
    Ok(receipt)

match await pay(req):
    case Ok(receipt):
        ...
    case Err(error):
        ...
```

- **`?` propagates.** `expr?` on a `Result` yields the `Ok` value, or returns the `Err` from the enclosing function. That function must itself return a `Result` whose error type the error converts into (§4.2): in a function returning `Result<T, NotFound | Timeout>`, `?` takes a `Result<U, NotFound>`. With an inferred return type, each `?` acts as a `return` of an `Err`: what the function's other returns and its last expression agree on must be a `Result` whose error type that error converts into. A `?` outside any function, such as in a parameter's default, is an error. `?` doesn't take an optional apart; `??` and `match` do (§10.4).
- **Traces.** An `Error` literal may leave out `trace`, whose default (§5.2) is the frames where the `Error` is built, innermost first, one line each: `at function (module:line:column)`. A `trace` written in the literal, or carried over by a spread as in `Error{...error, message: "retry failed"}`, is kept.
- **Results must be used** (§16). A `Result` is also handled with `match` or `?`.
- **Results are data.** A `Result` of sendable types is sendable, so a service can reply with one into a `replyTo` inbox.
- **Bugs panic; expected failures return `Result`.** Network, parsing and business failures return `Result`. Programming errors such as an out-of-range index, integer division by zero (`//` or `%`) or a missing map key panic. The safe variants return optionals: `xs.at(i)` returns `T?`, and `m.get(k)` returns `V?`.

**Panic.** `panic(message: String) -> Never` stops the instance at once:

- **Nothing is committed.** The current segment is discarded, so the instance stays at its last snapshot. Effects of `extern fn` calls already made in that segment remain (§14).
- **The instance is frozen,** marked as panicked. Nothing it holds is disposed and no deferred function runs: its revertible messages stay in their inboxes, and the instances it spawned keep running.
- **The panic is recorded** with its message and the trace of the frames it happened in, in the format of `Error`'s `trace`. `ista run` prints both and exits with a non-zero code.
- **An operator decides what happens next.** Through the host, an operator can inspect the instance, retry it from its last snapshot, or terminate it. Terminating disposes everything it holds (§16), and the terminated instance keeps the panic's message and trace. An instance `runtime.isolate` started needs no operator: its panic terminates it at once (§17.1).
- **A result from the host that doesn't match its declared type** panics the instance at the `extern fn` call, since it's a bug in the host (§17.4).
