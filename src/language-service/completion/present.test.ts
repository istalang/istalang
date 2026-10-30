/**
 * How items show beyond their names: which one the list opens on, the order of an enum's
 * variants, and what accepting a callable, a variant or an annotation writes, as the text around
 * the cursor decides.
 */

import { describe, expect, it } from 'vitest';
import { programAt } from '../language-service.test-kit.ts';
import { completionsAt } from './index.ts';
import { type Completion, ranksBefore } from './item.ts';

const declarations = [
  "import JsonSkip from 'json'",
  'enum Color { Red; Green; Blue }',
  'enum Decision { Approved; Rejected { by: string } }',
  'struct Note:',
  '  reason: string',
  'fn Color.mixed() -> Color: Color.Red',
  'fn pl(a: int) -> int: a',
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
      preselected('fn t(r: Result<int, string>) -> int:', '  if r is ‸', '  0'),
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
      namesAmong(['Ok', 'Err'], 'fn t(r: Result<int, string>) -> int:', '  if r is ‸', '  0'),
    ).toEqual(['Ok', 'Err']);
    expect(namesAmong(['Some', 'None'], 'fn t(o: int?) -> int:', '  if o is ‸', '  0')).toEqual([
      'Some',
      'None',
    ]);
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
  it("opens a call or a variant's braces unless the same line already does", () => {
    const call = { insert: { kind: 'snippet', snippet: 'pl($0)' }, next: 'signatureHelp' };
    expect(insertOf('pl', 'fn t():', '  pl‸', '  (1, 2)')).toEqual(call);
    expect(insertOf('pl', 'fn t():', '  pl‸(1)')).toEqual({ insert: undefined, next: undefined });
    const braces = { insert: { kind: 'snippet', snippet: 'Rejected{$0}' }, next: 'completion' };
    expect(insertOf('Rejected', 'fn t():', '  Decision.‸', '  {', '    1', '  }')).toEqual(braces);
  });

  it("opens an annotation's braces where its struct has fields", () => {
    const braces = { insert: { kind: 'snippet', snippet: 'Note{$0}' }, next: 'completion' };
    expect(insertOf('Note', '@‸', 'fn g(): 1')).toEqual(braces);
    expect(insertOf('JsonSkip', '@‸', 'fn g(): 1')).toEqual({ insert: undefined, next: undefined });
  });
});
