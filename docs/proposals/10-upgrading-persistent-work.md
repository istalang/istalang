---
description: proposal 10 of docs/proposals, for moving running persistent work to a new build with no migration code — every call of an `ista fn`, every `delegate` and every `spawn` is a node in a tree; finished nodes keep their results, nodes waiting in unchanged functions stay where they wait, nodes waiting in changed functions restart with the same arguments and claim their old calls by function and arguments; unclaimed nodes are kept for review; host effects go only through `delegate`, `ista fn` arguments are data, and lambdas that outlive a commit are named; replaces proposal 9's Versions section and §5's Versioning; read before designing deploys, the node tree, `delegate`, or anything that changes how persistent code reaches the outside world
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-08
last_updated: 2026-11-08
tags: [proposal, runtime, persistence, versions, upgrade]
---

# Proposal: upgrading persistent work

A workflow may wait for days, and a fix may ship meanwhile. Today an instance finishes on the build that started it (§5 *Versioning*, proposal 9's *Versions*), so a fix never reaches it. This proposal moves every running instance to each new build, with no migration code.

**A call is a unit of work.** A release leaves most of a workflow's calls untouched:
- finished calls keep their results;
- calls waiting in unchanged functions stay where they wait;
- calls waiting in changed functions run again from their start, with the same arguments. When they call what they called before, they get the old call back, finished or still waiting, instead of a new one.

It builds on proposals 8 and 9. The human chose the design and the decisions at the end; the other rules close gaps found while reviewing it. Section numbers refer to `docs/spec.md`.

## Example

```python
ista fn openBusiness(app: Application) -> Business:
    const name = await reserveName(app)
    const license = await getLicense(app, name)
    await delegate register(app, name, license)
```

An instance has reserved its name and waits inside `getLicense`. Release 2 adds a step:

```python
ista fn openBusiness(app: Application) -> Business:
    const name = await reserveName(app)              # claims the finished call: its old result
    const taxId = await getTaxId(app)                # nothing to claim: a new call
    const license = await getLicense(app, name)      # claims the waiting call, as it was
    await delegate register(app, name, taxId, license)
```

- `openBusiness` changed, so it restarts.
- `reserveName(app)` was called before: the restart gets its result without calling it again.
- `getTaxId` is new, and runs.
- `getLicense` didn't change. Its call waits, frozen, until the restart calls it with the same arguments and takes it over, with whatever progress it made: a license already issued stays issued.
- Had release 2 dropped `getLicense`, its call would be kept unclaimed, for an operator to review.

## Rules

### 1. Nodes

- **A node** is a call persistent code makes and can wait on: a call of an `ista fn`, a `delegate` or a `spawn`. Its parent is its caller, so a context's nodes form a forest, one tree per invocation (proposal 9).
- **A node's id** is fixed when it is created, and kept through crashes, restarts and upgrades. A `delegate`'s job runs under it (proposal 9's stable key), so a job can pass it to an outside API as its idempotency key.
- **A running `ista` node has a frame.** A running `delegate` is a job in flight. A `spawn` is an instance of its own, which upgrades by itself.
- **A finished node keeps its record** while its parent runs: function, arguments, result, start and finish times. Once the parent finishes, the parent's record is enough. A running node keeps its start time, its seed and the messages it received.

### 2. What changed

- **A function's version** is a hash of its lowered code, its frame's types and the signatures of what it calls. A function changed when its version differs between the builds, or it is gone.
- **Functions are found by name** in both builds. A rename is a removal and an addition.
- **An unchanged function's frame is valid as it is** in the new build. Nothing in a frame is ever mapped or migrated: positions, temporaries, cursors and holdings stay, or the frame is dropped whole.
- **A lambda that outlives a commit is named** (§3.14 *Named lambdas*): an `ista` lambda, and any function value live across a committing `await`. A positional name would change with every edit above it. Every other lambda, such as one passed to `map` before an `await`, may stay anonymous.

### 3. Upgrading a context

A context, or an instance before proposal 9, upgrades when the new build first loads it, in one commit.

1. **Settle** each root, recursively:
   - **unchanged:** the node stays where it waits, and its running children settle;
   - **changed:** the node **restarts**: its frame is dropped and its function runs again from its entry, with the same arguments. Its caller stays where it waits, on the same future;
   - **under a restarting node,** at any depth, a node, running or finished, becomes a **candidate**: frozen, with no timer firing and no mailbox read, until a call claims it.
2. **Replay.** Restarted nodes run. Each call they make claims a candidate (rule 4), or is a new node.
3. **Commit** once every execution waits on something new. What the replay started, such as a new job, starts at this commit (proposal 8, Rule 6).

**A claimed node joins its claimer.** A finished one gives its result at once. A running one sends its result to the claimer, and settles as in step 1.

### 4. Claiming

- **A call claims the first unclaimed candidate with the same function and equal arguments.** It searches the old children of the node making the call first, then the rest of the context's tree, depth first.
- **So the k-th call of `f(x)` claims the k-th old `f(x)`** of the same parent, and a call moved elsewhere in the code still finds its node.
- **Arguments are equal by value** (rule 8).
- **A finished candidate whose result doesn't decode** into the new result type (rule 9) can't be claimed.

### 5. Mailboxes during a restart

- **Messages a restarted node received go back** to the front of their mailbox, in their order and with their receipt times, so the replay receives them again.
- **Sends are keyed** by node and occurrence. A restart sending what it sent before sends nothing, so a node that already received it doesn't get it twice.

### 6. Time and randomness

- **A restart keeps its old times while it follows its old path.**
  - Its first segment starts at the node's original start time.
  - Each later segment starts when its awaited value originally arrived: a claimed node's finish time, a returned message's receipt time, or a timer's deadline.
  - Its timers keep their old deadlines, and a `select` takes whichever came first.
- **Once it waits on something new,** such as a new node, a message it never received or a timer due after now, its time is real again. Time never goes back.
- **`now()` stays its segment's start time** (proposal 8, Rule 6).
- **A restart keeps its node's seed,** so `random` draws the same values in the same order.
- **Readonly calls run again, live,** and may return today's values. A restart may then take another path, and leave more unclaimed.

### 7. Unclaimed nodes

- **A candidate stays claimable while the restart above it runs.** After that, it is kept frozen, with its arguments, state and finished children, for an operator to review (§9). Nothing it did is undone.
- **A root that can't restart is frozen** with its tree, for review: its function is gone, or its parameters no longer take its arguments. Only a root can be stuck this way: a call's arguments are the caller's code, so the caller changed too, and restarts.

### 8. Persistent code and the outside world

- **Host effects from persistent code go only through `delegate`.** A call from an `ista fn` that reaches a non-readonly extern, directly or through what it calls, is a compile error. `await delegate charge(o)` runs it as a job, whose result persists.
  - Readonly externs are called directly.
  - The runtime's own operations aren't host effects: mailboxes, slots, timers and logs, `delegate` and `spawn`.
  - **Why:** a restart runs a node's segments again. Every host effect they made is a finished `delegate` node, which the restart claims, so no effect happens twice.
- **`ista fn` parameters are data:** no slot, inbox, handle, cell or future, and no function value holding one. An `ista` lambda's captures follow the same rule.
  - Nodes in a context share by mailbox name (proposal 9), so a claim compares arguments by value.
  - A restarted node shares no memory with a node that stays.

### 9. Decoding

- **Arguments, finished results and messages** decode into the new build's types through their JSON codecs, missing fields taking their defaults.
- **A message that doesn't decode** is kept aside, for review.
- **An argument or result that doesn't decode:** rules 4 and 7.

### 10. Checking a release

- **`ista upgrade check <store>`** runs every context's upgrade against the store without committing. It reports per context:
  - nodes kept, restarted, claimed, new and unclaimed;
  - frozen roots and undecodable messages.
- **Small functions restart little.** A change restarts only the calls waiting in the functions it touches, so workflows should be split into small functions.

## Why

- **Frames are data.** A release leaves most of a workflow untouched, and only the calls waiting in what it changed run again. Temporal replays a workflow's whole history and wants a `patched()` branch around every change. Golem replays its operation log. Here a finished call is never run again, and no code carries version branches.
- **A call is the unit everyone already writes.** Functions, arguments and results are what a developer reads in their code. A frame's positions, temporaries and holdings are not, so nothing asks for them.
- **Progress made stays made.** A finished call, or one past a change in a branch that didn't change, may not be repeatable: a license issued, a card charged. Claiming keeps it.

**Considered and dropped.**
- **Old builds side by side** (proposal 9's *Versions*, Temporal's worker versioning, Restate): a fix never reaches running work, so long workflows run old bugs for months.
- **Migration code over frames:** naming every temporary, cursor, holding and caller position for a script is unworkable.
- **Naming awaits** (`await(name) f()`) to map positions between builds: this design never maps a position.
- **Replaying the whole history:** every input logged, and every change risks a mismatch.
- **Rewinding the whole instance** to an earlier commit: throws away progress on branches that didn't change.
- **Semver levels in `ista.json`:** what changed is derived per function, and `ista upgrade check` shows its effect on real instances.

## What changes in behaviour

| Change in a release | Today | Proposed |
| --- | --- | --- |
| any change, with instances running | they finish on their old build | they move to the new build when it loads them |
| a function nothing waits in | old instances keep the old one | the next call runs the new one |
| a function a call waits in | (no upgrade) | the call restarts with the same arguments; its caller keeps waiting |
| a new step before a waiting call (the example) | (no upgrade) | the step runs; the waiting call is claimed when reached |
| a step removed, its call waiting | (no upgrade) | the call is kept unclaimed, for review |
| a call's arguments changed | (no upgrade) | the old call isn't claimed; a new one runs |
| a deadline cut from 5 to 3 days, waited on since day 4 | (no upgrade) | the restart times the timer from the old start: due on day 3, before anything else, so the timeout path runs |
| the same, but the approval came on day 2 and the card was charged | (no upgrade) | the restart claims the charge; nothing runs twice |
| a root's parameters no longer take its arguments | (no upgrade) | the root is frozen with its tree, for review |
| `await charge(o)` in an `ista fn`, `charge` not readonly | legal after the segment's last in-memory `await` (proposal 8) | error: `await delegate charge(o)` |
| `ista fn sync(box: Inbox<Msg>)` | legal | error: a parameter must be data; share by mailbox name |
| an anonymous `ista` lambda | legal | error: name it |

## What changes in power

**Gained.**
- Fixes reach running work, with no migration code and no version branches.
- A job's idempotency key, stable across crashes, restarts and upgrades.

**Lost.**
- Running two builds at once.
- Host effects called directly from persistent code.
- Slots, inboxes and handles passed to an `ista fn`: sharing is by mailbox name.
- Anonymous lambdas that outlive a commit.

## Spec and proposal changes

- **Guide, principle 8:** "Deploys freeze code" becomes "Deploys upgrade running work".
- **§3.3, §3.14:** `ista fn` parameters and `ista` lambda captures are data. A lambda that outlives a commit is named.
- **§3.6:** a non-readonly extern is reached from persistent code only through `delegate`.
- **§3.8:** `runtime.version()` is the running build's hash, no longer fixed for an instance's life.
- **§5:** *Versioning* is rewritten as this proposal's rules. Re-run state gains the restart's clock and the node's seed.
- **§9:** the operator's view gains unclaimed nodes, frozen roots and undecodable messages.
- **Proposal 8, Rule 8 and decision 9:** a non-readonly extern no longer runs in a persistent segment: `delegate` runs it.
- **Proposal 9:** *Versions* is replaced by this proposal. *Effects* runs an app's effects through `delegate`. *Left for later* loses "Moving frames between builds".

## Implementation notes

1. **Definition** (`src/definition/`, `docs/arch/definition.md`): a version per function, hashed from its code, register types and the signatures it refers to. Named lambdas give their entries stable names.
2. **Checker:**
   - parameters and captures of `ista` functions are data;
   - host effects reach persistent code only through `delegate`, from proposal 8's function summaries, with the runtime's externs marked as not host effects;
   - a function value live at a committing `await` is named, beside check 1.
3. **Snapshot** (`src/runtime/snapshot/`): nodes with id, parent, function, arguments, status, result, times, seed and received messages, beside today's executions and their `resolves` futures.
4. **Runtime** (`src/runtime/scheduler/`): upgrade on load (settle, replay, claim, commit), the restart's clock, returned messages and keyed sends.
5. **Codecs:** decoding fills missing fields from their defaults.
6. **Tools:** `ista upgrade check`, and the host's view of unclaimed nodes and frozen roots.
7. **Tests** (fast-check):
   - upgrading to the same build changes nothing;
   - with no node waiting in a changed function, every frame stays as it was;
   - a restart whose function changed only after its last call claims every old node;
   - no job runs twice under one key, across crashes and upgrades;
   - an upgrade is deterministic given the store and the build, readonly results held fixed.

## Left for later

- **Long-lived nodes,** such as a loop serving a mailbox, whose finished children and received messages keep growing: handing over to a fresh call.
- **Messages received by nodes left unclaimed.**
- **A restarted node's holdings:** released, running their `dispose`, or handed to the restart.
- **Passing slots or handles to an `ista fn`,** by giving objects an identity from their creating node and occurrence.
- **What an operator can do with an unclaimed node:** resume it, attach it elsewhere, or discard it.
- **How a test states two builds** (`'testing'`).

## Decisions (the human's)

1. **One live build.** Every running instance moves to each new build. No old build runs beside it.
2. **A function call is the unit of upgrade.** A finished call's result is reused, even when its function changed.
3. **A call waiting in an unchanged function stays where it waits.**
4. **A call waiting in a changed function restarts** from its entry with the same arguments. Its caller stays where it waits.
5. **A restart's calls claim the old ones:** the first unused with the same function and arguments, among the old parent's children first, then the rest of the tree.
6. **Unclaimed calls are kept,** with everything they did, for an operator to review.
7. **Host effects from persistent code go only through `delegate`,** whose results persist. Readonly externs are called directly.
8. **Lambdas may be anonymous,** except where they outlive a commit.
9. **A restart keeps its old times** while it follows its old path, and real time once it waits on something new.
10. **Workflows should be split into small functions,** so a change restarts little.
