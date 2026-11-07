/**
 * How items show beyond their names: which one the list opens on, the order of an enum's
 * variants, and what accepting a callable, a variant or an annotation writes, as the text around
 * the cursor decides.
 */

import { describe, expect, it } from 'vitest';
import { programAt } from '../../language-service.test-kit.ts';
import { completionsAt } from '../index.ts';
import { type Completion, ranksBefore } from './item.ts';

const declarations = [
  "import JsonSkip from 'json'",
  'enum Color { Red, Green, Blue }',
  'enum Decision { Approved, Rejected(by: String) }',
  'struct Note:',
  '  reason: String',
  'fn Color.mixed() -> Color: Color.Red',
  'fn pl(a: Int) -> Int: a',
  '',
];

/** The completions at the cursor in `lines`, in the order the list shows them. */
function listed(...lines: readonly string[]): readonly Completion[] {
  const { program, module, offset } = programAt(...declarations, ...lines);
  return completionsAt(program, module, offset).toSorted((a, b) => (ranksBefore(a, b) ? -1 : 1));
}

function preselected(...lines: readonly string[]): string | undefined {
  return listed(...lines).find(({ preselect }) => preselect)?.name;
}

function namesAmong(names: readonly string[], ...lines: readonly string[]): readonly string[] {
  return listed(...lines)
    .map(({ name }) => name)
    .filter((name) => names.includes(name));
}

function insertOf(name: string, ...lines: readonly string[]) {
  const item = listed(...lines).find((each) => each.name === name);
  return item && { insert: item.insert, next: item.next };
}

describe('the item a list opens on', () => {
  it('is the first fitting local or module item', () => {
    expect(preselected('fn t(col: Color):', '  let c: Color = ‸')).toBe('col');
    expect(preselected('fn t():', '  let c: Color = ‸')).toBe('Red');
  });

  it('is none where only prelude or imported items fit', () => {
    expect(preselected('fn t() -> Note:', '  Note{reason: ‸}')).toBeUndefined();
    expect(
      preselected('fn t(r: Result<Int, String>) -> Int:', '  if r is ‸', '  0'),
    ).toBeUndefined();
  });
});

describe("an enum's variants", () => {
  it('rank in the order their enum declares them', () => {
    expect(namesAmong(['Red', 'Green', 'Blue'], 'fn t():', '  let c: Color = ‸')).toEqual([
      'Red',
      'Green',
      'Blue',
    ]);
    expect(
      namesAmong(['Ok', 'Err'], 'fn t(r: Result<Int, String>) -> Int:', '  if r is ‸', '  0'),
    ).toEqual(['Ok', 'Err']);
    expect(
      namesAmong(['Red', 'Green', 'Blue'], 'fn t(c: Color?) -> Int:', '  if c is ‸', '  0'),
    ).toEqual(['Red', 'Green', 'Blue']);
  });

  it("come before the enum's statics after its name", () => {
    expect(namesAmong(['Red', 'Green', 'Blue', 'mixed'], 'fn t():', '  Color.‸')).toEqual([
      'Red',
      'Green',
      'Blue',
      'mixed',
    ]);
  });
});

describe('what accepting an item writes', () => {
  it("opens a function's or a variant's call unless the same line already opens it", () => {
    const nothing = { insert: undefined, next: undefined };
    const call = { insert: { kind: 'snippet', snippet: 'pl($0)' }, next: 'signatureHelp' };
    expect(insertOf('pl', 'fn t():', '  pl‸', '  (1, 2)')).toEqual(call);
    expect(insertOf('pl', 'fn t():', '  pl‸(1)')).toEqual(nothing);
    expect(insertOf('pl', 'fn t():', '  ‸(1)')).toEqual(nothing);
    const built = { insert: { kind: 'snippet', snippet: 'Rejected($0)' }, next: 'signatureHelp' };
    expect(insertOf('Rejected', 'fn t():', '  Decision.‸', '  {', '    1', '  }')).toEqual(built);
    expect(insertOf('Rejected', 'fn t():', '  Decision.Rej‸{by: "x"}')).toEqual(nothing);
    const taken = { insert: { kind: 'snippet', snippet: 'Rejected($0)' }, next: 'completion' };
    expect(insertOf('Rejected', 'fn t(d: Decision):', '  match d:', '    case Rej‸')).toEqual(
      taken,
    );
  });

  it('asks for the fields next after a variant qualified in a pattern', () => {
    const taken = { insert: { kind: 'snippet', snippet: 'Rejected($0)' }, next: 'completion' };
    const cases = ['fn t(d: Decision):', '  match d:'];
    expect(insertOf('Rejected', ...cases, '    case Decision.Rej‸')).toEqual(taken);
  });

  it("writes an argument's label alone where its `:` already follows", () => {
    const decls = 'enum Verdict { Approved, Rejected(by: String, reason: String = "none") }';
    const called = insertOf(
      'reason:',
      decls,
      'fn t() -> Verdict: Verdict.Rejected(by: "x", rea‸: "r")',
    );
    expect(called).toEqual({ insert: { kind: 'text', text: 'reason' }, next: undefined });
    const cases = [decls, 'fn t(v: Verdict) -> Int:', '  match v:'];
    expect(insertOf('reason:', ...cases, '    case Rejected(rea‸: "r"): 1')).toEqual({
      insert: { kind: 'text', text: 'reason' },
      next: undefined,
    });
  });

  it('ranks first the functions and constructors a function value expected fits (§3.14)', () => {
    const decls = [
      'enum Choice { Plain, Other(n: Int), Picked(by: String, why: String = "") }',
      'fn shout(s: String) -> Choice: Choice.Picked(s)',
      'fn count(n: Int) -> Choice: Choice.Other(n)',
    ];
    const fitting = (...lines: readonly string[]) =>
      listed(...decls, ...lines)
        .filter(({ rank }) => rank?.fitsExpected === true)
        .map(({ name }) => name);
    expect(fitting('const r: fn(String) -> Choice = Choice.‸')).toEqual(['Picked']);
    expect(fitting('const r: fn(String) -> Choice = ‸')).toEqual(
      expect.arrayContaining(['Picked', 'shout']),
    );
    expect(fitting('const r: fn(String) -> Choice = ‸')).not.toContain('count');
  });

  it('writes a function or a variant alone where a function value is expected (§3.14)', () => {
    const nothing = { insert: undefined, next: undefined };
    expect(insertOf('pl', 'fn t(xs: Array<Int>):', '  _ = xs.map(p‸)')).toEqual(nothing);
    expect(insertOf('pl', 'const f: fn(Int) -> Int = p‸')).toEqual(nothing);
    expect(insertOf('Rejected', 'const r: fn(String) -> Decision = Decision.‸')).toEqual(nothing);
    expect(insertOf('Rejected', 'const r: fn(String) -> Decision = Rej‸')).toEqual(nothing);
    const call = { insert: { kind: 'snippet', snippet: 'pl($0)' }, next: 'signatureHelp' };
    expect(insertOf('pl', 'fn t() -> Int: p‸')).toEqual(call);
  });

  it("opens an annotation's braces where its struct has fields", () => {
    const braces = { insert: { kind: 'snippet', snippet: 'Note{$0}' }, next: 'completion' };
    expect(insertOf('Note', '@‸', 'fn g(): 1')).toEqual(braces);
    expect(insertOf('JsonSkip', '@‸', 'fn g(): 1')).toEqual({ insert: undefined, next: undefined });
  });
});
