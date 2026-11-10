---
description: proposal 10 of docs/proposals, for moving running persistent work to new releases — a build holds every release and each frame runs its own release's code; frames move to a newer release at named `checkpoint`s and at a boundary `ista async fn`'s entry, their state moved by name and checked at compile time; `inline ista async fn`, a plain `ista fn` and an unmarked `async fn` run at their caller's release; `x is unassigned` for state an older release lacks, decided per compiled entry; migration files, diffs kept like SQL migrations from any release to a later one, that add checkpoints to old code, fill state, `restart` or `keep` a function; a committing `await` stands at statement level; replaces proposal 9's Versions and §5's Versioning; read before designing releases, deploys, frames, checkpoints, migration files or their tooling
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-10
last_updated: 2026-11-10
tags: [proposal, runtime, persistence, versions, upgrade, migration]
---

# Proposal: upgrading persistent work

A workflow may wait for weeks, and a fix may ship meanwhile. Today an instance finishes on the build that started it (§5 *Versioning*, proposal 9's *Versions*), so a fix never reaches it. This proposal lets running work move to a new release at points the code names, checked by the compiler, with migration code only where a developer wants control.

**The model is Erlang's hot code loading, made static.**
- A build holds every release, and each frame runs the code of its own release.
- A frame moves to a newer release only at a **checkpoint**: a `checkpoint name` statement, or the entry of a boundary function. Its state moves by name.
- For every older release, the compiler checks that each checkpoint's state fits the newer code. A mismatch is a compile error.
- A **migration file** adds checkpoints to code that had none, fills in state, or decides a function's fate: `restart` or `keep`.

It builds on proposals 8 and 9. The human chose the design and the decisions at the end; the other rules close gaps found while reviewing it. Section numbers refer to `docs/spec.md`.

## Example

Release `r1`:

```python
ista async fn openBusiness(app: Application) -> Business:
    const name = await reserveName(app)
    const license = await getLicense(app, name)
    await register(app, name, license)
```

Release `r2` adds a tax id. Instances of `r1` wait inside `getLicense`, which can take weeks, and must get a tax id without applying for a license again. `migrations/r1..r2.ista-migration`:

```python
  ista async fn openBusiness(app: Application) -> Business:
      const name = await reserveName(app)
+     const taxId = await getTaxId(app)
      const license = await getLicense(app, name)
>     checkpoint licensed
+     checkpoint licensed
+     if taxId is unassigned:
+         taxId = await getTaxId(app)
-     await register(app, name, license)
+     await register(app, name, taxId, license)
```

- The `>` line adds `checkpoint licensed` to `r1`'s code, after its `getLicense` await.
- An `r1` frame keeps waiting on its pending license. Once it arrives, the frame reaches the added checkpoint and moves to `r2`'s `licensed`, carrying `app`, `name` and `license`.
- `r1`'s state has no `taxId`, so in this entry `taxId is unassigned` is true, and the guard fetches it. At `r2`'s own entry it is false, and the branch is neither compiled nor run.
- Had `r1` written `checkpoint licensed` itself, no migration file would be needed.
- Without the file, `r1` frames would finish on `r1`'s code, with no tax id.

## Rules

### 1. Releases

- **`ista release <name>` records the program as a release:** its definition and its frame schema, under `releases/<name>/`, committed with the code.
- **A build holds every release not retired.** The program being built is the newest.
- **A frame records its release.** New work runs on the newest: an invocation a context starts (proposal 9), a spawn, a call to a boundary function (rule 2).
- **A function is the same across releases** when its key is: its module and name, with its parameter types only for an overloaded name. A type is the same when its key and definition are.
- **A function's version** is a hash of:
  - its body, and the bodies of the inline code it reaches, transitively (rule 2);
  - the types live at its suspension points and checkpoints;
  - its signature, and the signatures of the boundary functions it calls.

  Two releases share a function whose version is equal, and nothing about it is checked or moved.
- **`ista release retire <store>`** drops releases that no frame in the store runs on, from the build and from the checks.

### 2. Boundaries and inline code

- **A boundary is an `ista async fn` not declared `inline`.** Everything else is inline: a plain function, `ista fn` included, an unmarked `async fn` at either kind, an `inline ista async fn`, a lambda, a local function.
- **A call to a boundary function runs at the caller's target release** (rule 7): the newest, unless a migration file says otherwise.
- **Inline code runs at its caller's release.** A lambda runs at the release of the frame that made it. A boundary function named as a value runs at the target release when called.
- **An `inline ista async fn` has no checkpoints**, and its entry isn't one. Its frames run their release's code until they return.
- **Disposal is inline.** A `dispose` or a `defer` runs at the release of the frame that releases its value.

### 3. Checkpoints

- **`checkpoint name`** is a statement in a boundary function, with the name unique in the function. It neither waits nor commits.
- **A checkpoint's state** consists of:
  - the named variables live there;
  - the iterators of its enclosing loops, named by their loop variables;
  - the holdings of its enclosing blocks.
- **A function's entry is a checkpoint** whose state is its parameters.
- **A frame reaching a checkpoint moves to its target release's checkpoint of the same name,** if its release isn't already the target. Its state moves by name (rule 5), in memory and inside the same segment, and the frame then runs the target's code.
  - A crash before the next commit runs the segment again on the older release, which moves again at the same checkpoint.
- **A frame meeting no checkpoint runs its release's code to its end.**
- **A moved frame still owes its old caller a result.** That caller expects the old release's result type, so the result converts back (rule 5).
- **A checkpoint isn't a waypoint.** `@Waypoint` (§10) names a suspension point for tests and operators. A checkpoint is where code may change.

### 4. A committing `await` stands at statement level

- **In an `ista async fn` or an unmarked `async fn`, whose `await`s commit in ista code, an `await` is a whole statement or a whole right side:** `await e`, `const x = await e`, `let x = await e`, `x = await e` or `return await e`.
  - `f(await a(), await b())` or `if (await x).ok:` is a compile error there. A `live async fn`'s `await`s are free.
- **A frame is therefore:**
  - its release, its function, and the entry it came through (rule 6);
  - its suspension point;
  - its named values, the pending future, its loop iterators and its holdings.
- **Frames are persisted by meaning, never by compiler layout,** so a later compiler reads an older release's frames.

### 5. Moving state, and the check

- **A value of an unchanged type moves as it is.**
- **A value of a changed data type converts through codecs:** the older type's `toJson`, then the newer type's `fromJson`. A newer type's declared `fromJson` may accept older shapes.
- **A handle moves only when its type is unchanged:** a slot, an inbox, a shared struct, a future or a resolver. Other frames may hold the same handle at another release.
- **A result converts the other way:** the newer `toJson`, then the older `fromJson`.
- **The check.** For every release R in the build other than the newest, take R's target S. For every boundary function whose version differs between R and S, and for every checkpoint of R's function, its entry included:
  - S's function is compiled from that checkpoint, with R's state after the migration's block, if any;
  - every name S's code needs that the state doesn't give starts unassigned (rule 6);
  - the result must pass definite assignment and type checking;
  - S's result must convert into R's.
- **A failure is a compile error.** It names the release, the function and the checkpoint. A checkpoint or a function that S lacks fails too. A migration file resolves each failure (rule 8).
- **A conversion that fails at runtime,** a value that doesn't decode, stops the move. The frame runs on in its release, and `ista upgrade check` reports it.

### 6. `is unassigned`

- **`x is unassigned`** tests a local of the function. It is decided per compiled entry, like §4's conditions decided by types:
  - it is false at the function's own entry, and wherever `x` is definitely assigned;
  - it is true where an older release's state lacks `x` and nothing has assigned it yet.
- **The branch it rules out is neither checked nor run,** so the test costs nothing at runtime. A name assigned on only some paths there is a compile error, because the test must be decided.
- **Inside the branch, `x = …` assigns `x` once,** a `const` included.
- **A boundary function is compiled once per entry:** its own, and each older release's checkpoint that reaches it. A frame records which entry it came through.
- **A guard that no entry in the build decides true is warned about.** It is dead once the releases that needed it have retired.

### 7. Migration files

- **`migrations/<from>..<to>.ista-migration`** moves frames on release `from` to release `to`, any later release. Files are committed and kept, like SQL migrations. Some releases never get one.
- **A frame's target:**
  - a frame on R targets the `to` of R's migration file with the newest `to`;
  - with no file from R, it targets the newest release, through an implicit empty file;
  - a frame moved to S then targets S's own target at its next checkpoint.
- **A file is the diff of the two releases,** for the functions that differ. The first column gives each line's kind:

  | Prefix | Kind | Meaning |
  | --- | --- | --- |
  | `-` | old | only in `from` |
  | `+` | new | only in `to` |
  | (space) | context | in both |
  | `>` | migration | rule 8 |

  The `-` and context lines must equal `from`'s source exactly, and the `+` and context lines `to`'s, so the file checks itself against both.
- **`ista migration new <from> <to>`** generates the file, with a `> ???` hole wherever the check fails. A hole fails to compile until it is filled.

### 8. What `>` lines say

- **Above a function's header,** a directive applies to `from`'s frames of that function:
  - **`> restart`** acts when the build first loads the instance, in one commit.
    - Each such frame is disposed: everything it holds is released as §7 releases it, so pending calls stop, `defer`s run and revertible messages retract.
    - Then `to`'s function is called again with the same arguments, through its entry, on the future its caller waits on.
    - The new run is a new run: real `now()` and fresh draws. What the function did before its `await` runs again. As after a crash, idempotency is the program's.
  - **`> keep`:** the frames never move, and `from`'s calls of the function run `from`'s function. Its checkpoints pass without moving.
- **Right after the header,** an entry block runs for calls from `from`'s code into `to`'s function.
  - `from`'s parameters are in scope, and the block gives `to`'s.
  - A parameter that `to` added with a default needs nothing.
  - A block for a function that `to` lacks must `return`: `> return await openCompany(app)` redirects a renamed one.
- **`> checkpoint X`** adds checkpoint `X` to `from`'s code at that point: after the last `-` or context line above it, usually right after an `await`.
- **Lines right after a checkpoint of `from`,** written or added, form a block. It runs when a frame moves there, before `to`'s code goes on from its own `X`.
- **In a block:**
  - `from`'s names are in scope with `from`'s types. A type that changed is written `from.T`.
  - A block may rebind a name: `const deadline = convert(deadline)`, the right side reading `from`'s.
  - A block may `await`. A frame waiting in a block is a frame of `to`'s function, entered through that block, and is persisted and upgraded like any other.
  - `goto Y` goes on at `to`'s checkpoint `Y` instead. `return v` completes the function with `to`'s result type.
  - What `to`'s code needs and the block doesn't give is unassigned there (rule 6).
- **`>` lines outside any function** declare helpers for the file's blocks, such as `fn convert(o: from.Order) -> Order`.

```python
> restart
- ista async fn review(req: Request) -> Verdict:
+ ista async fn review(req: Request, level: Int = 1) -> Verdict:
```

### 9. Tools and tests

- **`ista upgrade check <store>`** runs the build against a store without committing. For each release, function and suspension point, it reports:
  - frames, and the checkpoint where each will move;
  - restarts and keeps;
  - conversions that fail.
- **`testing.spawnOn(release, f)`** spawns `f` as if `release` were the newest, and **`inst.upgrade()`** moves the instance to the build's newest release, as a deploy does:
  - restarts happen at once;
  - later checkpoints and boundary calls go to the newest release.

  With `reaches` (§10), a test drives an instance to a point, upgrades it and asserts on how it ends.
- **A committing `await` in a loop body with no checkpoint in that loop is warned about:** "frames in this loop run their release's code until it ends."

## Why

- **Erlang's model, checked.**
  - In Erlang, a module has a current and an old version, and a process switches to the current one at its next fully qualified call. A checkpoint is that call written inside a function, `rest(liveState)`.
  - Boundary functions are Erlang's external calls, and inline code its local calls.
  - Unlike Erlang:
    - any number of releases run side by side;
    - frames persist;
    - every move is type-checked before a deploy;
    - a migration may add points that the old code never had.
- **Predictable in large programs.**
  - Code changes only at checkpoints and boundary entries, both visible in the source.
  - Nothing runs twice, except under an explicit `restart`.
  - States are matched by name, never by aligning two texts.
- **Static.** Every frame's state is (release, function, entry, point), a finite set known at compile time. So every check is a compile error, and running instances never need to be read to find one.
- **Control where it's wanted.** A migration file gives the full power of code at the exact point. Most releases need none.

**Considered and dropped.**
- **Old builds beside the new one, and nothing moves** (proposal 9's *Versions*, Temporal's worker versioning): a fix never reaches running work. Here `keep` is one choice among others.
- **One live build** (an earlier draft of this proposal):
  - Changed functions restart, and their calls claim old calls by function and arguments.
  - Rejected: what restarts and what is claimed is hard to predict in a large program, and whether a claim happens depends on runtime values.
- **A migration at every changed `await`** (the diff-migration draft):
  - Every release needs written code, and positions inside frames become an API.
  - Its file format stays, for where it's wanted.
- **Rewinding to an earlier point,** chosen by the compiler: everything between that point and the frame's position must be repeatable or reclaimable.
- **Replaying the whole history** (Temporal): every input is logged, and every change risks a mismatch.
- **`@name` for the old frame's values:** rebinding reads as ordinary code.

## What changes in behaviour

| Change | Today | Proposed |
| --- | --- | --- |
| any release, with instances running | they finish on their build | frames run their release, and move at checkpoints and boundary entries |
| a boundary function's body | old instances keep the old one | the next call, from any release, runs the target's |
| a plain function's body | old instances keep the old one | older frames call their own release's until they move |
| a value added before a checkpoint | (no upgrade) | a guard or a block gives it, or a compile error |
| a parameter added with a default | (no upgrade) | older call sites get the default |
| a parameter added without one | (no upgrade) | a compile error until an entry block gives it, or `keep` |
| a checkpoint removed | (no upgrade) | a compile error until a block `goto`s another, or `keep` |
| a step inserted before a long wait (the example) | (no upgrade) | the frame waits as it was, moves at the added checkpoint, and the guard runs the step |
| `> restart` on a function | (no upgrade) | its frames are disposed and called again with the same arguments |
| an `Inbox<T>` live at a checkpoint, `T` changed | (no upgrade) | a compile error: a handle moves only unchanged |
| `f(await a(), await b())` in an `ista async fn` | legal | error: a committing `await` stands alone |
| `runtime.version()` | the program's hash, fixed for the instance | the calling frame's release |

## What changes in power

**Gained.**
- Fixes reach running work at points the code names.
- Old and new releases run side by side, in one build.
- Every upgrade is checked at compile time.
- An upgrade can be partial: per function, per checkpoint, per release.
- Migration code can wait, and continues as ordinary code.

**Lost.**
- An instance no longer runs one program from start to end.
- A committing `await` inside a larger expression.
- Moving a handle whose type changed.
- Small builds: a build carries every release until it retires.

## Spec and proposal changes

- **Guide, principle 8:** "Deploys freeze code" becomes "Deploys move running work at checkpoints".
- **§2:** grammar words:
  - `checkpoint`, at a statement's start;
  - `inline`, in an `ista async fn`'s head;
  - `unassigned`, as the whole pattern of `is`.
- **§3.3:** boundary and inline `ista async fn`s. An `inline ista async fn` takes no checkpoint.
- **§3.8:** `runtime.version()` gives the calling frame's release.
- **§3.14:** a function value runs at the release that made it, or, naming a boundary function, at the target. This replaces "keeps it from crossing versions".
- **§4:** the `checkpoint` statement. `x is unassigned` among the conditions decided by types, and a `const` assigned once in its branch.
- **§5:**
  - *Versioning* is rewritten as this proposal's rules.
  - A committing `await` stands at statement level.
  - Frames are persisted by meaning.
- **§9:**
  - Work a context starts runs on the newest release.
  - The operator's view shows each frame's release.
  - `ista release`, `ista upgrade check` and `ista migration new`.
- **§10:** `testing.spawnOn` and `upgrade`, and the loop warning.
- **Proposal 8:** the statement-level rule for a committing `await`. In Rule 4's modifier order, `inline` stands before `live` or `ista`, which stand before `async`: `inline ista async fn`.
- **Proposal 9:** *Versions* is replaced by this proposal, and *Left for later* loses "Moving frames between builds".

## Implementation notes

1. **Syntax** (`compiler/syntax/`, `compiler/parser/grammar/`):
   - a `checkpoint` statement, the `inline` modifier and the `unassigned` pattern;
   - `test/vscode-grammar.test.ts` holds the VS Code grammar to them.
2. **Checker:**
   - a committing `await` at statement level;
   - checkpoint names unique, and none in inline functions;
   - **definite assignment**, a new flow pass placed per `docs/arch/architecture.md`. It serves `is unassigned`, the once-only assignment in its branch, and the cross-release check;
   - each boundary function checked once per entry.
3. **Definition** (`src/definition/`, `docs/arch/definition.md`): a release record holding:
   - function keys and versions;
   - the frame schema: suspension points and checkpoints, each with its named state and types, loop iterators and holdings.
4. **Releases:** a new feature folder. It:
   - loads every unretired release into a build;
   - resolves calls, boundary to the target and inline to the caller's release;
   - runs the check of rule 5.
5. **Migration files:** a new feature folder. It:
   - scans lines by their first column and checks the two projections against the sources;
   - turns blocks, added checkpoints and directives into entries checked by the normal checker;
   - generates files with holes.
6. **Snapshot** (`src/runtime/snapshot/`): frames by meaning, each with its release, entry and point.
7. **Runtime** (`src/runtime/scheduler/`):
   - moving at checkpoints, with conversions through codecs, and a failed conversion leaving the frame where it is;
   - restarts at load.
8. **Tools:**
   - `ista release`, `ista release retire`, `ista migration new` and `ista upgrade check`;
   - the VS Code grammar for migration files, colouring the four kinds of line;
   - the operator's view of releases per frame.
9. **Tests** (fast-check):
   - a release whose code is unchanged moves no frame, and changes no behaviour;
   - moving through a checkpoint whose state and code after it are unchanged equals not moving;
   - a migration file's two projections equal the two sources;
   - `is unassigned` is decided per entry, and its ruled-out branch never runs;
   - a generated hole fails, and a filled one passes;
   - a crash at every commit around a move ends as an uncrashed run does;
   - every refusal in the behaviour table.

## Left for later

- **Converting a handle whose type changed.**
- **Packages:** a library shipping migration files for its own functions (§11).
- **Upgrading at every commit,** as `spawnCrashingEveryAwait` crashes at every one: a sweep that moves a test's instance at each point in turn.
- **What the generator suggests beyond holes,** such as a checkpoint after each `await` whose state already fits.
- **Several processes on one store** running different builds.
- **Operator actions on single frames:** restart one, or keep one.

## Decisions (the human's)

1. **A build holds every release, and each frame runs its own release's code.** New work starts on the newest.
2. **Migration files are kept like SQL migrations,** each from one release to any later one. A later file may move an older release directly. Some releases never get one, and their frames finish on their own code.
3. **A frame moves only at a checkpoint:** a `checkpoint name` statement, separate from `await`, or a boundary function's entry.
4. **A changed function with no checkpoint ahead runs to its end,** unless a migration file says `restart` or adds a checkpoint.
5. **A restart always disposes the old frame,** then calls the function again from its start.
6. **A migration file adds checkpoints after old `await`s and fills their state with `>` lines.** Migration code may `await`, and a frame continues in the newer code.
7. **`x is unassigned`** handles state an older release lacks, in the newer code. Tools find the guards that no release still needs.
8. **Only an `ista async fn` not declared `inline` is a boundary;** a plain `ista fn` and an unmarked `async fn`, at either kind, are inline. A boundary call runs the newest release, and inline code the caller's.
9. **A checkpoint that fails the check is a compile error.**
10. **The compiler checks a move by splicing:** the older release's state at the point, then the migration's lines, then the newer release's code from there.
11. **Releases no frame runs on are retired** from the build.
12. **A committing `await` stands at statement level.**
