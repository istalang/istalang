---
description: select: case evaluation, winner choice, losers' release, future reuse, the non-blocking form; read before changing select
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-19
last_updated: 2026-11-19
tags: [language, spec]
---

# 15.4 select

`await select` waits until one of several awaitables resolves its case (§15.2), then runs that case. It is an expression: its value is the value of the winning case's body.

```ista statements
const got: Verdict? = await select:
    case verdicts.receive() as v:
        v
    case cancels(id).receive() as c:
        return "cancelled: " + c.reason
    case deadline:
        return "expired"
    case reminder:
        none
```

The rules:

- **Cases are expressions.** Each case expression is an awaitable (§19.1): a receive, an async call, a `delay`, a future variable, or a value of any type with an `onAwait`. `as name` binds what it resolves its case with inside that case.
- **Sequential evaluation.** Case expressions are evaluated top to bottom. If one contains an `await`, evaluation suspends there and the later cases are evaluated after it resumes. Selection happens only after all cases are evaluated.
- **The first to resolve wins.** The case whose future resolves first wins, as the `select`'s resolver decides (§15.2). If several have resolved before the `select` waits, the first case in order wins; if several resolve together, the first the event resolves wins (§15.2), whatever its case's place. Ties go to the order of events, never to fairness: a case whose future keeps arriving first keeps winning. An awaitable deciding its case through a `Resolver.of` callback decides only once the callback runs (§15.2), so it may lose to a case whose value arrived after its own.
- **Each case holds what its expression creates.** Futures, slots and revertible holders created while evaluating a case expression are held by that case.
- **Losers are released.** Once the winner is determined, before anything else runs, every other case's wait is cancelled: a pending take is dropped without consuming, so a value reaching a losing take's slot right after the winner's stays there. Every other case's holdings are released when the waiting call resumes, before its winning case runs, and, if nothing else holds them, disposed: async calls are aborted and revertible sends are retracted. A future taken from a variable declared outside the `select` is held by that variable, so it survives and can be used again: a slot operation a losing case awaited is passed over by its slot, consuming nothing, until something awaits it again. Only a decided wait has losers: a `select` that doesn't wait awaits nothing (below). A case on the call's own `disposing()` is kept until the call resumes, since a disposal before then still resumes it there (§16).
- **The winner's holdings move to the block enclosing the `select`,** so they live until it ends.
- **Same type.** Case bodies agree on one type as the branches of `if` and `match` do (§10.1), and that type is the type of the `select`.
- **A case without `as` discards its value,** so a future whose value must be used (§16), such as a `Result`, needs `as` to bind it.

**Future reuse.** A future resolves once and stays resolved. Create a deadline once, outside a loop, and every iteration races against the same deadline:

```ista statements
const deadline: Future<Unit, "ista"> = time.delay(5d)    # created once
while not done:
    await select:
        case work.receive() as w:
            handle(w)
        case deadline:
            break
```

**Non-blocking form.** A `select` without `await` must have an `else:` case. If no future has resolved at evaluation time, `else` runs. It never waits, so it may stand in a function that isn't async too, and it awaits nothing: a case it finds unresolved is left as it was, a slot operation keeping its place in its slot's queue. It replaces a separate "try receive" operation:

```ista statements
const cancelled: Bool = select:
    case cancels(id).receive():
        true
    else:
        false
```
