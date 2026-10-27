/**
 * Running a program's tests (§10): the runner's reports, mocks across instances, spawned instances
 * and the waits on them, handles, and how a test fails.
 */

import { describe, expect, it } from 'vitest';
import { outcomesOf, reportsOf } from './testing.test-kit.ts';

/** A test module: the imports every program here uses, then `body`. */
function testModule(body: string): string {
  return [
    "import Suite, Test, test, group, skip, only, assert, assertEq, FakeClock, FakeQueue, mock, calls, handle from 'testing'",
    "import idle, reaches, waitingAt, state from 'testing'",
    "import Decodable from 'json'",
    "import * as testing from 'testing'",
    "import * as time from 'time'",
    "import Time, Duration from 'time'",
    body,
  ].join('\n');
}

describe('the runner', () => {
  it('reports each test under its full title, as passed, failed or skipped', () => {
    const source = testModule(`
async fn passes():
  ()

async fn fails() -> Future<unit>:
  panic("on purpose")

@Suite{"first"}
fn first() -> Array<Test>: [
  test("passes", passes),
  group("group", [test("fails", fails)]),
  skip(test("skipped", fails)),
]

@Suite{"second"}
fn second() -> Array<Test>: [skip(group("all", [test("inherits", fails)]))]
`);
    expect(outcomesOf(reportsOf(source))).toEqual([
      'first › passes: passed',
      'first › group › fails: failed: on purpose',
      'first › skipped: skipped',
      'second › all › inherits: skipped',
    ]);
  });

  it('runs only the focused tests when any is, and only those a filter names', () => {
    const source = testModule(`
async fn passes():
  ()

@Suite{"one"}
fn one() -> Array<Test>: [test("a", passes), only(test("b", passes))]

@Suite{"two"}
fn two() -> Array<Test>: [only(group("g", [test("c", passes)])), test("d", passes)]
`);
    expect(outcomesOf(reportsOf(source))).toEqual([
      'one › a: skipped',
      'one › b: passed',
      'two › g › c: passed',
      'two › d: skipped',
    ]);
    expect(outcomesOf(reportsOf(source, { filter: 'g ›' }))).toEqual(['two › g › c: passed']);
  });

  it('skips a test skip marks, whatever only marks, and at whatever level', () => {
    const source = testModule(`
async fn passes():
  ()

@Suite{"marks"}
fn marks() -> Array<Test>: [
  only(skip(test("only over skip", passes))),
  skip(only(test("skip over only", passes))),
  only(group("g", [skip(test("skip inside only", passes)), test("focused", passes)])),
]
`);
    expect(outcomesOf(reportsOf(source))).toEqual([
      'marks › only over skip: skipped',
      'marks › skip over only: skipped',
      'marks › g › skip inside only: skipped',
      'marks › g › focused: passed',
    ]);
  });

  it('fails a test whose suite lists other tests in its instance than it listed before', () => {
    const source = testModule(`
async fn passes():
  ()

fn title() -> string: "at " + time.now().value

@Suite{"changing"}
fn changing() -> Array<Test>: [test(title(), passes)]
`);
    const [report] = reportsOf(source, { tick: (before) => before + 1n });
    expect(report?.outcome).toMatchObject({ kind: 'failed' });
    expect(reportsOf(source)[0]?.outcome).toEqual({ kind: 'passed' });
  });

  it('reports a suite that panics while listing as one failed test', () => {
    const source = testModule(`
fn broken() -> Array<Test>: panic("no tests")

@Suite{"broken"}
fn suite() -> Array<Test>: broken()
`);
    expect(outcomesOf(reportsOf(source))).toEqual(['broken: failed: no tests']);
  });
});

