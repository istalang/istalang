/**
 * Formatting indented values (proposal 5 §1, notes 4 and 11): an indented value is printed as
 * written, never turned into braces/brackets or back; comments and blank lines inside it are
 * preserved; and formatting is a fixpoint that reparses to the same syntax tree.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { lines, roundTripOf, unexplainedLongLines } from '../format.test-kit.ts';
import { formatText } from '../format.ts';

describe('formatting indented values as written (§1, note 4)', () => {
  it('prints a complex indented value with nested structs, maps, arrays, shorthands and spreads as written', () => {
    const text = lines(
      'struct Service:',
      '  name: String',
      '  replicas: Int = 1',
      '  ports: Array<Int>',
      '  env: Map<String, String>',
      '  retry: Retry =',
      '    times: 3',
      '    backoffMs: 200',
      '',
      'const api = Service:',
      '  ...base',
      '  name',
      '  ports:',
      '    - 80',
      '    - 443',
      '    - -1',
      '    - ...extraPorts',
      '  env:',
      '    "LOG_LEVEL": "debug"',
      '    "x-region": "eu"',
      '  retry:',
      '    times: 3',
      '    backoffMs: 200',
    );
    expect(formatText(text)).toBe(text);
    const { actual, expected, reparsed } = roundTripOf(text);
    expect(actual).toEqual(expected);
    expect(unexplainedLongLines(reparsed)).toEqual([]);
  });

  it('prints anonymous indented values after "=", "return", "key:", "-" and "- key: value", plus "new T:" and comprehensions', () => {
    const text = lines(
      'fn build(rest: Settings) -> Array<Service>:',
      '  const c = new Counter:',
      '    count: 1',
      '  const mapped: Settings =',
      '    id: "main"',
      '    for field, node in ...rest: [field]: node',
      '  return',
      '    - name: "api"',
      '      port: 80',
      '      retry: Retry:',
      '        times: 3',
      '        backoffMs: 200',
      '    - Service:',
      '        name: "worker"',
      '        port: 90',
      '    -',
      '      name: "cron"',
      '      port: 100',
    );
    expect(formatText(text)).toBe(text);
    const { actual, expected } = roundTripOf(text);
    expect(actual).toEqual(expected);
  });

  it('keeps entries written on one line on that line, and each line of entries as written', () => {
    const text = lines(
      'const x: R =',
      '  a: 1, b: 2',
      '  c: 3',
      '',
      '  d: 4, e: 5 # trailing',
      'const api = Service:',
      '  retry: Retry:',
      '    times: 3, backoffMs: 200',
      '  ports:',
      '    - 80',
      '    - key: "k", count: 3',
    );
    expect(formatText(text)).toBe(text);
    const { actual, expected } = roundTripOf(text);
    expect(actual).toEqual(expected);
  });

  it("keeps a comment on an item's '-' line with the item, and one space before a comment after an opening", () => {
    const text = lines(
      'const xs =',
      '  - # nested items',
      '    - 1',
      '    - 2',
      'const c: Config = # after the =',
      '  retries: 3',
      'fn f() -> Config:',
      '  return # after return',
      '    retries: 3',
      'const d: Config =',
      '  retry: # after the key',
      '    times: 3',
    );
    expect(formatText(text)).toBe(text);
    const { actual, expected } = roundTripOf(text);
    expect(actual).toEqual(expected);
  });

  it('never turns brace/bracket literals into indented values or indented values into braces/brackets', () => {
    const braced = lines('const a = Service{name: "api", ports: [80, 443]}');
    expect(formatText(braced)).toBe(braced);
    const indented = lines(
      'const a = Service:',
      '  name: "api"',
      '  ports:',
      '    - 80',
      '    - 443',
    );
    expect(formatText(indented)).toBe(indented);
  });

  it('preserves comments and blank lines inside indented values and reaches a fixpoint on generated inputs', () => {
    const entryArb = fc.constantFrom(
      '  # comment on entry\n  a: 1',
      '  key: "val"',
      '  shorthand',
      '  ...spreadVal',
      '  nested:\n    # nested comment\n    inner: 42',
      '  items:\n    - 1\n    - -2\n    - key: "k"\n      count: 3',
      '  items:\n    - # nested\n      - 1\n      - 2',
      '  opened: # after the key\n    inner: 1',
      '  a: 1, b: 2',
    );
    fc.assert(
      fc.property(fc.array(entryArb, { minLength: 1, maxLength: 5 }), (entries) => {
        const text = `const v = Config:\n${entries.join('\n\n')}\n`;
        const { actual, expected, reparsed } = roundTripOf(text);
        expect(actual).toEqual(expected);
        expect(unexplainedLongLines(reparsed)).toEqual([]);
      }),
      { numRuns: 40 },
    );
  });
});
