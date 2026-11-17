/**
 * Validation (index.ts) refuses a Definition whose purpose names code its caller may not call
 * (foundation/language/call-rule.ts): a test's suites are what ista code calls. A host starts a
 * start by key, so a key names one start, `main`'s included. A recursive alias stands for the tuple or
 * function it unfolds to.
 */

import { describe, expect, it } from 'vitest';
import { stdProgramOf } from '../../compiler/binder/bind.test-kit.ts';
import { compileTests } from '../../compiler/compile.ts';
import { codeEntry, programOf, withModeChanged } from '../definition.test-kit.ts';
import { encodeDefinition, readDefinition } from '../definition.ts';
import type { TypeDefinition, TypeReference } from '../tables/types.ts';
import { validationIssues } from './index.ts';

describe('the call rule over the purpose', () => {
  it("refuses a test's suite that ista code may not call", () => {
    const compiled = compileTests(
      stdProgramOf({
        'main.test.ista': [
          "import Suite, Test, test from 'testing'",
          'fn passes() -> Unit: ()',
          '@Suite{"s"}',
          'fn suite() -> Array<Test>: [test("t", passes)]',
        ].join('\n'),
      }),
    );
    if (compiled.kind !== 'compiled') {
      throw new Error(`The test module didn't compile (${compiled.kind}).`);
    }
    const encoded = encodeDefinition(compiled.definition);
    expect(() => readDefinition(encoded.bytes)).not.toThrow();
    const changed = withModeChanged(encoded, {
      name: 'main.test.ista.suite',
      from: 'simple',
      to: 'live',
    });
    expect(() => readDefinition(changed.bytes)).toThrow(
      'suite s: ista code may not call main.test.ista.suite.',
    );
  });
});

describe('the starts', () => {
  const program = programOf([codeEntry([], [{ kind: 'unreachable', span: { start: 0, end: 0 } }])]);
  const start = (key: string) => ({ key, function: 0, encode: 0 });

  it('refuses two starts of one key', () => {
    const issues = validationIssues({ ...program, starts: [start('f()'), start('f()')] });
    expect(issues).toContain('start f(): another start has its key.');
  });

  it('refuses a main naming no start', () => {
    const issues = validationIssues({
      ...program,
      starts: [start('f()')],
      purpose: { kind: 'program', main: 'main()' },
    });
    expect(issues).toContain('main: no start has key main().');
  });

  it('passes a main naming a start', () => {
    const issues = validationIssues({
      ...program,
      starts: [start('main()')],
      purpose: { kind: 'program', main: 'main()' },
    });
    expect(issues).toEqual([]);
  });
});

describe('a recursive alias', () => {
  const program = programOf([codeEntry([], [{ kind: 'unreachable', span: { start: 0, end: 0 } }])]);
  const alias = (type: TypeReference): TypeDefinition => ({
    kind: 'alias',
    name: 'A',
    arguments: [],
    disposable: false,
    heap: true,
    type,
  });
  const int: TypeReference = { kind: 'primitive', name: 'Int' };

  it.each<[string, TypeReference]>([
    ['itself', { kind: 'named', type: 0 }],
    ['a primitive', int],
  ])('refuses one aliasing %s', (_, type) => {
    expect(validationIssues({ ...program, types: [alias(type)] })).toContain(
      'type 0 (A): it aliases no tuple or function.',
    );
  });

  it.each<[string, TypeReference]>([
    ['a tuple', { kind: 'tuple', elements: [int, { kind: 'named', type: 0 }] }],
    ['a function', { kind: 'function', parameters: [int], result: { kind: 'named', type: 0 } }],
  ])('passes one aliasing %s', (_, type) => {
    expect(validationIssues({ ...program, types: [alias(type)] })).toEqual([]);
  });
});