describe('mocks', () => {
  it('replace own, std and host functions, in the test and every instance it spawns or they spawn', () => {
    const source = testModule(`
extern fn charge(amount: int) -> string

fn greet() -> string: "hello"

async fn report() -> Future<string>:
  greet() + " " + charge(5) + " " + time.now().value

async fn child():
  drop charge(7)

async fn parent() -> Future<string>:
  spawn child()
  await report()

async fn everywhere():
  const charged = mock(charge, fn(amount: int): "charged " + amount)
  hold _ = mock(greet, fn(): "hi")
  hold _ = mock(time.now, fn(): Time{value: 42})
  assertEq(await report(), "hi charged 5 42")
  assertEq(await spawn parent().result(), Ok{"hi charged 5 42"})
  await time.delay(1s)
  assertEq(charged.calls(), [5, 5, 7])

@Suite{"mocks"}
fn mocks() -> Array<Test>: [test("everywhere", everywhere)]
`);
    expect(outcomesOf(reportsOf(source))).toEqual(['mocks › everywhere: passed']);
  });

  it('are released with their holder, the newest reaching calls, and record calls by arity', () => {
    const source = testModule(`
fn greet() -> string: "hello"
fn one(a: int) -> int: a
fn two(a: int, b: string) -> int: a

async fn released():
  hold _ = mock(greet, fn(): "outer")
  const inner = mock(greet, fn(): "inner")
  assertEq(greet(), "inner")
  drop inner
  assertEq(greet(), "outer")

async fn recorded():
  const nothing = mock(greet, fn(): "x")
  const single = mock(one, fn(a: int): a)
  const pair = mock(two, fn(a: int, b: string): a)
  drop greet()
  drop one(1)
  drop two(2, "b")
  assertEq(nothing.calls(), [()])
  assertEq(single.calls(), [1])
  assertEq(pair.calls(), [(2, "b")])

@Suite{"holders"}
fn holders() -> Array<Test>: [test("released", released), test("recorded", recorded)]
`);
    expect(outcomesOf(reportsOf(source))).toEqual([
      'holders › released: passed',
      'holders › recorded: passed',
    ]);
  });

  it('answer a spawned instance with a native replacement, and fail the test when one panics', () => {
    const source = testModule(`
fn describe(n: int) -> string: "number"

async fn describes() -> Future<string>:
  describe(42)

async fn native():
  hold _ = mock(describe, toString)
  assertEq(await spawn describes().result(), Ok{"42"})

async fn breaking():
  hold _ = mock(describe, fn(n: int) -> string: panic("the replacement broke"))
  drop await spawn describes().result()

@Suite{"replacements"}
fn suite() -> Array<Test>: [test("native", native), test("breaking", breaking)]
`);
    expect(outcomesOf(reportsOf(source))).toEqual([
      'replacements › native: passed',
      'replacements › breaking: failed: the replacement broke',
    ]);
  });

  it('drop an answer whose caller let go of its future, so a receive losing a select takes nothing', () => {
    const source = testModule(`
extern sendable struct Queue<T is Sendable>
extern fn receive<T is Decodable>(self: Queue<T>) -> Future<T>
extern fn queueOf(name: string) -> Queue<int>

async fn pollsThenWaits() -> Future<int>:
  const polled: int = select:
    case queueOf("q").receive() as n:
      n
    else:
      0
  polled + await queueOf("q").receive()

async fn posted():
  const fake = FakeQueue<Queue<int>, int>{make: handle}
  hold _ = mock(queueOf, fake.open)
  hold _ = mock(receive, fake.receive)
  const started = spawn pollsThenWaits()
  await started.idle()
  fake.post("q", 5)
  assertEq(await started.result(), Ok{5})

@Suite{"withdrawn"}
fn suite() -> Array<Test>: [test("posted after a lost select", posted)]
`);
    expect(outcomesOf(reportsOf(source))).toEqual([
      'withdrawn › posted after a lost select: passed',
    ]);
  });

  it('of a failed test reach no later test, each running in a world of its own', () => {
    const source = testModule(`
fn greet() -> string: "hello"

async fn failsMocked() -> Future<unit>:
  hold _ = mock(greet, fn(): "mocked")
  panic("failed")

async fn unmocked():
  assertEq(greet(), "hello")

@Suite{"isolated"}
fn isolated() -> Array<Test>: [test("fails", failsMocked), test("next", unmocked)]
`);
    expect(outcomesOf(reportsOf(source))).toEqual([
      'isolated › fails: failed: failed',
      'isolated › next: passed',
    ]);
  });
});

describe('spawned instances', () => {
  it('are watched through idle, reaches, waitingAt, state and result', () => {
    const source = testModule(`
async fn sleeper(days: int) -> Future<string>:
  @Waypoint{"sleeping"}
  await time.delay(Duration{value: days * 1000})
  "woke"

async fn watched():
  const started = spawn sleeper(2)
  assert(started.state() is Running)
  await started.idle()
  assert(started.state() is Waiting)
  assertEq(started.waitingAt(), ["sleeping"])
  await started.reaches("sleeping")
  assertEq(await started.result(), Ok{"woke"})
  assert(started.state() is Finished)

@Suite{"watches"}
fn watches() -> Array<Test>: [test("watched", watched)]
`);
    expect(outcomesOf(reportsOf(source))).toEqual(['watches › watched: passed']);
  });

  it("aren't idle while a segment of theirs calls the test's mocks", () => {
    const source = testModule(`
fn first() -> int: 1
fn second() -> int: 2

async fn wakesAndCalls():
  await time.delay(1s)
  drop first()
  drop second()
  await time.delay(1s)

async fn idleAfterCalls():
  const clock = FakeClock{start: Time{value: 0}}
  hold _ = mock(time.now, clock.now)
  hold _ = mock(time.at, clock.at)
  hold _ = mock(first, fn(): 10)
  const seconds = mock(second, fn(): 20)
  const started = spawn wakesAndCalls()
  await started.idle()
  clock.advance(1s)
  await started.idle()
  assertEq(seconds.calls().length(), 1)

@Suite{"idle"}
fn suite() -> Array<Test>: [test("after calls", idleAfterCalls)]
`);
    expect(outcomesOf(reportsOf(source))).toEqual(['idle › after calls: passed']);
  });

  it('fail the test at once when one panics, naming the instance', () => {
    const source = testModule(`
async fn breaks() -> Future<unit>:
  panic("broken")

async fn starts():
  spawn breaks()
  await time.delay(1s)

@Suite{"panics"}
fn panics() -> Array<Test>: [test("starts", starts)]
`);
    expect(outcomesOf(reportsOf(source))).toEqual([
      'panics › starts: failed: Instance test/1 panicked: broken',
    ]);
  });

  it('fail no test with a panic some instance waits for, which reads it as an Err', () => {
    const source = testModule(`
async fn breaks() -> Future<int>:
  panic("broken")

async fn awaited():
  const outcome = await spawn breaks().result()
  assert(outcome is Err{error} and error.message == "broken" and error.code == "panic")

@Suite{"awaited"}
fn awaitedPanics() -> Array<Test>: [test("awaited", awaited)]
`);
    expect(outcomesOf(reportsOf(source))).toEqual(['awaited › awaited: passed']);
  });

  it('run each segment twice before committing it with spawnCrashingEveryAwait', () => {
    const source = testModule(`
extern fn effect(n: int) -> int

async fn twice() -> Future<int>:
  const n = effect(1)
  await time.delay(1s)
  n

async fn crashing():
  const effects = mock(effect, fn(n: int): n)
  drop await testing.spawnCrashingEveryAwait(twice).result()
  assertEq(effects.calls().length(), 2)

@Suite{"crash"}
fn crash() -> Array<Test>: [test("crashing", crashing)]
`);
    expect(outcomesOf(reportsOf(source))).toEqual(['crash › crashing: passed']);
  });
});

