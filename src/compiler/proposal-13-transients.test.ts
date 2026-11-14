/**
 * End-to-end verification of transient variables (docs/proposals/13-transients-and-getters.md,
 * spec §3.4): the outermost call of a function makes one, every call nested in it shares it, an
 * async call's included, and the next outermost call starts afresh; with the places, names and
 * initializers checking refuses.
 */

import { describe, expect, it } from 'vitest';
import { outcomesOf, reportsOf, testModule } from '../runtime/testing/testing.test-kit.ts';
import { mainGives } from '../stdlib/prelude/prelude.test-kit.ts';
import { binderDiagnostics } from './binder/diagnostics.ts';
import { reported } from './checker/check.test-kit.ts';
import { checkerDiagnostics } from './checker/diagnostics/index.ts';
import { lines } from './parser/parse.test-kit.ts';

/** Ways up `n` stairs, one or two at a time, counting its own calls in `calls`. */
const paths = lines(
  'fn paths(n: Int, calls: Shared<Int>) -> Int:',
  '  transient let memo: Map<Int, Int> = [:]',
  '  calls->value += 1',
  '  if n <= 1: return 1',
  '  if memo.has(n): return memo[n]',
  '  const total = paths(n - 1, calls) + paths(n - 2, calls)',
  '  memo[n] = total',
  '  total',
);

/** How deep `depth` calls of it nest, each a call deeper than its caller. */
const deepest = lines(
  'fn deepest(depth: Int) -> Int:',
  '  transient let level = 0',
  '  level += 1',
  '  if depth > 0: deepest(depth - 1) else: level',
);

