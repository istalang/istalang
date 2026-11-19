---
description: inboxes, durable and revertible messages, Revertible, death signals; read before changing inboxes
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-19
last_updated: 2026-11-19
tags: [language, spec]
---

# 15.3 Inboxes

**Inboxes.** The standard library's `Inbox<T>` is a FIFO message queue built on slots, the way Haskell builds its channels on `MVar`s, and written in the language. It is a shared struct (§5.4), which the `inbox` module makes disposable by declaring its `dispose` (§16), so an inbox is a handle that a `WeakRef` can watch. It is created with `Inbox.create<T>()`, and `box.pending()` gives the messages waiting in it, oldest first, without receiving them:

```python statements
const box = Inbox.create<Verdict>()
box.send(v)                            # durable
_ = box.sendRevertible(v)              # revertible: held until this block ends
const next: Verdict = await box.receive()
```

- **Order.** Messages come out in commit order: the order in which the senders' segments committed. Sends within one segment keep their program order.
- **Receivers.** Each message goes to exactly one receiver. When several are waiting, the one that has waited longest gets the next message.
- **Capacity.** An inbox is unbounded, so `send` never waits; it returns `Unit`.
- **A receive is a wait on a slot.** `receive()` returns the future of a `take`, not of an async call, so a receive that loses a `select` and is released consumes nothing.
- **Durable messages** live until they are received, or until the inbox is disposed.
- **Revertible messages** last as long as the `Revertible<T>` holder that `sendRevertible` returns: kept in `_`, it lasts until the sending block ends, with `hold _` until the sending function ends, and stored elsewhere, as long as it is held there. When the holder is released while the message is still unread, the message is retracted. The holder doesn't keep the inbox alive.
- **Receiving a revertible message** makes it final, so once received, it can't be retracted. A retracted message is removed, and everything else keeps its order.
- **`Revertible<T>`** is written in the language too: `shared struct Revertible<T> { retract: ista fn() -> Unit }`, made disposable by the `inbox` module's `dispose`, which calls its `retract`. Whatever queue makes a holder supplies its own retraction, so an inbox, a fan-out and a queue the host provides all hand out the same type. A host's revertible send is a disposable host type (§17.2), and `Revertible.holding(sent)` makes a holder whose retraction lets go of it, which disposes it and so tells the host (§20.1).

**Lifetimes.** A slot or inbox is disposed when its last holder releases it, together with the values in it. Every handle holds it; code that shouldn't keep it alive holds a `WeakRef` instead (§16). Queues the host provides live as long as the host keeps them.

**Death signal.** Any code holding an inbox may send to it and receive from it, and every such handle keeps the inbox alive (§16). To notice that the other side of a conversation is gone *without* keeping it alive, hold a `WeakRef` to its inbox and watch `disposed()`:

```python
ista async fn child(parent: WeakRef<Inbox<Status>>, mine: Inbox<Command>):
    while true:
        await select:
            case mine.receive() as cmd:
                parent.deref()?.send(handle(cmd))   # strong only for this statement
            case parent.disposed():
                return                              # the parent's inbox is gone
```

The owner keeps its inbox and gives the child only the weak side, starting it without awaiting: `_ = child(WeakRef(status), commands)`. Once the owner releases `status`, the child's `disposed()` resolves.

- **Order.** The inbox is disposed, its unread messages are deleted, and then every `disposed()` future watching it resolves. A receiver racing `box.receive()` against `disposed()` never gets a message after the signal.
- **Every watcher is notified.** Each call returns its own future, so any number of executions can watch the same inbox.
- **Not only inboxes.** A `WeakRef` to any disposable has `disposed()`: to a future, a slot, a revertible message's holder.
- **Queues the host provides** are kept by the host, so watching one resolves only if the host disposes it.

**Durable queues.** Queues that outlive every instance aren't part of the language: the host provides its own through extern declarations (§17.2).