describe('handles', () => {
  it('equal no other, and come back the same through a mock a spawned instance calls', () => {
    const source = testModule(`
extern sendable struct Queue
extern fn open() -> Queue
extern fn name(queue: Queue) -> string

async fn opens() -> Future<string>:
  name(open())

async fn handles():
  const queue = handle<Queue>()
  assert(queue != handle<Queue>())
  hold _ = mock(open, fn(): queue)
  hold _ = mock(name, fn(given: Queue): if given == queue: "same" else: "other")
  assertEq(await spawn opens().result(), Ok{"same"})

@Suite{"handles"}
fn suite() -> Array<Test>: [test("handles", handles)]
`);
    expect(outcomesOf(reportsOf(source))).toEqual(['handles › handles: passed']);
  });
});

describe("a host type's dispose", () => {
  it('does nothing unless a mock replaces it, and reaches the mock when one does', () => {
    const source = testModule(`
extern struct Queue
extern fn dispose(self: Queue)
extern fn open() -> Queue

async fn opensAndLets() -> Future<unit>:
  drop open()

async fn unmockedDispose():
  const queue = handle<Queue>()
  hold _ = mock(open, fn(): queue)
  drop await spawn opensAndLets().result()

async fn mockedDispose():
  const queue = handle<Queue>()
  hold _ = mock(open, fn(): queue)
  const disposed = mock(dispose, fn(given: Queue): ())
  drop await spawn opensAndLets().result()
  assert(disposed.calls() == [queue])

@Suite{"disposal"}
fn suite() -> Array<Test>: [test("unmocked", unmockedDispose), test("mocked", mockedDispose)]
`);
    expect(outcomesOf(reportsOf(source))).toEqual([
      'disposal › unmocked: passed',
      'disposal › mocked: passed',
    ]);
  });

  it('runs once, in the instance owning the value, never in the test that answered with it', () => {
    const source = testModule(`
extern struct Sent
extern fn dispose(self: Sent)
extern fn post(n: int) -> Sent

async fn posts() -> Future<unit>:
  hold _ = post(1)
  hold _ = post(2)

async fn handedOut():
  hold _ = mock(post, fn(n: int): handle<Sent>())
  const disposed = mock(dispose, fn(given: Sent): ())
  drop await spawn posts().result()
  assertEq(disposed.calls().length(), 2)

@Suite{"ownership"}
fn suite() -> Array<Test>: [test("handed out", handedOut)]
`);
    expect(outcomesOf(reportsOf(source))).toEqual(['ownership › handed out: passed']);
  });
});

describe('a failing test', () => {
  it('fails on an extern no mock replaces, on waiting forever, and on waiting past its timeout', () => {
    const source = testModule(`
extern fn charge(amount: int) -> string

async fn unmocked():
  drop charge(1)

async fn forever():
  drop await Slot.create<int>().take()

async fn tooLong():
  await time.delay(10s)

@Suite{"failing"}
fn failing() -> Array<Test>: [test("unmocked", unmocked), test("forever", forever), test("long", tooLong)]
`);
    const messages = reportsOf(source, { timeout: 1000n }).map(({ outcome }) =>
      outcome.kind === 'failed' ? outcome.message : outcome.kind,
    );
    expect(messages[0]).toContain('No mock replaces main.test.ista.charge');
    expect(messages[1]).toContain('The test waits on nothing that can wake it: test at');
    expect(messages[2]).toContain('The test waits past its timeout: test at');
  });
});
