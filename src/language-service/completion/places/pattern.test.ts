/**
 * Completion in a pattern offers what fits the value it matches: every start it offers for a
 * corpus `case` or `is` pattern, written there, makes no error in it, and every corpus struct
 * pattern, emptied, offers the fields it named and none it can't name. Examples hold the positions
 * the scenario catalogue doesn't: around a whole pattern, inside tuples, arrays and fields, against
 * an `any` value, and the variants other cases already cover.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { runPrograms } from '../../../../test/corpus/programs.ts';
import { checkProgram } from '../../../compiler/checker/check.ts';
import { extentIn, nodesUnder } from '../../../compiler/syntax/tree.ts';
import { type Diagnostic, isError } from '../../../diagnostics/diagnostic.ts';
import { checkedModule } from '../../checked-module.ts';
import { mainProgram, programAt } from '../../language-service.test-kit.ts';
import type { Candidate } from '../candidate.ts';
import { cursorAt } from '../cursor.ts';
import { completionsAt } from '../index.ts';
import { placeAt } from '../place.ts';
import { offerPattern } from './pattern.ts';

/** Where a pattern stands in a corpus program's text. */
interface Site {
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

/** The patterns `case` and `is` test in the corpus's programs, with their programs' trees. */
const tested = runPrograms.flatMap(({ text }) => {
  const { tree } = mainProgram(text);
  return nodesUnder(tree, tree.root).flatMap((node) =>
    node.kind === 'MatchCase' || node.kind === 'Is' ? [{ text, tree, pattern: node.pattern }] : [],
  );
});

const patternSites: readonly Site[] = tested.map(({ text, tree, pattern }) => ({
  text,
  ...extentIn(tree, pattern),
}));

/** The struct patterns among them naming their type, with the `{` opening their fields. */
const fieldSites = tested.flatMap(({ text, tree, pattern }) =>
  nodesUnder(tree, pattern).flatMap((node) => {
    if (node.kind !== 'StructPattern' || node.type === undefined) {
      return [];
    }
    const { start, end } = extentIn(tree, node);
    const named = node.fields.flatMap((item) => (item.kind === 'Invalid' ? [] : [item.field.text]));
    return [{ text, start, end, open: text.indexOf('{', start) + 1, named }];
  }),
);

/** The errors `text` makes from `start` to `end` once checked. */
function errorsIn(text: string, start: number, end: number): readonly Diagnostic[] {
  const { program, module } = mainProgram(text);
  return checkProgram(program)
    .diagnosticsOf(module)
    .filter((each) => isError(each) && start <= each.span.start && each.span.end <= end);
}

/** What the pattern provider offers at `offset` of `text`; nothing at a place of another kind. */
function candidatesIn(text: string, offset: number): readonly Candidate[] {
  const { program, module } = mainProgram(text);
  const checked = checkedModule(program, module);
  if (checked === undefined) {
    throw new Error('the program holds no main module');
  }
  const cursor = cursorAt(checked, offset, undefined, []);
  const place = placeAt(cursor);
  return place.kind === 'pattern' ? offerPattern(cursor, place) : [];
}

/**
 * The errors each value offered where `site`'s pattern starts makes, written in its stead: a
 * variant with fields with empty braces, a keyword as it is. Names that refer on only with more
 * written after them, a type's or a namespace's, are aside.
 */
function misfitsOf({ text, start, end }: Site): readonly string[] {
  const emptied = text.slice(0, start) + text.slice(end);
  return candidatesIn(emptied, start).flatMap(({ name, subject }) => {
    if (subject.kind !== 'variant' && subject.kind !== 'keyword') {
      return [];
    }
    const written =
      subject.kind === 'variant' && subject.variant.fields.length > 0 ? `${name}{}` : name;
    const probed = text.slice(0, start) + written + text.slice(end);
    return errorsIn(probed, start, start + written.length).map(
      ({ message }) => `${written}: ${message}`,
    );
  });
}

/** A field unknown to the pattern's type (5013), or one tested twice (5015). */
const fieldMistakes = new Set([5013, 5015]);

/**
 * What the fields offered in `site`'s struct pattern, emptied, leave wrong: a field it named that
 * isn't offered, and the field mistakes the offered ones make, each written in as `field is _`.
 */
function fieldMisfitsOf({ text, start, end, open, named }: (typeof fieldSites)[number]) {
  const close = end - 1;
  const emptied = mainProgram(text.slice(0, open) + text.slice(close));
  const offered = completionsAt(emptied.program, emptied.module, open, { trigger: '{' }).map(
    ({ name }) => name,
  );
  const items = offered.map((name) => `${name} is _`).join(', ');
  const probed = text.slice(0, open) + items + text.slice(close);
  return [
    ...named.filter((name) => !offered.includes(name)).map((name) => `${name} not offered`),
    ...errorsIn(probed, start, open + items.length + 1)
      .filter(({ code }) => fieldMistakes.has(code))
      .map(({ message }) => message),
  ];
}

describe('pattern completion offers what fits the matched value', () => {
  it('at the start of the corpus patterns', () => {
    fc.assert(
      fc.property(fc.constantFrom(...patternSites), (site) => {
        expect(misfitsOf(site)).toEqual([]);
      }),
      { numRuns: 30 },
    );
  }, 60_000);

  it("in the corpus struct patterns' braces", () => {
    fc.assert(
      fc.property(fc.constantFrom(...fieldSites), (site) => {
        expect(fieldMisfitsOf(site)).toEqual([]);
      }),
      { numRuns: 30 },
    );
  }, 60_000);
});

const decision = [
  'enum Decision:',
  '  Approved { by: string }',
  '  Rejected { by: string; reason: string }',
  '  Expired',
  '',
];

function labelsAt(...lines: readonly string[]): readonly string[] {
  const { program, module, offset } = programAt(...lines, '  0');
  return completionsAt(program, module, offset).map(({ name }) => name);
}

describe('a pattern place', () => {
  it('offers a guard or a binding of the whole after a whole pattern, a space between', () => {
    const cases = [...decision, 'fn f(d: Decision, n: int) -> int:'];
    expect(labelsAt(...cases, '  match d:', '    case Approved{by} ‸')).toEqual(['if', 'as']);
    expect(labelsAt(...cases, '  match d:', '    case Approved{by}‸')).toEqual([]);
    expect(labelsAt(...cases, '  match n:', '    case 0..= ‸')).toEqual([]);
    expect(labelsAt(...cases, '  match n:', '    case .. ‸')).toEqual([]);
    expect(labelsAt(...cases, '  match n:', '    case + ‸')).toEqual([]);
  });

  it("reads the type a tuple's element, an array's item or a nested field matches", () => {
    const nested = (subject: string, pattern: string) =>
      labelsAt(...decision, `fn f(x: ${subject}) -> int:`, '  match x:', `    case ${pattern}`);
    expect(nested('(int, Decision)', '(_, ‸')).toContain('Approved');
    expect(nested('Array<Decision>', '[‸')).toContain('Approved');
    expect(nested('Decision?', 'Some{value is ‸')).toContain('Approved');
  });

  it('marks the variants unguarded cases take whole as covered', () => {
    const marked = [
      ...decision,
      'fn f(d: Decision, a: bool) -> int:',
      '  match d:',
      '    case Approved{by}: 1',
      '    case Rejected{reason == "late"}: 2',
      '    case Expired if a: 3',
      '    case ‸',
      '  0',
    ].join('\n');
    const covered = candidatesIn(marked.replace('‸', ''), marked.indexOf('‸')).flatMap(
      ({ name, covered: is }) => (is ? [name] : []),
    );
    expect(covered).toEqual(['Approved']);
  });

  it('offers the types a downcast may name against an `any` value, those meeting its traits', () => {
    const labels = labelsAt(
      'trait Named:',
      '  fn name(self: Self) -> string',
      '',
      'struct Marker',
      'struct Plain',
      'struct Box<T> { value: T }',
      'fn name(self: Marker) -> string: "marker"',
      'fn name<T>(self: Box<T>) -> string: "box"',
      '',
      'fn f(x: any Named) -> int:',
      '  match x:',
      '    case ‸',
    );
    expect(labels).toContain('Marker');
    expect(labels).not.toContain('Box');
    expect(labels).not.toContain('Plain');
  });

  it("offers a struct's fields, but those its pattern names, in its braces", () => {
    const struct = ['struct Pair:', '  first: int', '  second: int', '', 'fn f(p: Pair) -> int:'];
    expect(labelsAt(...struct, '  match p:', '    case Pair{first, ‸')).toEqual(['second']);
    expect(labelsAt(...struct, '  match p:', '    case struct{‸')).toEqual(['first', 'second']);
  });

  it("offers no fields in braces naming what the matched value can't be", () => {
    const struct = [
      'struct Pair:',
      '  first: int',
      '  second: int',
      '',
      'enum Color { Red; Green }',
    ];
    const cases = [...struct, ...decision, 'fn f(p: Pair, d: Decision) -> int:'];
    expect(labelsAt(...cases, '  match p:', '    case Wrong{‸')).toEqual([]);
    expect(labelsAt(...cases, '  match p:', '    case Some{‸')).toEqual([]);
    expect(labelsAt(...cases, '  match d:', '    case Color.Rejected{‸')).toEqual([]);
    expect(labelsAt(...cases, '  match d:', '    case Decision.Rejected{‸')).toEqual([
      'by',
      'reason',
    ]);
    const unfinished = ['  match (1, d, 2):', '    case (1, Rejected{‸'];
    expect(labelsAt(...cases, ...unfinished)).toEqual(['by', 'reason']);
  });

  it("offers a downcast's fields against an `any` value, where it may downcast", () => {
    const named = [
      'trait HasId:',
      '  id: string',
      '',
      'struct User { id: string; name: string }',
      'struct Box<T> { id: string; value: T }',
      ...decision,
      'fn f(x: any HasId) -> int:',
      '  match x:',
    ];
    expect(labelsAt(...named, '    case User{‸')).toEqual(['id', 'name']);
    expect(labelsAt(...named, '    case struct{‸')).toEqual([]);
    expect(labelsAt(...named, '    case Box{‸')).toEqual([]);
    expect(labelsAt(...named, '    case Rejected{‸')).toEqual([]);
  });
});
