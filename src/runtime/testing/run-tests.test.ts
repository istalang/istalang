/**
 * Running a program's tests (§10): the runner's reports, mocks across instances, started instances
 * and their watches, handles, and how a test fails.
 */

import { describe, expect, it } from 'vitest';
import { caseHelper, outcomesOf, reportsOf } from './testing.test-kit.ts';

/** A test module: the imports every program here uses, the case helper, then `body`. */
function testModule(body: string): string {
  return [
    "import Suite, Test, mock, calls, handle from 'testing'",
    "import * as testing from 'testing'",
    "import * as time from 'time'",
    "import Time, Duration from 'time'",
    caseHelper,
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
  testCase("passes", passes),
  Group{title: "group", tests: [testCase("fails", fails)], focus: Plain},
  Case{title: "skipped", body: fails, focus: Skipped},
]

@Suite{"second"}
fn second() -> Array<Test>: [Group{title: "all", tests: [testCase("inherits", fails)], focus: Skipped}]
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
fn one() -> Array<Test>: [testCase("a", passes), Case{title: "b", body: passes, focus: Only}]

@Suite{"two"}
fn two() -> Array<Test>: [Group{title: "g", tests: [testCase("c", passes)], focus: Only}, testCase("d", passes)]
`);
    expect(outcomesOf(reportsOf(source))).toEqual([
      'one › a: skipped',
      'one › b: passed',
      'two › g › c: passed',
      'two › d: skipped',
    ]);
    expect(outcomesOf(reportsOf(source, { filter: 'g ›' }))).toEqual(['two › g › c: passed']);
  });

  it('fails a test whose suite lists other tests in its instance than it listed before', () => {
    const source = testModule(`
async fn passes():
  ()

fn title() -> string: "at " + time.now().value

@Suite{"changing"}
fn changing() -> Array<Test>: [testCase(title(), passes)]
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
  it('replace own, std and host functions, in the test and every instance it starts or they spawn', () => {
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
  fn _ = mock(greet, fn(): "hi")
  fn _ = mock(time.now, fn(): Time{value: 42})
  if await report() != "hi charged 5 42":
    panic("in the test: " + await report())
  const started = testing.start(parent)
  const got = await started.result()
  if got != "hi charged 5 42":
    panic("in a started instance: " + got)
  await time.delay(1s)
  if charged.calls() != [5, 5, 7]:
    panic("calls: " + charged.calls().length())

@Suite{"mocks"}
fn mocks() -> Array<Test>: [testCase("everywhere", everywhere)]
`);
    expect(outcomesOf(reportsOf(source))).toEqual(['mocks › everywhere: passed']);
  });

  it('are released with their holder, the newest reaching calls, and record calls by arity', () => {
    const source = testModule(`
fn greet() -> string: "hello"
fn one(a: int) -> int: a
fn two(a: int, b: string) -> int: a

async fn released():
  fn _ = mock(greet, fn(): "outer")
  const inner = mock(greet, fn(): "inner")
  if greet() != "inner":
    panic("the newest mock doesn't reach the call")
  drop inner
  if greet() != "outer":
    panic("releasing the newest doesn't bring back the one before")

async fn recorded():
  const nothing = mock(greet, fn(): "x")
  const single = mock(one, fn(a: int): a)
  const pair = mock(two, fn(a: int, b: string): a)
  drop greet()
  drop one(1)
  drop two(2, "b")
  if nothing.calls() != [()] or single.calls() != [1] or pair.calls() != [(2, "b")]:
    panic("calls aren't recorded by arity")

@Suite{"holders"}
fn holders() -> Array<Test>: [testCase("released", released), testCase("recorded", recorded)]
`);
    expect(outcomesOf(reportsOf(source))).toEqual([
      'holders › released: passed',
      'holders › recorded: passed',
    ]);
  });

  it('answer a started instance with a native replacement, and fail the test when one panics', () => {
    const source = testModule(`
fn describe(n: int) -> string: "number"

async fn describes() -> Future<string>:
  describe(42)

async fn native():
  fn _ = mock(describe, toString)
  if await testing.start(describes).result() != "42":
    panic("a native replacement didn't answer the started instance")

async fn breaking():
  fn _ = mock(describe, fn(n: int) -> string: panic("the replacement broke"))
  drop await testing.start(describes).result()

@Suite{"replacements"}
fn suite() -> Array<Test>: [testCase("native", native), testCase("breaking", breaking)]
`);
    expect(outcomesOf(reportsOf(source))).toEqual([
      'replacements › native: passed',
      'replacements › breaking: failed: the replacement broke',
    ]);
  });

  it('of a failed test reach no later test, each running in a world of its own', () => {
    const source = testModule(`
fn greet() -> string: "hello"

async fn failsMocked() -> Future<unit>:
  fn _ = mock(greet, fn(): "mocked")
  panic("failed")

async fn unmocked():
  if greet() != "hello":
    panic("an earlier test's mock reached this one")

@Suite{"isolated"}
fn isolated() -> Array<Test>: [testCase("fails", failsMocked), testCase("next", unmocked)]
`);
    expect(outcomesOf(reportsOf(source))).toEqual([
      'isolated › fails: failed: failed',
      'isolated › next: passed',
    ]);
  });
});

describe('started instances', () => {
  it('are watched through idle, reaches, waitingAt, state and result', () => {
    const source = testModule(`
async fn sleeper(days: int) -> Future<string>:
  @Waypoint{"sleeping"}
  await time.delay(Duration{value: days * 1000})
  "woke"

async fn watched():
  const started = testing.start(sleeper, 2)
  if not (started.state() is Running):
    panic("an instance that hasn't run yet is running")
  await started.idle()
  if not (started.state() is Waiting) or started.waitingAt() != ["sleeping"]:
    panic("expected it waiting at its waypoint: " + started.waitingAt().length())
  await started.reaches("sleeping")
  if await started.result() != "woke" or not (started.state() is Finished):
    panic("expected it finished")

@Suite{"watches"}
fn watches() -> Array<Test>: [testCase("watched", watched)]
`);
    expect(outcomesOf(reportsOf(source))).toEqual(['watches › watched: passed']);
  });

  it('fail the test at once when one panics, naming the instance', () => {
    const source = testModule(`
async fn breaks() -> Future<unit>:
  panic("broken")

async fn starts():
  drop testing.start(breaks)
  await time.delay(1s)

@Suite{"panics"}
fn panics() -> Array<Test>: [testCase("starts", starts)]
`);
    expect(outcomesOf(reportsOf(source))).toEqual([
      'panics › starts: failed: Instance test/1 panicked: broken',
    ]);
  });

  it('run each segment twice before committing it with startCrashingEveryAwait', () => {
    const source = testModule(`
extern fn effect(n: int) -> int

async fn twice() -> Future<int>:
  const n = effect(1)
  await time.delay(1s)
  n

async fn crashing():
  const effects = mock(effect, fn(n: int): n)
  drop await testing.startCrashingEveryAwait(twice).result()
  if effects.calls().length() != 2:
    panic("ran its first segment " + effects.calls().length() + " times")

@Suite{"crash"}
fn crash() -> Array<Test>: [testCase("crashing", crashing)]
`);
    expect(outcomesOf(reportsOf(source))).toEqual(['crash › crashing: passed']);
  });
});

describe('handles', () => {
  it('equal no other, and come back the same through a mock a started instance calls', () => {
    const source = testModule(`
extern sendable struct Queue
extern fn open() -> Queue
extern fn name(queue: Queue) -> string

async fn opens() -> Future<string>:
  name(open())

async fn handles():
  const queue = handle<Queue>()
  if queue == handle<Queue>():
    panic("two handles are equal")
  fn _ = mock(open, fn(): queue)
  fn _ = mock(name, fn(given: Queue): if given == queue: "same" else: "other")
  if await testing.start(opens).result() != "same":
    panic("the handle didn't come back the same")

@Suite{"handles"}
fn suite() -> Array<Test>: [testCase("handles", handles)]
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
  fn _ = mock(open, fn(): queue)
  drop await testing.start(opensAndLets).result()

async fn mockedDispose():
  const queue = handle<Queue>()
  fn _ = mock(open, fn(): queue)
  const disposed = mock(dispose, fn(given: Queue): ())
  drop await testing.start(opensAndLets).result()
  if disposed.calls() != [queue]:
    panic("the started instance's disposal didn't reach the mock with the same handle")

@Suite{"disposal"}
fn suite() -> Array<Test>: [testCase("unmocked", unmockedDispose), testCase("mocked", mockedDispose)]
`);
    expect(outcomesOf(reportsOf(source))).toEqual([
      'disposal › unmocked: passed',
      'disposal › mocked: passed',
    ]);
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
fn failing() -> Array<Test>: [testCase("unmocked", unmocked), testCase("forever", forever), testCase("long", tooLong)]
`);
    const messages = reportsOf(source, { timeout: 1000n }).map(({ outcome }) =>
      outcome.kind === 'failed' ? outcome.message : outcome.kind,
    );
    expect(messages[0]).toContain('No mock replaces main.test.ista.charge');
    expect(messages[1]).toContain('The test waits on nothing that can wake it: test at');
    expect(messages[2]).toContain('The test waits past its timeout: test at');
  });
});
