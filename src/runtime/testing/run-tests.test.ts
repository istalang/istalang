/**
 * Running a program's tests (§10): the runner's reports, spawned instances and the waits on them,
 * handles, and how a test fails. Mocks have their own file (mocks.test.ts).
 */

import { describe, expect, it } from 'vitest';
import { outcomesOf, reportsOf, testModule } from './testing.test-kit.ts';

describe('the runner', () => {
  it('reports each test under its full title, as passed, failed or skipped', async () => {
    const source = testModule(`
async fn passes():
  ()

async fn fails() -> Future<Unit>:
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
    expect(outcomesOf(await reportsOf(source))).toEqual([
      'first › passes: passed',
      'first › group › fails: failed: on purpose',
      'first › skipped: skipped',
      'second › all › inherits: skipped',
    ]);
  });

  it('runs only the focused tests when any is, and only those a filter names', async () => {
    const source = testModule(`
async fn passes():
  ()

@Suite{"one"}
fn one() -> Array<Test>: [test("a", passes), only(test("b", passes))]

@Suite{"two"}
fn two() -> Array<Test>: [only(group("g", [test("c", passes)])), test("d", passes)]
`);
    expect(outcomesOf(await reportsOf(source))).toEqual([
      'one › a: skipped',
      'one › b: passed',
      'two › g › c: passed',
      'two › d: skipped',
    ]);
    expect(outcomesOf(await reportsOf(source, { filter: 'g ›' }))).toEqual(['two › g › c: passed']);
  });

  it('skips a test skip marks, whatever only marks, and at whatever level', async () => {
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
    expect(outcomesOf(await reportsOf(source))).toEqual([
      'marks › only over skip: skipped',
      'marks › skip over only: skipped',
      'marks › g › skip inside only: skipped',
      'marks › g › focused: passed',
    ]);
  });

  it('fails a test whose suite lists other tests in its instance than it listed before', async () => {
    const source = testModule(`
async fn passes():
  ()

fn title() -> String: "at " + time.now().value

@Suite{"changing"}
fn changing() -> Array<Test>: [test(title(), passes)]
`);
    const [report] = await reportsOf(source, { tick: (before) => before + 1n });
    expect(report?.outcome).toMatchObject({ kind: 'failed' });
    expect((await reportsOf(source))[0]?.outcome).toEqual({ kind: 'passed' });
  });

  it('reports a suite that panics while listing as one failed test', async () => {
    const source = testModule(`
fn broken() -> Array<Test>: panic("no tests")

@Suite{"broken"}
fn suite() -> Array<Test>: broken()
`);
    expect(outcomesOf(await reportsOf(source))).toEqual(['broken: failed: no tests']);
  });
});

describe('spawned instances', () => {
  it('are watched through idle, reaches, waitingAt, state and result', async () => {
    const source = testModule(`
async fn sleeper(days: Int) -> Future<String>:
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
  assertEq(await started.result(), Ok("woke"))
  assert(started.state() is Finished)

@Suite{"watches"}
fn watches() -> Array<Test>: [test("watched", watched)]
`);
    expect(outcomesOf(await reportsOf(source))).toEqual(['watches › watched: passed']);
  });

  it("aren't idle while a segment of theirs calls the test's mocks", async () => {
    const source = testModule(`
fn first() -> Int: 1
fn second() -> Int: 2

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
    expect(outcomesOf(await reportsOf(source))).toEqual(['idle › after calls: passed']);
  });

  it('fail the test at once when one panics, naming the instance', async () => {
    const source = testModule(`
async fn breaks() -> Future<Unit>:
  panic("broken")

async fn starts():
  spawn breaks()
  await time.delay(1s)

@Suite{"panics"}
fn panics() -> Array<Test>: [test("starts", starts)]
`);
    expect(outcomesOf(await reportsOf(source))).toEqual([
      'panics › starts: failed: Instance test/1 panicked: broken',
    ]);
  });

  it('fail no test with a panic some instance waits for, which reads it as an Err', async () => {
    const source = testModule(`
async fn breaks() -> Future<Int>:
  panic("broken")

async fn awaited():
  const outcome = await spawn breaks().result()
  assert(outcome is Err(error) and error.message == "broken" and error.code == "panic")

@Suite{"awaited"}
fn awaitedPanics() -> Array<Test>: [test("awaited", awaited)]
`);
    expect(outcomesOf(await reportsOf(source))).toEqual(['awaited › awaited: passed']);
  });

  it('run each segment twice before committing it with spawnCrashingEveryAwait', async () => {
    const source = testModule(`
extern fn effect(n: Int) -> Int

async fn twice() -> Future<Int>:
  const n = effect(1)
  await time.delay(1s)
  n

async fn crashing():
  const effects = mock(effect, fn(n: Int): n)
  drop await testing.spawnCrashingEveryAwait(twice).result()
  assertEq(effects.calls().length(), 2)

@Suite{"crash"}
fn crash() -> Array<Test>: [test("crashing", crashing)]
`);
    expect(outcomesOf(await reportsOf(source))).toEqual(['crash › crashing: passed']);
  });
});

describe('handles', () => {
  it('equal no other, and come back the same through a mock a spawned instance calls', async () => {
    const source = testModule(`
extern sendable struct Queue
extern fn open() -> Queue
extern fn name(queue: Queue) -> String

async fn opens() -> Future<String>:
  name(open())

async fn handles():
  const queue = handle<Queue>()
  assert(queue != handle<Queue>())
  hold _ = mock(open, fn(): queue)
  hold _ = mock(name, fn(given: Queue): if given == queue: "same" else: "other")
  assertEq(await spawn opens().result(), Ok("same"))

@Suite{"handles"}
fn suite() -> Array<Test>: [test("handles", handles)]
`);
    expect(outcomesOf(await reportsOf(source))).toEqual(['handles › handles: passed']);
  });
});

describe("a host type's dispose", () => {
  it('does nothing unless a mock replaces it, and reaches the mock when one does', async () => {
    const source = testModule(`
extern shared struct Queue
extern fn dispose(self: Queue)
extern fn open() -> Queue
async fn openAsync() -> Future<Queue>:
  open()

async fn opensAndLets() -> Future<Unit>:
  drop open()

async fn unmockedDispose():
  const queue = handle<Queue>()
  hold _ = mock(open, fn(): queue)
  drop await spawn opensAndLets().result()

async fn mockedDispose():
  const queue = handle<Queue>()
  hold _ = mock(open, fn(): queue)
  hold _ = mock(openAsync, async fn() -> Future<Queue>: {
    await time.delay(1ms)
    queue
  })
  const disposed = mock(dispose, fn(given: Queue): ())
  drop open()
  drop await openAsync()
  drop await spawn opensAndLets().result()
  assert(disposed.calls() == [queue, queue, queue])

@Suite{"disposal"}
fn suite() -> Array<Test>: [test("unmocked", unmockedDispose), test("mocked", mockedDispose)]
`);
    expect(outcomesOf(await reportsOf(source))).toEqual([
      'disposal › unmocked: passed',
      'disposal › mocked: passed',
    ]);
  });

  it('runs once, in the instance owning the value, never in the test that answered with it', async () => {
    const source = testModule(`
extern shared struct Sent
extern fn dispose(self: Sent)
extern fn post(n: Int) -> Sent

async fn posts() -> Future<Unit>:
  hold _ = post(1)
  hold _ = post(2)

async fn handedOut():
  hold _ = mock(post, fn(n: Int): handle<Sent>())
  const disposed = mock(dispose, fn(given: Sent): ())
  drop await spawn posts().result()
  assertEq(disposed.calls().length(), 2)

@Suite{"ownership"}
fn suite() -> Array<Test>: [test("handed out", handedOut)]
`);
    expect(outcomesOf(await reportsOf(source))).toEqual(['ownership › handed out: passed']);
  });
});

describe('a failing test', () => {
  it('fails on an extern no mock replaces, on waiting forever, and on waiting past its timeout', async () => {
    const source = testModule(`
extern fn charge(amount: Int) -> String

async fn unmocked():
  drop charge(1)

async fn forever():
  drop await Slot.create<Int>().take()

async fn tooLong():
  await time.delay(10s)

@Suite{"failing"}
fn failing() -> Array<Test>: [test("unmocked", unmocked), test("forever", forever), test("long", tooLong)]
`);
    const messages = (await reportsOf(source, { timeout: 1000n })).map(({ outcome }) =>
      outcome.kind === 'failed' ? outcome.message : outcome.kind,
    );
    expect(messages[0]).toContain('No mock replaces main.test.ista.charge');
    expect(messages[1]).toContain('The test waits on nothing that can wake it: test at');
    expect(messages[2]).toContain('The test waits past its timeout: test at');
  });
});
