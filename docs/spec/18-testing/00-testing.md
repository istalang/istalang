---
description: test modules, suites, setups, mocking, fake time and queues, driving instances, waypoints, the test runner; read before changing testing or ista test
owner: tech-lead
status: active
applies_to: istalang
last_verified: 2026-11-19
last_updated: 2026-11-19
tags: [language, spec]
---

# 18. Testing

Tests are ordinary code. The runtime adds a few primitives, in the `testing` module, and everything else is a library written in the language, in the same module. A test module is a file whose name ends in `.test.ista`. Only a test module may import `testing`, and only a test module may import another test module, so production code can never install a mock; either import elsewhere is a compile error. A test module also sees the private (`_`) declarations of the modules it imports, so a test can mock what a module keeps private, such as a raw extern behind a public wrapper.

**Suites.** `@Suite{"title"}` marks a function that returns the suite's tests as an `Array<Test>`. Tests are values, built by library functions:

```python
@Suite{"purchase approval"}
ista fn approvalSuite() -> Array<Test>: [
    test("expires after 5 days", withPurchaseEnv, async fn(env): {
        const t = spawn purchase(PurchaseRequest{id: "p1", item: "laptop", amount: 900})
        await t.idle()
        env.clock.advance(5d)
        assertEq(await t.result(), Ok("expired"))
    }),
    group("with cancellation", [
        test("retracts review requests", withPurchaseEnv, async fn(env): { … }),
    ]),
    ...[for amount in [10, 50_000, 60_000]:
        test("amount " + amount, withPurchaseEnv, async fn(env): { … })],
]
```

- **Each test runs in a fresh context** (§17.1), named `test`, on a fresh runtime. Function values aren't sendable, so the runner calls the suite function again inside each new context and runs the entry at that test's position.
- **Suite functions only build their list,** which the compiler enforces: a suite function is a plain `fn` (not `async`) that doesn't call externs or touch handles, such as shared structs, slots or inboxes, so it builds the same list every time it is called. It runs in an instance, so it may be `ista fn`, as one is whose tests take an ista setup, such as `withClock`, which instantiates the setup's type there (§9.1). The rule is checked on the suite function's own body, not on the functions it calls or the tests it builds; in each test's instance the runner also checks that the list still holds that test's title at its position, and fails the test when it doesn't.
- **The library** provides `test(title, body)`, `test(title, setup, body)`, `group(title, tests)`, `skip(test)` and `only(test)`. A test's body is a plain or an `async` function, taking the setup's environment when it has one. Table-driven tests are comprehensions, as above.
- **Skipping and focusing.** `skip` and `only` take a test or a group, and mark it, and through a group every test in it. A skipped test is reported but not run, even when `only` marks it too, whichever was applied last and at whatever level. When any test of a run is marked `only`, directly or through its group, only those tests run, and the rest are reported as skipped.

**Environments.** A setup is an "around" function of type `Setup<E> = ista async fn(ista async fn(E) -> Unit) -> Unit`: it prepares an environment, runs the test inside it, and tears it down afterwards. Teardown is ordinary code, so it may `await`, and holdings such as mocks are released when the function ends, even if the test fails:

```python
ista async fn withPurchaseEnv(test: ista async fn(PurchaseEnv)):
    const clock = FakeClock{start: Time{value: 0}}
    hold _ = mock(time.now, clock.now)
    hold _ = mock(time.at, clock.at)
    await test(PurchaseEnv{clock})
```

`setups(a, b)` combines several environments into one, with overloads for up to six: `setups(withPurchaseEnv, withFakeHost)` is a `Setup<(PurchaseEnv, HostEnv)>`, whose test receives both as a tuple. The first setup is the outermost: it prepares first and tears down last.

