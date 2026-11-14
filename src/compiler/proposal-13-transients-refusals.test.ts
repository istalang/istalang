/**
 * End-to-end verification of what checking refuses of transient variables
 * (docs/proposals/13-transients-and-getters.md, spec §3.4): where one stands, what it declares and
 * what its initializer reads, and the cycles a value kept in one closes (§7).
 */

import { describe, expect, it } from 'vitest';
import { mainGives } from '../stdlib/prelude/prelude.test-kit.ts';
import { binderDiagnostics } from './binder/diagnostics.ts';
import { reported } from './checker/check.test-kit.ts';
import { checkerDiagnostics } from './checker/diagnostics/index.ts';
import { lines } from './parser/parse.test-kit.ts';

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

  it.each([
    [
      'a top-level',
      lines('ista async fn worker() -> Int:', '  transient let done = worker.disposing()', '  0'),
    ],
    [
      'a local',
      lines(
        'ista async fn outer() -> Int:',
        '  ista async fn worker() -> Int:',
        '    transient let done = worker.disposing()',
        '    0',
        '  await worker()',
      ),
    ],
  ])(
    "reads in its initializer no own call of %s function's, a variable of it (§7)",
    (_where, text) => {
      expect(codesOf(text)).toContain(transientReads.code);
    },
  );

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
    [
      'a local function in a field loop',
      lines(
        'struct Box:',
        '  a: Int',
        'ista fn launch(slot: Slot<Unit>, box: Box):',
        '  for _, _ in ...box:',
        '    ista fn inner():',
        '      transient let running: Array<Future<Unit, "ista">> = []',
        '      running.push(worker(slot))',
        '    inner()',
      ),
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
