/**
 * Completion in a pattern offers what fits the value it matches: every start it offers for a
 * corpus `case` or `is` pattern, written there, makes no error in it, and the word the pattern
 * starts with is among them; every corpus struct pattern, emptied, offers the fields it named and
 * none it can't name. Examples hold the positions
 * the scenario catalogue doesn't: around a whole pattern, inside tuples, arrays and fields, against
 * an `any` value, and the variants other cases already cover.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { runPrograms } from '../../../../../../test/corpus/programs.ts';
import { slowTestTimeout } from '../../../../../../test/timeouts.ts';
import { checkProgram } from '../../../../../compiler/checker/check.ts';
import { patternHead } from '../../../../../compiler/syntax/patterns.ts';
import { extentIn, nodesUnder } from '../../../../../compiler/syntax/tree/index.ts';
import { type Diagnostic, isError } from '../../../../../foundation/diagnostics/diagnostic.ts';
import type { Span } from '../../../../../foundation/text/span.ts';
import { editedMainProgram, mainProgram } from '../../../language-service.test-kit.ts';
import { checkedModule } from '../../../reading/checked-module.ts';
import type { Candidate } from '../../candidate.ts';
import { cursorAt } from '../../cursor.ts';
import { completionsAt } from '../../index.ts';
import { placeAt } from '../../place.ts';
import { decision, labelsAt } from './pattern.test-kit.ts';
import { offerPattern } from './pattern.ts';

/** Where a pattern stands in a corpus program's text. */
interface Site {
  readonly text: string;
  readonly start: number;
  readonly end: number;
  /**
   * Whether its name is given type arguments, `Some<Int>(n)`, which select among a union's
   * instances of one generic type where the name alone, as offered, would match several (§11.3).
   */
  readonly typed: boolean;
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
  typed: (patternHead(pattern)?.typeArguments.length ?? 0) > 0,
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

/** The errors `text`, an edit of the corpus program `corpus`, makes from `start` to `end`. */
function errorsIn(
  corpus: string,
  text: string,
  start: number,
  end: number,
): readonly Diagnostic<Span, string>[] {
  const { program, module } = editedMainProgram(text, corpus);
  return checkProgram(program)
    .diagnosticsOf(module)
    .filter((each) => isError(each) && start <= each.span.start && each.span.end <= end);
}

/** What a pattern place offers at `offset` of `text`, an edit of `corpus` if given; else none. */
function candidatesIn(text: string, offset: number, corpus?: string): readonly Candidate[] {
  const { program, module } = corpus ? editedMainProgram(text, corpus) : mainProgram(text);
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
  return candidatesIn(emptied, start, text).flatMap(({ name, subject }) => {
    if (subject.kind !== 'variant' && subject.kind !== 'keyword') {
      return [];
    }
    const written =
      subject.kind === 'variant' && subject.variant.fields.length > 0 ? `${name}(...)` : name;
    const probed = text.slice(0, start) + written + text.slice(end);
    return errorsIn(text, probed, start, start + written.length).map(
      ({ message }) => `${written}: ${message}`,
    );
  });
}

/**
 * The word `site`'s pattern starts with, if a pattern start offers it: a variant or a type named
 * bare, the first name of a qualified one, `_` or a literal keyword. A camelCase bare name binds a
 * variable (§11.3), which nothing offers, and a name given type arguments selects by them.
 */
function startWordOf({ text, start, end, typed }: Site): string | undefined {
  const word = leadingWord.exec(text.slice(start, end))?.[0];
  const binds =
    word !== undefined &&
    camelCase.test(word) &&
    !patternKeywords.has(word) &&
    !text.startsWith('.', start + word.length);
  return binds || typed ? undefined : word;
}

const leadingWord = /^[A-Za-z_]\w*/u;
const camelCase = /^[a-z]/u;
const patternKeywords: ReadonlySet<string> = new Set(['true', 'false', 'none']);

/** The corpus patterns starting with a word a pattern start offers, with that word. */
const wordSites = patternSites.flatMap((site) => {
  const word = startWordOf(site);
  return word === undefined ? [] : [{ site, word }];
});

/** A field unknown to the pattern's type (5013), or one tested twice (5015). */
const fieldMistakes = new Set([5013, 5015]);

/**
 * What the fields offered in `site`'s struct pattern, emptied, leave wrong: a field it named that
 * isn't offered, and the field mistakes the offered ones make, each written in as `field is _`.
 */
function fieldMisfitsOf({ text, start, end, open, named }: (typeof fieldSites)[number]) {
  const close = end - 1;
  const emptied = editedMainProgram(text.slice(0, open) + text.slice(close), text);
  const offered = completionsAt(emptied.program, emptied.module, open, { trigger: '{' }).map(
    ({ name }) => name,
  );
  const items = offered.map((name) => `${name} is _`).join(', ');
  const probed = text.slice(0, open) + items + text.slice(close);
  return [
    ...named.filter((name) => !offered.includes(name)).map((name) => `${name} not offered`),
    ...errorsIn(text, probed, start, open + items.length + 1)
      .filter(({ code }) => fieldMistakes.has(code))
      .map(({ message }) => message),
  ];
}

describe('pattern completion offers what fits the matched value', () => {
  it('at the start of the corpus patterns', { timeout: slowTestTimeout }, () => {
    fc.assert(
      fc.property(fc.constantFrom(...patternSites), (site) => {
        expect(misfitsOf(site)).toEqual([]);
      }),
      { numRuns: 30 },
    );
  });

  it('offering the word each corpus pattern starts with', { timeout: slowTestTimeout }, () => {
    fc.assert(
      fc.property(fc.constantFrom(...wordSites), ({ site: { text, start, end }, word }) => {
        fc.pre(errorsIn(text, text, start, end).length === 0);
        const emptied = text.slice(0, start) + text.slice(end);
        expect(candidatesIn(emptied, start, text).map(({ name }) => name)).toContain(word);
      }),
      { numRuns: 30 },
    );
  });

  it("in the corpus struct patterns' braces", { timeout: slowTestTimeout }, () => {
    fc.assert(
      fc.property(fc.constantFrom(...fieldSites), (site) => {
        expect(fieldMisfitsOf(site)).toEqual([]);
      }),
      { numRuns: 30 },
    );
  });
});

describe('a pattern place', () => {
  it('offers a guard or a binding of the whole after a whole pattern, a space between', () => {
    const cases = [...decision, 'fn f(d: Decision, n: Int) -> Int:'];
    expect(labelsAt(...cases, '  match d:', '    case Approved(by) ‸')).toEqual(['if', 'as']);
    expect(labelsAt(...cases, '  match d:', '    case Approved(by)‸')).toEqual([]);
    expect(labelsAt(...cases, '  match n:', '    case 0..= ‸')).toEqual([]);
    expect(labelsAt(...cases, '  match n:', '    case .. ‸')).toEqual([]);
    expect(labelsAt(...cases, '  match n:', '    case + ‸')).toEqual([]);
  });

  it("offers the variants at a call pattern's head, and none qualified before braces", () => {
    const cases = [...decision, 'fn f(d: Decision) -> Int:', '  match d:'];
    expect(labelsAt(...cases, '    case Appr‸(by): 1')).toContain('Approved');
    expect(labelsAt(...cases, '    case Decision.‸(by): 1')).toContain('Approved');
    expect(labelsAt(...cases, '    case Decision.‸{by}: 1')).not.toContain('Approved');
  });

  it("reads the type a tuple's element, an array's item or a nested field matches", () => {
    const held = 'struct Held { decision: Decision? }';
    const nested = (subject: string, pattern: string) =>
      labelsAt(
        ...decision,
        held,
        `fn f(x: ${subject}) -> Int:`,
        '  match x:',
        `    case ${pattern}`,
      );
    expect(nested('(Int, Decision)', '(_, ‸')).toContain('Approved');
    expect(nested('Array<Decision>', '[‸')).toContain('Approved');
    expect(nested('Held', 'Held{decision is ‸')).toEqual(
      expect.arrayContaining(['Approved', 'none']),
    );
  });

  it("reads the type a call pattern's argument matches: its field's, by position or name", () => {
    const nested = (subject: string, pattern: string) =>
      labelsAt(...decision, `fn f(x: ${subject}) -> Int:`, '  match x:', `    case ${pattern}`);
    expect(nested('Result<Decision>', 'Ok(‸')).toContain('Approved');
    expect(nested('Result<Decision>', 'Ok(value: ‸')).toContain('Approved');
    expect(nested('Result<Int>', 'Err(Error{‸')).toContain('message');
  });

  it("labels the fields a call pattern's other arguments don't give, only those after a named one", () => {
    const cases = [...decision, 'fn f(d: Decision) -> Int:', '  match d:'];
    const labels = (pattern: string) =>
      labelsAt(...cases, `    case ${pattern}: 1`).filter((name) => name.endsWith(':'));
    expect(labels('Rejected(‸)')).toEqual(['by:', 'reason:']);
    expect(labels('Rejected("legal", ‸)')).toEqual(['reason:']);
    expect(labels('Rejected(reason: "r", ‸)')).toEqual(['by:']);
    expect(labelsAt(...cases, '    case Rejected(reason: "r", ‸): 1')).toEqual(['by:']);
    expect(labels('Rejected(by: ‸)')).toEqual([]);
    expect(labels('Rejected{‸}')).toEqual([]);
  });

  it('labels the fields as the arguments around the one written give them, a label being edited too', () => {
    const cases = [...decision, 'fn f(d: Decision) -> Int:', '  match d:'];
    const labels = (pattern: string) =>
      labelsAt(...cases, `    case ${pattern}: 1`).filter((name) => name.endsWith(':'));
    expect(labels('Rejected(‸, "no contract")')).toEqual(['by:']);
    expect(labels('Rejected(rea‸: "r")')).toEqual(['by:', 'reason:']);
    expect(labels('Rejected(reason: "r", ‸, _)')).toEqual(['by:']);
  });

  it("reads the rest field's items past a spread, and no fields of a struct a call pattern names", () => {
    const node = 'enum Node { Group(title: String, ...children: Array<Node>), Leaf }';
    const point = 'struct Point { x: Int, y: Int }';
    const started = (subject: string, pattern: string) =>
      labelsAt(
        ...decision,
        node,
        point,
        `fn f(x: ${subject}) -> Int:`,
        '  match x:',
        `    case ${pattern}: 1`,
      );
    expect(started('Node', 'Group("t", ...middle, ‸)')).toEqual(
      expect.arrayContaining(['Group', 'Leaf']),
    );
    expect(started('Point', 'Point(‸)')).not.toContain('x:');
  });

  it('reads the member a struct or tuple pattern selects of a union', () => {
    const optionals = [
      ...decision,
      'fn f(x: (Int, Decision)?, d: Decision?, p: { first: Int, second: Int }?) -> Int:',
    ];
    expect(labelsAt(...optionals, '  match x:', '    case (_, ‸')).toContain('Approved');
    expect(labelsAt(...optionals, '  if d is Rejected(‸')).toEqual(
      expect.arrayContaining(['by:', 'reason:']),
    );
    expect(labelsAt(...optionals, '  match p:', '    case struct{‸')).toEqual(['first', 'second']);
    expect(labelsAt(...optionals, '  match p:', '    case struct{first, ‸')).toEqual(['second']);
  });

  it('marks the variants unguarded cases take whole as covered', () => {
    const marked = [
      ...decision,
      'fn f(d: Decision, a: Bool) -> Int:',
      '  match d:',
      '    case Approved(by): 1',
      '    case Rejected(_, "late"): 2',
      '    case Expired if a: 3',
      '    case ‸',
      '  0',
    ].join('\n');
    const covered = candidatesIn(marked.replace('‸', ''), marked.indexOf('‸')).flatMap(
      ({ name, covered: is }) => (is ? [name] : []),
    );
    expect(covered).toEqual(['Approved']);
  });

  it("marks a call pattern's variant covered only when it binds what its fields hold whole", () => {
    const coveredBy = (subject: string, cases: readonly string[]) => {
      const text = [
        ...decision,
        'enum Node { Group(title: String, ...children: Array<Node>), Leaf }',
        `fn f(x: ${subject}) -> Int:`,
        '  match x:',
        ...cases.map((each) => `    ${each}`),
        '    case ‸',
        '  0',
      ].join('\n');
      return candidatesIn(text.replace('‸', ''), text.indexOf('‸')).flatMap(
        ({ name, covered: is }) => (is ? [name] : []),
      );
    };
    expect(coveredBy('Node', ['case Group(title, first): 1'])).toEqual([]);
    expect(coveredBy('Node', ['case Group(title, ...kids): 1'])).toEqual(['Group']);
    expect(coveredBy('Decision', ['case Approved(by as who): 1'])).toEqual(['Approved']);
    expect(coveredBy('Decision', ['case Approved((by)): 1'])).toEqual(['Approved']);
  });

  it('offers the types a downcast may name against an `any` value, those meeting its traits', () => {
    const labels = labelsAt(
      'trait Named:',
      '  fn name(self: Self) -> String',
      '',
      'struct Marker',
      'struct Plain',
      'struct Box<T> { value: T }',
      'fn name(self: Marker) -> String: "marker"',
      'fn name<T>(self: Box<T>) -> String: "box"',
      '',
      'fn f(x: any Named) -> Int:',
      '  match x:',
      '    case ‸',
    );
    expect(labels).toContain('Marker');
    expect(labels).not.toContain('Box');
    expect(labels).not.toContain('Plain');
    expect(labels).not.toContain('Never');
  });

  it("offers the primitives and aliases a type pattern may name: meeting an `any` value's traits, or the type matched", () => {
    const named = [
      'trait Named:',
      '  fn name(self: Self) -> String',
      '',
      'type Count = Int',
      'fn name(self: Int) -> String: "int"',
      '',
    ];
    const onAny = labelsAt(...named, 'fn f(x: any Named) -> Int:', '  match x:', '    case ‸');
    expect(onAny).toEqual(expect.arrayContaining(['Int', 'Count']));
    expect(onAny).not.toContain('String');
    const onInt = labelsAt(...named, 'fn f(x: Int) -> Int:', '  match x:', '    case ‸');
    expect(onInt).toEqual(expect.arrayContaining(['Int', 'Count']));
    expect(onInt).not.toContain('Bool');
  });

  it("offers the fields of the struct an alias names in a pattern's braces", () => {
    const aliased = [
      'struct Item { n: Int }',
      'type MyItem = Item',
      'fn toString(self: Item) -> String: "item"',
      '',
    ];
    const onItem = ['fn f(x: Item) -> Int:', '  match x:', '    case MyItem{‸'];
    expect(labelsAt(...aliased, ...onItem)).toEqual(['n']);
    const onAny = ['fn f(x: any Stringable) -> Int:', '  match x:', '    case MyItem{‸'];
    expect(labelsAt(...aliased, ...onAny)).toEqual(['n']);
  });
});