**Mocking.** `mock(target, replacement)` replaces any named function (an extern, a standard-library function or one of the program's own) while the `Mock<F>` it returns is held, `F` being the function's type, so a mock follows block lifetimes like every other resource. `mock` takes a pack (§8.1), one declaration for every function, an async one's result being the future it gives (§6.4): `mock<...A, R, M in Mark = "simple">(target: Fn<A, R, M>, replacement: Fn<A, R, M>) -> Mock<Fn<A, R, M>>`, and explicit type arguments name the parameters as a tuple, then the result, then the mark. Holding a mock calls neither function, so code of every mark mocks a function of any. It applies to everything the test runs, including instances it spawns. For an overloaded name, the expected type picks the overload; a lambda can't be a target, since it has no identity to replace, nor can a variant, which is built where it is called (§5.3). A target with defaults is replaced once they are filled, so its replacement takes every parameter, and the target is named at a type taking them all: one leaving defaults out is a compile error. A host type's `dispose`, which the runtime calls (§16), may be a mock's target, the one place it may be named. A deferred call's call is a call, so `spawn charge(order)` calls `charge` in the new instance, which reaches its mock. Starting an instance with a function value, `spawn(f)` or `runtime.isolate(f)`, isn't a call of it, so an async `f` runs whatever mocks it. `m.calls()` returns the arguments of every call as tuples, typed from `F`: `Array<(String, Int)>` for `chargeCard`, `Array<(String,)>` for a function of one parameter, and a `Unit`, the empty tuple, per call of one of none.

- **Mocking twice.** Mocking a target that is already mocked replaces it while the new handle is held; releasing that handle brings back the mock before it.
- **Across instances.** A mock applies to the instance holding it and to every instance spawned from it. Such an instance calls the replacement in the instance holding the mock, as a host's extern is called (§17.3): the arguments and the result are copied between the two, so they must be sendable, or the call panics. A future the replacement returns is followed across as well. The instance answering plays the host, so a host value it receives or hands back isn't its to dispose: only the instance that got it from the call owns it (§16).

**Time.** `time.at(t)` is the runtime's only time primitive, and `delay(d)` is library code for `at(now() + d)`. Mocking `time.now` and `time.at` therefore controls all time. The library's `FakeClock` is made for that: `FakeClock{start}` stands still at `start`, and its fields `now` and `at` are the replacements, as above. `clock.advance(d)` moves it forward by `d` at once and fills every deadline it passes, the earliest first, the waits for one deadline together, as timers due at one instant resolve (§15.2). A deadline already reached resolves at once, and advancing by a negative duration panics.

**Host types.** `testing.handle<T>()` creates a unique, opaque value of any extern type `T`, for mocks that must return one: each call gives a value equal to no other, and a `T` that isn't an extern type is a compile error. The library's `FakeQueue<Q, T, K = String>` fakes a host's queues of type `Q` carrying `T`, with an ordinary inbox behind each: `FakeQueue<Queue<Verdict>, Verdict>{make: handle}`. Its fields are replacements for the program's functions: `open`, for a queue factory such as `verdicts`, gives the queue of a key of type `K`, made with `make` the first time; `send` and `receive` use that queue's inbox. `receive` is ista code, so it replaces the program's own ista read of a queue, such as §20.1's `next`, never the host's live `receive`, which ista code reaches only through a job (§14); a test runs no job, so one waiting on a job's result fails, naming where it waits, while a job whose future it lets go of first is withdrawn (§16) and needs none. A mock's target must name a function, so the test mocks the program's functions with them itself:

```python statements
const verdictQueues = FakeQueue<Queue<Verdict>, Verdict>{make: handle}
hold _ = mock(verdicts, verdictQueues.open)
hold _ = mock(next, verdictQueues.receive)
verdictQueues.post("p1", Verdict{role: "legal", ok: true, comment: ""})
```

For the test, `pending(key)` gives the messages waiting in a key's queue, oldest first, `post(key, msg)` sends one into it, and `sendRevertible(queue, msg)` sends one revertibly, for a program's own revertible send to answer with.

**Driving an instance.** A test starts an instance with `spawn` (§17.1), which exists once the test's segment commits, and waits for its end with `result()`. `testing` inspects an `Instance<R>` too, through functions a test imports to call them as methods, since `Instance` is the prelude's (`import idle, reaches from 'testing'`):

| Member | Meaning |
| --- | --- |
| `idle() -> Future<Unit, "ista">` | resolves once every execution of the instance is waiting, or it has finished, so everything so far has committed |
| `reaches(label: String) -> Future<Unit, "ista">` | resolves once an execution of the instance is suspended at that waypoint |
| `waitingAt() -> Array<String>` | the waypoint of every `await` or `select` the instance is suspended at, or its source location (`module:line:column`) where it has none |
| `state() -> InstanceState` | `Running`, `Waiting`, `Panicked`, `Finished` or `Terminated`, as its last commit says |

`testing.spawnCrashingEveryAwait(f)` spawns `f`, a sendable function taking nothing such as `fn(): purchase(req)`, and returns its `Instance`, but the instance discards and re-runs every segment once before committing it, which catches extern calls that aren't idempotent and anything that differs between two runs of the same segment.

**Waypoints.** `@Waypoint{"approval"}` on a statement that awaits gives that suspension point a name, for `reaches` and `waitingAt`, and for the host's operator view, which can show an instance as waiting at `approval`.

**Failures.** The library's `assert` and `assertEq` panic on failure, and a panic in the test or in an instance it spawned fails the test at once, with that instance's message and trace, unless some instance waits for that instance's end through `result()`, which then gives the panic as an `Err`. `assert(condition)` and `assert(condition, message)` take a `Bool`; `assertEq(actual, expected)` takes any `Encodable` type, every struct, enum and tuple deriving it (§17.4), and its message shows both as JSON: `expected "expired", found "approved"`. Other values are compared with `assert(a == b)`.

`await expectPanic(f)` passes only if `f` panics, and gives the panic's message. A panic freezes the instance it happens in (§12), so `f`, a sendable plain or `async` function taking nothing, is spawned as an instance of its own, and `expectPanic` waits for its `result()`, so that panic doesn't fail the test. `expectPanic` panics when `f` returns instead.

**Built in versus library.** The runtime provides the `@Suite` runner with a fresh context per test, a function's slot, which a test binds a function value to, run in its place by every call of it from the instance holding the binding and the instances spawned from it, `time.at`, `testing.handle<T>()`, `testing.spawnCrashingEveryAwait` and an `Instance`'s inspection, and the panic capture behind failures. Everything else is written in the language: `mock`, `Mock<F>` and `calls()`, which bind a replacement recording its calls to its target's slot, `test`, `group`, `skip`, `only`, `Setup` and `setups`, `FakeClock`, `FakeQueue`, the assertions and `delay`.

**Running tests.** `ista test [paths…]` compiles every test module under the given files and directories, or under the project root without any (found as `ista check` finds sources, §13.1), into one program, and runs nothing if any module has errors. It then runs each test of every `@Suite` function, one at a time, in a fresh context on a fresh runtime and store, so nothing a test leaves behind reaches the next. Instances a test spawns run alongside it. A test passes when its function returns; instances it spawned that still wait are dropped.

- **The host.** Time is real unless a test mocks it. Random values (§19.2) come from a seed made from the test's full title, so every run draws the same ones; a test fixes them by mocking `random.integer` or `random.uuid`. An extern that no mock replaces panics the instance that calls it, except a host type's `dispose`, which then does nothing: a test has nothing of its host's to release.
- **Stuck tests.** A test whose instances all wait on nothing that can wake them fails, naming where each waits; so does one still running after `--timeout <ms>` of real time, 5000 by default.
- **Selection.** `--filter <text>` runs only the tests whose full title contains `text`. A full title joins the suite's, the groups' and the test's titles with ` › `. The filter narrows what `only` selects, never widens it: a test runs only if both select it, and every other test is reported skipped.
- **Output.** One line per test, `✓`, `✗` or `-` (skipped) before its full title; a failure is followed by its message and trace, then the log records its instances committed, and a last line counts the tests that passed, failed and were skipped.
- **Exit codes.** 0 when every test that ran passed; 1 when a module has errors, a test fails or no test ran; 2 when a path can't be read or the options don't fit together.