describe('transient variables: one value per outermost call', () => {
  it('shares one memo across a recursion, so it takes linear calls', async () => {
    const body = lines(
      'const calls = new Shared{value: 0}',
      'const ways = paths(30, calls)',
      'const again = paths(30, calls)',
      '(ways, again, calls->value)',
    );
    // The second top-level call starts with an empty memo, making as many calls again.
    expect(await mainGives('(Int, Int, Int)', body, paths)).toEqual([1_346_269, 1_346_269, 118]);
  });

  it('starts afresh at every outermost call', async () => {
    expect(await mainGives('(Int, Int)', '(deepest(3), deepest(1))', deepest)).toEqual([4, 2]);
  });

  it('is shared through other functions, so a non-generic one serves every instance', async () => {
    const declarations = lines(
      'fn nested(callback: fn(Int) -> String) -> String:',
      '  transient let depth = 0',
      '  depth += 1',
      '  _ = defer(fn(): {',
      '    depth -= 1',
      '  })',
      '  callback(depth)',
      'struct Tree<T>:',
      '  label: T',
      '  children: Array<Tree<T>>',
      'fn render<T>(node: Tree<T>, text: fn(T) -> String) -> String:',
      '  nested(fn(depth): {',
      '    const below = node.children.map(fn(child): render(child, text)).join("")',
      '    `${depth}${text(node.label)};${below}`',
      '  })',
      'fn wrapped(node: Tree<Int>) -> String:',
      '  const inner = Tree{label: "x", children: []}',
      '  render(node, fn(n): `${n}${render(inner, fn(s): s)}`)',
    );
    const body = lines(
      'const tree = Tree{label: 1, children: [Tree{label: 2, children: []}]}',
      'wrapped(tree)',
    );
    // `render<String>` called inside `render<Int>` goes one deeper, through the one `nested`.
    expect(await mainGives('String', body, declarations)).toBe('112x;;223x;;');
  });

  it('is one per generic instance of the function declaring it', async () => {
    const declarations = lines(
      'fn tally<T>(value: T, inner: fn() -> Int) -> Int:',
      '  transient let count = 0',
      '  count += 1',
      '  inner() * 10 + count',
    );
    const body = 'tally(1, fn(): tally("a", fn(): tally(2, fn(): 0)))';
    // The inner tally<Int> counts 2 on the outer one's count, which tally<String> doesn't share:
    // 2, then 2 * 10 + 1, then 21 * 10 + 2, the outer count read after the inner call.
    expect(await mainGives('Int', body, declarations)).toBe(212);
  });

  it('is changed through a closure capturing it and through `&`', async () => {
    const declarations = lines(
      'fn bump(n: &Int): n += 1',
      'fn shared(depth: Int) -> Int:',
      '  transient let count = 0',
      '  const add = fn(): {',
      '    count += 10',
      '  }',
      '  add()',
      '  bump(&count)',
      '  if depth > 0: shared(depth - 1) else: count',
    );
    expect(await mainGives('Int', 'shared(2)', declarations)).toBe(33);
  });

  it('is declared by marked and async functions alike', async () => {
    const declarations = lines(
      'ista fn marked(depth: Int) -> Int:',
      '  transient let level = 0',
      '  level += 1',
      '  if depth > 0: marked(depth - 1) else: level',
      'ista async fn waiting(depth: Int) -> Int:',
      '  transient let level = 0',
      '  level += 1',
      '  await runtime.commit()',
      '  if depth > 0: await waiting(depth - 1) else: level',
    );
    expect(await mainGives('(Int, Int)', '(marked(2), await waiting(2))', declarations)).toEqual([
      3, 3,
    ]);
  });

  it('is shared with an async call nested in the outermost one after that has returned', async () => {
    const declarations = lines(
      'ista fn visit(log: Shared<Array<Int>>, depth: Int) -> Array<Future<Unit, "ista">>:',
      '  transient let count = 0',
      '  count += 1',
      '  log->value.push(count)',
      '  if depth == 0: return []',
      '  [revisit(log, depth - 1)]',
      'ista async fn revisit(log: Shared<Array<Int>>, depth: Int):',
      '  await runtime.commit()',
      '  for each in visit(log, depth): await each',
    );
    const body = lines(
      'const log = new Shared<Array<Int>>{value: []}',
      'for each in visit(log, 1): await each',
      'for each in visit(log, 0): await each',
      'log->value',
    );
    expect(await mainGives('Array<Int>', body, declarations)).toEqual([1, 2, 1]);
  });

  it('starts afresh in a spawned instance, and survives a restore at every await', async () => {
    const source = testModule(
      lines(
        "import * as runtime from 'runtime'",
        'ista async fn waiting(depth: Int) -> Int:',
        '  transient let level = 0',
        '  level += 1',
        '  await runtime.commit()',
        '  if depth > 0: await waiting(depth - 1) else: level',
        'ista async fn spawning():',
        '  transient let level = 0',
        '  level += 1',
        '  const child = testing.spawnCrashingEveryAwait(async fn(): await waiting(2))',
        '  assertEq(await child.result(), Ok(3))',
        '  assertEq(level, 1)',
        '@Suite{"transients"}',
        'fn suite() -> Array<Test>: [test("restored", spawning)]',
      ),
    );
    expect(outcomesOf(await reportsOf(source))).toEqual(['transients › restored: passed']);
  });

  it('is released when the outermost call returns, disposing what it holds', async () => {
    const declarations = lines(
      'shared struct Lease:',
      '  log: Shared<Array<String>>',
      'fn dispose(self: Lease): self->log->value.push("disposed")',
      'fn leased(depth: Int, log: Shared<Array<String>>) -> Unit:',
      '  transient let lease: Lease? = none',
      '  if lease == none: lease = new Lease{log}',
      '  log->value.push(`call ${depth}`)',
      '  if depth > 0: leased(depth - 1, log)',
    );
    const body = lines(
      'const log = new Shared<Array<String>>{value: []}',
      'leased(2, log)',
      'log->value.push("after")',
      'log->value',
    );
    expect(await mainGives('Array<String>', body, declarations)).toEqual([
      'call 2',
      'call 1',
      'call 0',
      'disposed',
      'after',
    ]);
  });

  it('is declared by live, generic, local and lambda functions, several in one body', async () => {
    const declarations = lines(
      'live fn liveDepth(n: Int) -> Int:',
      '  transient let d = 0',
      '  d += 1',
      '  if n > 0: liveDepth(n - 1) else: d',
      'fn genericTransient<T>(item: T, rest: Array<T>) -> Int:',
      '  transient let seen: Array<T> = []',
      '  transient let steps = 0',
      '  seen.push(item)',
      '  steps += 1',
      '  for next in rest:',
      '    _ = genericTransient(next, [])',
      '  seen.length() * 10 + steps',
      'fn withLocalAndLambda() -> (Int, Int):',
      '  fn localRec(n: Int) -> Int:',
      '    transient let acc = 0',
      '    acc += n',
      '    if n > 0: localRec(n - 1) else: acc',
      '  const lam = fn self(n: Int) -> Int: {',
      '    transient let acc = 0',
      '    acc += n',
      '    if n > 0: self(n - 1) else: acc',
      '  }',
      '  (localRec(4), lam(4))',
    );
    const body = lines(
      'const a = genericTransient("a", ["b", "c"])',
      'const (b, c) = withLocalAndLambda()',
      '(a, b, c)',
    );
    expect(await mainGives('(Int, Int, Int)', body, declarations)).toEqual([33, 10, 10]);
  });

  it('lives on in an async call nested in the outermost one, disposed when the last ends', async () => {
    const declarations = lines(
      'shared struct Lease:',
      '  log: Shared<Array<String>>',
      'fn dispose(self: Lease): self->log->value.push("disposed")',
      'ista fn startChain(log: Shared<Array<String>>, step: Int) -> Future<Int, "ista">?:',
      '  transient let lease: Lease? = none',
      '  transient let count = 0',
      '  if lease == none: lease = new Lease{log}',
      '  count += 1',
      '  log->value.push(`enter ${step}:${count}`)',
      '  if step == 0: return none',
      '  laterStep(log, step - 1)',
      'ista async fn laterStep(log: Shared<Array<String>>, step: Int) -> Int:',
      '  await runtime.commit()',
      '  const next = startChain(log, step)',
      '  if next != none: _ = await next!',
      '  log->value.push(`exit ${step}`)',
      '  step',
    );
    const body = lines(
      'const log = new Shared<Array<String>>{value: []}',
      'const fut = startChain(log, 2)',
      'log->value.push("outer returned")',
      '_ = await fut!',
      'log->value.push("all done")',
      'log->value',
    );
    expect(await mainGives('Array<String>', body, declarations)).toEqual([
      'enter 2:1',
      'outer returned',
      'enter 1:2',
      'enter 0:3',
      'exit 0',
      'exit 1',
      'disposed',
      'all done',
    ]);
  });
});

