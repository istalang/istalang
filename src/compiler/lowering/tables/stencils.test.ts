/**
 * Shared instances (§3.5, stencils.ts): a generic function whose code uses a type parameter only
 * opaquely is one entry per representation of the arguments it is given, a primitive its own, and
 * each of them runs as the instance of its own type would; a parameter whose type tells, as a union
 * naming it does, stays one entry per type.
 */

import { describe, expect, it } from 'vitest';
import { slowTestTimeout } from '../../../../test/timeouts.ts';
import { mainGives } from '../../../stdlib/prelude/prelude.test-kit.ts';
import { compiledEncoded } from '../../compile.test-kit.ts';

/** A disposable whose disposal counts itself in `count`. */
const lease = `shared struct Lease:
  count: Shared<Int>
fn dispose(self: Lease): self->count->value = self->count->value + 1`;

/** The names of the entries of a program calling `calls` from `_main`, beside `declarations`. */
function entryNames(declarations: string, calls: readonly string[]): readonly string[] {
  const program = [
    declarations,
    lease,
    "import * as runtime from 'runtime'",
    'live async fn main() -> Int: await runtime.run(runtime.id()) _main()',
    'ista async fn _main() -> Int:',
    ...calls.map((call) => `  drop ${call}`),
    '  0',
  ].join('\n');
  return compiledEncoded(program).definition.functions.map((entry) => entry.name);
}

/** A call of `name` at a value of each representation: two primitives, two of heap, two counted. */
function callsAtEveryClass(name: string): readonly string[] {
  return [
    `${name}(1)`,
    `${name}("s")`,
    `${name}([1])`,
    `${name}((1, "s"))`,
    `${name}(new Lease{count: new Shared<Int>{value: 0}})`,
    `${name}(fn() -> Int: 1)`,
  ];
}

describe('a generic function using its type parameter only opaquely', () => {
  it('is one entry per representation, a stand-in named by its parameter', {
    timeout: slowTestTimeout,
  }, () => {
    const names = entryNames('fn keep<T>(x: T) -> (T, T): (x, x)', callsAtEveryClass('keep'));
    expect(names.filter((name) => name.startsWith('main.keep')).sort()).toEqual([
      'main.keep<Int>',
      'main.keep<String>',
      'main.keep<T>',
      'main.keep<T>',
    ]);
  });

  it('leaves a heap value it copied as its caller holds it, changed in place by one holder only', {
    timeout: slowTestTimeout,
  }, async () => {
    const body = 'let pair = keep([1])\npair.0.push(2)\npair.1.length()';
    expect(await mainGives('Int', body, 'fn keep<T>(x: T) -> (T, T): (x, x)')).toBe(1);
  });

  it('disposes a counted value once its last holder lets go of it', {
    timeout: slowTestTimeout,
  }, async () => {
    const body = [
      'const count = new Shared<Int>{value: 0}',
      'const pair = keep(new Lease{count})',
      'drop pair',
      'count->value',
    ].join('\n');
    expect(await mainGives('Int', body, `${lease}\nfn keep<T>(x: T) -> (T, T): (x, x)`)).toBe(1);
  });
});

describe('a generic function whose type parameter a union names', () => {
  it('is one entry per type', { timeout: slowTestTimeout }, () => {
    const names = entryNames('fn wrap<T>(x: T) -> T?: x', ['wrap(1)', 'wrap("s")']);
    expect(names.filter((name) => name.startsWith('main.wrap'))).toEqual([
      'main.wrap<Int>',
      'main.wrap<String>',
    ]);
  });
});
