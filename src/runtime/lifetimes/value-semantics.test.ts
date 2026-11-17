/**
 * End-to-end value-semantics tests over in-place updates (spec §3.1, §3.7, §3.9, §3.10, §3.14,
 * §7, §9, §10; docs/work/done/static-lifetimes/design.md §9.6): a mutation of a composite value must
 * never be observed by any other holder of the value.
 */

import { describe, expect, it } from 'vitest';
import { compiledText } from '../../compiler/compile.test-kit.ts';
import { startToEnd, testRuntime } from '../runtime.test-kit.ts';
import { outcomesOf, reportsOf, testModule } from '../testing/testing.test-kit.ts';

/** Runs `source` to its end (with `crashEveryAwait` when requested) and returns its outcome. */
async function outcomeOf(source: string, crashEveryAwait = false): Promise<string> {
  const ended = await startToEnd(testRuntime(), compiledText(source), { crashEveryAwait });
  if (ended.kind !== 'finished') {
    throw new Error(`Expected finished, got ${JSON.stringify(ended)}`);
  }
  return String(ended.outcome);
}

describe('value semantics under in-place updates', () => {
  it('keeps const and let copies, nested struct paths, and closures capturing values intact', async () => {
    const result = await outcomeOf(`
import * as runtime from 'runtime'

struct Inner:
  items: Array<Int>
  tags: Map<String, Int>

struct Outer:
  left: Inner
  right: Inner

fn mutateFirst(items: &Array<Int>, outer: Outer) -> Array<Int>:
  items.push(99)
  outer.left.items

live async fn main() -> Array<Int>: await runtime.run(runtime.id()) _main()
ista async fn _main() -> Array<Int>:
  let o = Outer{
    left: Inner{items: [1, 2], tags: ["a": 1]},
    right: Inner{items: [10], tags: ["b": 2]},
  }
  o.left.items.push(3)
  o.left.tags["c"] = 3
  const snapConst = o
  let snapLet = o
  const readLeft = fn() -> Array<Int>: snapConst.left.items
  o.left.items.push(4)
  o.left.items[0] = 90
  o.left.tags["a"] = 99
  snapLet.left.items.push(5)
  const fromCall = mutateFirst(&o.left.items, o)
  [
    ...snapConst.left.items,
    snapConst.left.tags["a"],
    snapConst.left.tags.size(),
    ...readLeft(),
    ...snapLet.left.items,
    ...fromCall,
    ...o.left.items,
  ]
`);
    expect(result).toBe('[1,2,3,1,2,1,2,3,1,2,3,5,90,2,3,4,90,2,3,4,99]');
  });

  it('writes each value as it is now, between changes in place, through the JSON kept of it', async () => {
    const result = await outcomeOf(`
import * as json from 'json'
import Json from 'json'
import * as runtime from 'runtime'

struct Inner:
  items: Array<Int>
  tags: Map<String, Int>

struct Outer:
  left: Inner
  right: Inner

live async fn main() -> String: await runtime.run(runtime.id()) _main()
ista async fn _main() -> String:
  let o = Outer{left: Inner{items: [1], tags: ["a": 1]}, right: Inner{items: [], tags: [:]}}
  const first = json.stringify(o)
  o.left.items.push(2)
  const second = json.stringify(o)
  o.left.tags["b"] = 2
  drop o.left.tags.delete("a")
  const third = json.stringify(o)
  const kept = o
  o.right.items.push(3)
  let written: Json = json.encode(kept.left)
  match written:
    case Map<String, Json> as fields:
      let changed = fields
      changed["items"] = "gone"
      written = changed
    case _: written = none
  [first, second, third, json.stringify(kept), json.stringify(o), json.stringify(written)].join("|")
`);
    expect(String(JSON.parse(result)).split('|')).toEqual([
      '{"left":{"items":[1],"tags":{"a":1}},"right":{"items":[],"tags":{}}}',
      '{"left":{"items":[1,2],"tags":{"a":1}},"right":{"items":[],"tags":{}}}',
      '{"left":{"items":[1,2],"tags":{"b":2}},"right":{"items":[],"tags":{}}}',
      '{"left":{"items":[1,2],"tags":{"b":2}},"right":{"items":[],"tags":{}}}',
      '{"left":{"items":[1,2],"tags":{"b":2}},"right":{"items":[3],"tags":{}}}',
      '{"items":"gone","tags":{"b":2}}',
    ]);
  });

  it('keeps map keys and map equality intact when a key variable or nested map changes in place', async () => {
    const result = await outcomeOf(`
import * as runtime from 'runtime'

struct Key:
  parts: Array<Int>

live async fn main() -> Array<Int>: await runtime.run(runtime.id()) _main()
ista async fn _main() -> Array<Int>:
  let k = Key{parts: [1, 2]}
  k.parts.push(3)
  let m: Map<Key, Array<Int>> = [:]
  let v = [10, 20]
  v.push(30)
  m[k] = v
  k.parts.push(4)
  v.push(40)
  const originalKey = Key{parts: [1, 2, 3]}
  [
    if originalKey in m: 1 else: 0,
    if k in m: 1 else: 0,
    ...m[originalKey],
    ...k.parts,
    ...v,
  ]
`);
    expect(result).toBe('[1,0,10,20,30,1,2,3,4,10,20,30,40]');
  });

  it('handles self-insertion through slice assignment, recursive structs, and overlapping & paths', async () => {
    const result = await outcomeOf(`
import * as runtime from 'runtime'

struct Node:
  items: Array<Node>
  tag: Int

struct Holder:
  a: Node

fn selfPush(items: &Array<Node>, a: &Node):
  items.push(a)
  a.tag = 99

live async fn main() -> Array<Int>: await runtime.run(runtime.id()) _main()
ista async fn _main() -> Array<Int>:
  let xs = [10, 20, 30]
  xs.push(40)
  xs[1..2] = xs
  let rev = [1, 2, 3]
  rev.push(4)
  rev[.. by -1] = rev
  let h = Holder{a: Node{items: [], tag: 1}}
  h.a.items.push(Node{items: [], tag: 0})
  selfPush(&h.a.items, &h.a)
  [...xs, ...rev, h.a.tag, h.a.items[1].tag, h.a.items[1].items.length()]
`);
    expect(result).toBe('[10,10,20,30,40,30,40,4,3,2,1,99,1,1]');
  });

  it('keeps values sent through slots, inboxes, and resolved futures intact when the sender mutates them', async () => {
    const source = `
import Inbox from 'inbox'
import * as runtime from 'runtime'

ista async fn give(xs: Array<Int>) -> Array<Int>:
  xs

live async fn main() -> Array<Int>: await runtime.run(runtime.id()) _main()
ista async fn _main() -> Array<Int>:
  const box = Inbox.create<Array<Int>>()
  let xs = [1, 2]
  xs.push(3)
  box.send(xs)
  xs.push(4)
  const f = give(xs)
  xs.push(5)
  const received = await box.receive()
  const fromFuture1 = await f
  const fromFuture2 = await f
  [...received, ...fromFuture1, ...fromFuture2, ...xs]
`;
    expect(await outcomeOf(source, false)).toBe('[1,2,3,1,2,3,4,1,2,3,4,1,2,3,4,5]');
    expect(await outcomeOf(source, true)).toBe('[1,2,3,1,2,3,4,1,2,3,4,1,2,3,4,5]');
  });

  it('keeps values captured by spawn and runtime.isolate intact when the caller mutates them before awaiting', async () => {
    const source = `
import * as runtime from 'runtime'

fn unwrap(r: Result<Array<Int>>) -> Array<Int>:
  match r:
    case Ok(xs): xs
    case Err(_): []

ista async fn echo(xs: Array<Int>) -> Array<Int>:
  xs

live async fn main() -> Array<Int>: await runtime.run(runtime.id()) _main()
ista async fn _main() -> Array<Int>:
  let xs = [10, 20]
  xs.push(30)
  const spawned = spawn echo(xs)
  const isolated = runtime.isolate echo(xs)
  xs.push(400)
  xs[0] = 999
  const a = unwrap(await spawned.result())
  const b = unwrap(await isolated)
  [...a, ...b, ...xs]
`;
    expect(await outcomeOf(source, false)).toBe('[10,20,30,10,20,30,999,20,30,400]');
    expect(await outcomeOf(source, true)).toBe('[10,20,30,10,20,30,999,20,30,400]');
  });

  it('keeps values crossing rt.call into and out of a context intact when either side mutates them later', async () => {
    const result = await outcomeOf(`
import * as runtime from 'runtime'

ista const state = new Shared<Array<Int>>{value: [10, 20]}

fn unwrap(r: Result<Array<Int>>) -> Array<Int>:
  match r:
    case Ok(xs): xs
    case Err(_): []

ista async fn echo(xs: Array<Int>) -> Array<Int>:
  xs

ista fn readState() -> Array<Int>:
  state->value.push(30)
  state->value

ista fn mutateState():
  state->value.push(400)
  state->value[0] = 999

ista fn saveState(xs: Array<Int>):
  state->value = xs

ista fn currentState() -> Array<Int>:
  state->value

live async fn main() -> Array<Int>:
  const rt = await runtime.Runtime.open(runtime.hostStore())
  let callerXs = [1, 2]
  callerXs.push(3)
  const pendingCall = rt.call("ctx") echo(callerXs)
  callerXs.push(40)
  callerXs[0] = 90
  const echoed = unwrap(await pendingCall)

  const firstRead = unwrap(await rt.call("ctx") readState())
  _ = await rt.call("ctx") mutateState()

  let sent = [7, 8]
  sent.push(9)
  _ = await rt.call("ctx") saveState(sent)
  sent.push(70)
  sent[0] = 99
  const savedInCtx = unwrap(await rt.call("ctx") currentState())

  [...echoed, ...firstRead, ...savedInCtx]
`);
    expect(result).toBe('[1,2,3,10,20,30,7,8,9]');
  });

  it('keeps a returned outcome intact when defer mutates the local variable on root exit', async () => {
    const fromSpawnDefer = await outcomeOf(`
import * as runtime from 'runtime'

fn unwrap(r: Result<Array<Int>>) -> Array<Int>:
  match r:
    case Ok(xs): xs
    case Err(_): []

ista async fn childWithDefer() -> Array<Int>:
  let xs = [10, 20]
  xs.push(30)
  _ = defer(fn(): {
    xs.push(999)
    xs[0] = 888
  })
  xs

live async fn main() -> Array<Int>: await runtime.run(runtime.id()) _main()
ista async fn _main() -> Array<Int>:
  unwrap(await (spawn(childWithDefer)).result())
`);
    expect(fromSpawnDefer).toBe('[10,20,30]');
  });

  it('keeps a returned outcome intact when context-constant disposal mutates it on instance exit', async () => {
    const fromConstDispose = await outcomeOf(`
import * as runtime from 'runtime'

fn unwrap(r: Result<Array<Int>>) -> Array<Int>:
  match r:
    case Ok(xs): xs
    case Err(_): []

shared struct Hook:
  onExit: Shared<ista fn() -> Unit>

ista fn dispose(self: Hook):
  (self->onExit->value)()

ista const hook = new Hook{onExit: new Shared<ista fn() -> Unit>{value: ista fn(): ()}}

ista async fn childWithConstHook() -> Array<Int>:
  let xs = [10, 20]
  xs.push(30)
  hook->onExit->value = ista fn(): {
    xs.push(999)
    xs[0] = 888
  }
  await runtime.commit()
  xs

live async fn main() -> Array<Int>: await runtime.run(runtime.id()) _main()
ista async fn _main() -> Array<Int>:
  unwrap(await (spawn childWithConstHook()).result())
`);
    expect(fromConstDispose).toBe('[10,20,30]');
  });

  it('keeps a returned outcome intact when a background call cleanup mutates it on instance exit', async () => {
    const fromDisposingCleanup = await outcomeOf(`
import * as runtime from 'runtime'

fn unwrap(r: Result<Array<Int>>) -> Array<Int>:
  match r:
    case Ok(xs): xs
    case Err(_): []

ista async fn background(onDispose: ista fn() -> Unit):
  await background.disposing()
  onDispose()

ista async fn childWithBackground() -> Array<Int>:
  let xs = [10, 20]
  xs.push(30)
  hold _ = background(ista fn(): {
    xs.push(999)
    xs[0] = 888
  })
  xs

live async fn main() -> Array<Int>: await runtime.run(runtime.id()) _main()
ista async fn _main() -> Array<Int>:
  unwrap(await (spawn(childWithBackground)).result())
`);
    expect(fromDisposingCleanup).toBe('[10,20,30]');
  });

  it('keeps a block expression value intact when defer mutates the outer variable at block exit', async () => {
    const result = await outcomeOf(`
import * as runtime from 'runtime'

live async fn main() -> Array<Int>: await runtime.run(runtime.id()) _main()
ista async fn _main() -> Array<Int>:
  let xs = [10, 20]
  xs.push(30)
  const before = {
    _ = defer(fn(): {
      xs.push(999)
      xs[0] = 888
    })
    xs
  }
  [...before, ...xs]
`);
    expect(result).toBe('[10,20,30,888,20,30,999]');
  });

  it('keeps mock call records and mock return values isolated across instances', async () => {
    const reports = await reportsOf(
      testModule(`
fn unwrap(r: Result<Array<Int>>) -> Array<Int>:
  match r:
    case Ok(xs): xs
    case Err(_): []

ista fn record(xs: Array<Int>) -> Array<Int>: xs

ista async fn child() -> Array<Int>:
  let xs = [10, 20]
  xs.push(30)
  const got = record(xs)
  xs.push(999)
  xs[0] = 888
  got

ista async fn mockIsolation():
  let reply = [1, 2]
  reply.push(3)
  const m = mock(record, fn(_xs: Array<Int>) -> Array<Int>: reply)
  const c = spawn child()
  const childGot = unwrap(await c.result())
  reply.push(777)
  assertEq(m.calls(), [([10, 20, 30],)])
  assertEq(childGot, [1, 2, 3])

@Suite{"mock value semantics"}
fn suite() -> Array<Test>: [test("isolation", mockIsolation)]
`),
    );
    expect(outcomesOf(reports)).toEqual(['mock value semantics › isolation: passed']);
  });
});
