/**
 * Mocks in a test run (§10): what they replace, in the test and in every instance it spawns, how
 * long they hold, the calls they record, and that one test's mocks never reach the next.
 */

import { describe, expect, it } from 'vitest';
import { outcomesOf, reportsOf, testModule } from './testing.test-kit.ts';

describe('mocks', () => {
  it('replace own, std and host functions, in the test and every instance it spawns or they spawn', async () => {
    const source = testModule(`
extern fn charge(amount: Int) -> String

fn greet() -> String: "hello"

async fn report() -> Future<String>:
  greet() + " " + charge(5) + " " + time.now().value

async fn child():
  drop charge(7)

async fn parent() -> Future<String>:
  spawn child()
  await report()

async fn everywhere():
  const charged = mock(charge, fn(amount: Int): "charged " + amount)
  hold _ = mock(greet, fn(): "hi")
  hold _ = mock(time.now, fn(): Time{value: 42})
  assertEq(await report(), "hi charged 5 42")
  assertEq(await (spawn parent()).result(), Ok("hi charged 5 42"))
  await time.delay(1s)
  assertEq(charged.calls(), [(5,), (5,), (7,)])

@Suite{"mocks"}
fn mocks() -> Array<Test>: [test("everywhere", everywhere)]
`);
    expect(outcomesOf(await reportsOf(source))).toEqual(['mocks › everywhere: passed']);
  });

  it("reach a spawned deferred call's call, not the function an instance starts with", async () => {
    const source = testModule(`
import * as runtime from 'runtime'

async fn greet(name: String) -> Future<String>: "hello " + name

async fn hello() -> Future<String>: "hello"

async fn spawned():
  hold _ = mock(greet, async fn(name: String): "hi " + name)
  hold _ = mock(hello, async fn(): "hi")
  assertEq(await (spawn greet("ada")).result(), Ok("hi ada"))
  assertEq(await spawn(hello).result(), Ok("hello"))
  assertEq(await runtime.isolate(hello), Ok("hello"))

@Suite{"mocks"}
fn mocks() -> Array<Test>: [test("spawned", spawned)]
`);
    expect(outcomesOf(await reportsOf(source))).toEqual(['mocks › spawned: passed']);
  });

  it('replace a generic function named with its type arguments, at that instantiation', async () => {
    const source = testModule(`
fn listed<T>(value: T) -> Array<T>: [value]

async fn typed():
  hold _ = mock(listed<Int>, fn(value: Int): [value + 1])
  assertEq(listed(1), [2])
  assertEq(listed("a"), ["a"])

@Suite{"mocks"}
fn mocks() -> Array<Test>: [test("typed", typed)]
`);
    expect(outcomesOf(await reportsOf(source))).toEqual(['mocks › typed: passed']);
  });

  it('are released with their holder, the newest reaching calls, and record each call as a tuple', async () => {
    const source = testModule(`
fn greet() -> String: "hello"
fn one(a: Int) -> Int: a
fn two(a: Int, b: String) -> Int: a

async fn released():
  hold _ = mock(greet, fn(): "outer")
  const inner = mock(greet, fn(): "inner")
  assertEq(greet(), "inner")
  drop inner
  assertEq(greet(), "outer")

async fn recorded():
  const nothing = mock(greet, fn(): "x")
  const single = mock(one, fn(a: Int): a)
  const pair = mock(two, fn(a: Int, b: String): a)
  drop greet()
  drop one(1)
  drop two(2, "b")
  assertEq(nothing.calls(), [()])
  assertEq(single.calls(), [(1,)])
  assertEq(pair.calls(), [(2, "b")])

@Suite{"holders"}
fn holders() -> Array<Test>: [test("released", released), test("recorded", recorded)]
`);
    expect(outcomesOf(await reportsOf(source))).toEqual([
      'holders › released: passed',
      'holders › recorded: passed',
    ]);
  });

  it('answer a spawned instance with a native replacement, and fail the test when one panics', async () => {
    const source = testModule(`
fn describe(n: Int) -> String: "number"

async fn describes() -> Future<String>:
  describe(42)

async fn native():
  hold _ = mock(describe, toString)
  assertEq(await (spawn describes()).result(), Ok("42"))

async fn breaking():
  hold _ = mock(describe, fn(n: Int) -> String: panic("the replacement broke"))
  drop await (spawn describes()).result()

@Suite{"replacements"}
fn suite() -> Array<Test>: [test("native", native), test("breaking", breaking)]
`);
    expect(outcomesOf(await reportsOf(source))).toEqual([
      'replacements › native: passed',
      'replacements › breaking: failed: the replacement broke',
    ]);
  });

  it('drop an answer whose caller let go of its future, so a receive losing a select takes nothing', async () => {
    const source = testModule(`
extern sendable struct Queue<T is Sendable>
extern fn receive<T is Decodable>(self: Queue<T>) -> Future<T>
extern fn queueOf(name: String) -> Queue<Int>

async fn pollsThenWaits() -> Future<Int>:
  const polled: Int = select:
    case queueOf("q").receive() as n:
      n
    else:
      0
  polled + await queueOf("q").receive()

async fn posted():
  const fake = FakeQueue<Queue<Int>, Int>{make: handle}
  hold _ = mock(queueOf, fake.open)
  hold _ = mock(receive, fake.receive)
  const started = spawn pollsThenWaits()
  await started.idle()
  fake.post("q", 5)
  assertEq(await started.result(), Ok(5))

@Suite{"withdrawn"}
fn suite() -> Array<Test>: [test("posted after a lost select", posted)]
`);
    expect(outcomesOf(await reportsOf(source))).toEqual([
      'withdrawn › posted after a lost select: passed',
    ]);
  });

  it('of a failed test reach no later test, each running in a world of its own', async () => {
    const source = testModule(`
fn greet() -> String: "hello"

async fn failsMocked() -> Future<Unit>:
  hold _ = mock(greet, fn(): "mocked")
  panic("failed")

async fn unmocked():
  assertEq(greet(), "hello")

@Suite{"isolated"}
fn isolated() -> Array<Test>: [test("fails", failsMocked), test("next", unmocked)]
`);
    expect(outcomesOf(await reportsOf(source))).toEqual([
      'isolated › fails: failed: failed',
      'isolated › next: passed',
    ]);
  });
});
