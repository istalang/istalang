---
description: worked program: a purchase approval with reviews, reminders and verdicts; read for a whole program using the spec together
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-19
last_updated: 2026-11-19
tags: [language, spec]
---

# 20.1 Purchase approval

One program covers a full approval flow. A purchase is reviewed in parallel by two or three roles, with a 5-day deadline, daily reminders and customer cancellation, and then charged.

**Declarations:**

```python
import * as time from 'time'
import Inbox, Revertible from 'inbox'
import Encodable, Decodable from 'json'

struct PurchaseRequest:
    id: String
    item: String
    amount: Int

struct ReviewRequest:
    purchaseId: String
    item: String
    amount: Int

struct Verdict:
    role: String
    ok: Bool
    comment: String

struct Notice:
    text: String

struct Cancel:
    reason: String

struct ChargeResult:
    ok: Bool
    receipt: String

# a queue type the host provides, and a message sent into one revertibly, which the host
# retracts when it is disposed, unless it was received
extern sendable struct Queue<T is Sendable>
extern shared struct Sent
extern fn dispose(self: Sent)
extern fn send<T is Encodable>(self: Queue<T>, msg: T)
extern fn _sendRevertible<T is Encodable>(self: Queue<T>, msg: T) -> Sent
extern live async fn receive<T is Decodable>(self: Queue<T>) -> T

ista fn sendRevertible<T is Encodable>(self: Queue<T>, msg: T) -> Revertible<T>:
    Revertible.holding(_sendRevertible(self, msg))

# the next message of a host's queue: the host's receive, live, as a job after the commit (§14),
# the program's own read a test mocks (§18)
ista async fn next<T is Encodable & Decodable>(queue: Queue<T>) -> T:
    await runtime.delegate queue.receive()

extern purchaseRequests: Queue<PurchaseRequest>
extern fn reviewQueue(role: String) -> Queue<ReviewRequest>
extern fn verdicts(purchaseId: String) -> Queue<Verdict>
extern fn notifications(role: String) -> Queue<Notice>
extern fn cancels(purchaseId: String) -> Queue<Cancel>

extern fn chargeCard(purchaseId: String, amount: Int) -> Result<String>
```

**Entry point.** Each purchase is spawned as its own instance, so it finishes on the version it started with:

```python
import * as runtime from 'runtime'
live async fn main(): await runtime.run(runtime.id()) _main()
ista async fn _main():
    while true:
        const req: PurchaseRequest = await next(purchaseRequests)
        spawn purchase(req)
```

**One purchase instance.** This shows a non-blocking `select` before the irreversible step:

```python
ista async fn purchase(req: PurchaseRequest) -> String:
    let roles: Array<String> = ["legal", "finance"]
    if req.amount > 50_000:
        roles.push("cfo")

    # read once, for the whole purchase: its job is withdrawn when `purchase` ends (§16)
    const cancel: Future<Cancel, "ista"> = next(cancels(req.id))
    const outcome: String = await approve(req, roles, cancel)
    if outcome != "approved":
        return outcome

    const cancelled: Bool = select:
        case cancel:
            true
        else:
            false
    if cancelled:
        return "cancelled before payment"

    const result: ChargeResult = charge(req)
    if result.ok:
        "paid: " + result.receipt
    else:
        "payment failed"

fn charge(req: PurchaseRequest) -> ChargeResult:
    match chargeCard(req.id, req.amount):
        case Ok(receipt):
            ChargeResult{ok: true, receipt}
        case Err(error):
            ChargeResult{ok: false, receipt: error.message}
```

`chargeCard` must be idempotent by the purchase's id, which the host is given for it: a crash after the charge and before the instance's last commit runs that segment again, and with it the charge (§14).

**Parallel approval.** Fan-out uses revertible sends into the reviewers' queues, kept with `hold _` so they stay revertible until `approve` returns, although they are sent inside loops. Verdicts come back through the host-provided `verdicts` queue, because the reviewers' side runs in separate instances (§15.1). The join is a `select` loop that reuses the cancel, deadline and reminder futures.

```python
ista async fn approve(req: PurchaseRequest, roles: Array<String>, cancel: Future<Cancel, "ista">) -> String:
    for role in roles:
        hold _ = reviewQueue(role).sendRevertible(
                ReviewRequest{purchaseId: req.id, item: req.item, amount: req.amount})

    const deadline: Future<Unit, "ista"> = time.delay(5d)
    let reminder: Future<Unit, "ista"> = time.delay(1d)
    let answered: Map<String, Verdict> = [:]

    while answered.size() < roles.length():
        await select:
            case cancel as c:
                return "cancelled: " + c.reason
            case deadline:
                return "expired"
            case next(verdicts(req.id)) as v:
                if not v.ok:
                    return "rejected by " + v.role
                answered[v.role] = v
            case reminder:
                for role in roles:
                    if not answered.has(role):
                        hold _ = notifications(role).sendRevertible(
                                Notice{text: "Purchase " + req.id + " awaits your review"})
                reminder = time.delay(1d)
    "approved"
```

When `approve` returns by any path, everything it holds is disposed: unclaimed review requests and unread reminders are retracted, both timers are aborted, and the verdict read still running is withdrawn (§16), as one is each time a reminder wins. Verdicts that arrive after that stay in `verdicts(purchaseId)`; cleaning them up is up to the program.