/** The codes checking `main.ista` holding `text` reports. */
function codesOf(text: string): readonly number[] {
  return reported(text).codes;
}

const { transientPlace, transientTarget } = checkerDiagnostics;
const { transientReads } = binderDiagnostics;

describe('transient variables: what checking refuses', () => {
  it('stands only at the top of a function body', () => {
    const inBlock = lines('fn f(c: Bool) -> Int:', '  if c:', '    transient let n = 0', '  0');
    const late = lines('fn f() -> Int:', '  const x = 1', '  transient let n = 0', '  x + n');
    const leading = lines(
      'fn f() -> Int:',
      '  transient let a = 0',
      '  transient let b = 1',
      '  a + b',
    );
    expect(codesOf(inBlock)).toContain(transientPlace.code);
    expect(codesOf(late)).toContain(transientPlace.code);
    expect(codesOf(leading)).toEqual([]);
  });

  it("declares one name, read by no variable of its function's", () => {
    const destructured = lines('fn f() -> Int:', '  transient let (a, b) = (1, 2)', '  a + b');
    const readsParameter = lines('fn f(start: Int) -> Int:', '  transient let n = start', '  n');
    const readsTransient = lines(
      'fn f() -> Int:',
      '  transient let a = 0',
      '  transient let b = a',
      '  a + b',
    );
    const readsCapture = lines(
      'fn outer(captured: Int) -> Int:',
      '  fn inner() -> Int:',
      '    transient let x = captured',
      '    x',
      '  inner()',
    );
    expect(codesOf(destructured)).toContain(transientTarget.code);
    expect(codesOf(lines('fn f() -> Int:', '  transient let _ = 0', '  0'))).toContain(
      transientTarget.code,
    );
    expect(codesOf(readsParameter)).toEqual([transientReads.code]);
    expect(codesOf(readsTransient)).toEqual([transientReads.code]);
    expect(codesOf(readsCapture)).toContain(transientReads.code);
  });

  it('reads in its initializer what the module gives a name its variables hide', async () => {
    const declarations = lines(
      'const seed = 42',
      'fn withParam(seed: Int) -> Int:',
      '  transient let memo = seed',
      '  memo + seed',
      'fn withLaterLocal() -> Int:',
      '  transient let memo = seed',
      '  const seed = 10',
      '  memo + seed',
    );
    expect(await mainGives('(Int, Int)', '(withParam(1), withLaterLocal())', declarations)).toEqual(
      [43, 52],
    );
  });

  it('is never dropped, which the calls nested in its outermost one share (§7)', () => {
    const dropped = lines(
      'fn f(step: Int) -> Int:',
      '  transient let shared = 1',
      '  drop shared',
      '  0',
    );
    expect(codesOf(dropped)).toEqual([checkerDiagnostics.notDroppable.code]);
  });

  /** A lambda keeping in a transient the future of `worker`, which every async call holds. */
  const keeper =
    'ista fn(slot: Slot<Unit>): { transient let running: Array<Future<Unit, "ista">> = []; running.push(worker(slot)) }';
  it.each([
    [
      'a function',
      lines(
        'ista fn launch(slot: Slot<Unit>):',
        '  transient let running: Array<Future<Unit, "ista">> = []',
        '  running.push(worker(slot))',
      ),
    ],
    ['a lambda a constant holds', `const launch = ${keeper}`],
    ['a lambda a context constant holds', `ista const launch = ${keeper}`],
    [
      'a lambda a parameter defaults to',
      `ista fn launch(slot: Slot<Unit>, start: ista fn(Slot<Unit>) -> Unit = ${keeper}): start(slot)`,
    ],
    [
      'a lambda a field defaults to',
      lines('struct Launcher:', `  start: ista fn(Slot<Unit>) -> Unit = ${keeper}`),
    ],
  ])(
    'is held by every async call future, so one kept in a transient of %s is a cycle (§7)',
    (_where, keeps) => {
      const worker = lines('ista async fn worker(slot: Slot<Unit>):', '  drop await slot.take()');
      expect(codesOf(lines(worker, keeps))).toEqual([checkerDiagnostics.cycleCall.code]);
    },
  );

  // B86: a recursive group names its inputs whole, so a write behind a shared cell's value is
  // missed, as it is through an explicit `Shared` parameter.
  it.fails('refuses a cycle a recursion closes behind the value a transient holds (§7)', () => {
    const linked = lines(
      'shared struct Lease:',
      '  n: Int',
      'fn dispose(self: Lease):',
      '  _ = self->n',
      'shared struct Node:',
      '  lease: Lease',
      '  next: Node? = none',
      'fn link(x: Node, first: Bool) -> Unit:',
      '  transient let prev: Node? = none',
      '  if first:',
      '    prev = x',
      '    link(x, false)',
      '  elif prev is Node as p:',
      '    p->next = x',
    );
    expect(codesOf(linked)).not.toEqual([]);
  });

  it('modifies a `let` alone', () => {
    expect(codesOf(lines('fn f() -> Int:', '  transient const n = 0', '  n'))).not.toEqual([]);
  });

  it('is never warned about as a `let` nothing changes', () => {
    expect(codesOf(lines('fn f() -> Int:', '  transient let n = 0', '  n'))).toEqual([]);
  });
});
