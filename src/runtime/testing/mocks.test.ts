/**
 * Mocks in a test run (§10): what they replace, in the test and in every instance it spawns, how
 * long they hold, the calls they record, and that one test's mocks never reach the next.
 */

import { describe, expect, it } from 'vitest';
import { outcomesOf, reportsOf, testModule } from './testing.test-kit.ts';

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
  assertEq(charged.calls(), [(5,), (5,), (7,)])

@Suite{"mocks"}
fn mocks() -> Array<Test>: [test("everywhere", everywhere)]
`);
    expect(outcomesOf(reportsOf(source))).toEqual(['mocks › everywhere: passed']);
  });

  it('are released with their holder, the newest reaching calls, and record each call as a tuple', () => {
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
  assertEq(single.calls(), [(1,)])
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
