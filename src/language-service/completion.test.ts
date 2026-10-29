import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { invalidPrograms, runPrograms } from '../../test/corpus/programs.ts';
import { stdProgramOf } from '../compiler/binder/bind.test-kit.ts';
import { checkProgram } from '../compiler/checker/check.ts';
import { idOf } from '../compiler/program/program.test-kit.ts';
import type { Program } from '../compiler/program/program.ts';
import { isMethod } from '../compiler/syntax/declarations.ts';
import type { MemberAccess } from '../compiler/syntax/expressions/index.ts';
import { spanIn } from '../compiler/syntax/positions.ts';
import { nodesAt, nodesUnder, parentOf, type SyntaxTree } from '../compiler/syntax/tree.ts';
import { completionsAt, memberCompletionsAt } from './completion.ts';
import { programAt } from './language-service.test-kit.ts';

function names(...lines: readonly string[]): readonly string[] {
  const { program, module, offset } = programAt(...lines);
  return completionsAt(program, module, offset).map(({ name }) => name);
}

const time = "import * as time from 'time'";

const pair = [
  'struct Pair:',
  '  first: int',
  '  second: int',
  '',
  'fn sum(self: Pair) -> int: self.first + self.second',
  'fn Pair.zero() -> Pair: Pair{first: 0, second: 0}',
  '',
];

describe('completion', () => {
  it("offers a value's fields and methods after a `.`, while the member is still missing", () => {
    expect(names(...pair, 'fn f(p: Pair) -> int:', '  p.‸', '  1')).toEqual(
      expect.arrayContaining(['first', 'second', 'sum']),
    );
  });

  it('offers the value inside an optional after `?.`', () => {
    expect(names(...pair, 'fn f(p: Pair?) -> int?: p?.fi‸rst')).toEqual(
      expect.arrayContaining(['first', 'second']),
    );
  });

  it("offers a type's statics, and an enum's variants", () => {
    expect(names(...pair, 'fn f() -> Pair: Pair.ze‸ro()')).toContain('zero');
    expect(names('enum Color:', '  Red', '  Green', 'fn f() -> Color: Color.R‸ed')).toEqual([
      'Red',
      'Green',
    ]);
  });

  it('offers what a shared struct holds after `->` and `?->`, before a member is written', () => {
    const counter = ['shared struct Counter:', '  count: int', ''];
    expect(names(...counter, 'fn f(c: Counter) -> int:', '  c->‸', '  1')).toEqual(['count']);
    expect(names(...counter, 'fn f(c: Counter?) -> int:', '  c?->‸', '  1')).toEqual(['count']);
  });

  it("offers a qualified name's later segment in a pattern and in a type", () => {
    const color = ['enum Color:', '  Red', '  Green', ''];
    const matching = [
      'fn f(c: Color) -> int:',
      '  match c:',
      '    case Color.R‸ed: 1',
      '    case _: 2',
    ];
    expect(names(...color, ...matching)).toEqual(['Red', 'Green']);
    const unwritten = [
      'fn f(c: Color) -> int:',
      '  match c:',
      '    case Color.‸:',
      '      1',
      '    case _: 2',
    ];
    expect(names(...color, ...unwritten)).toEqual(['Red', 'Green']);
    const json = "import * as json from 'json'";
    expect(names(json, 'fn f(j: json.Js‸on) -> int: 1')).toContain('Json');
    expect(names(json, 'fn f(j: json.‸) -> int: 1')).toContain('Json');
    expect(names(json, 'fn f() -> int:', '  let j: json.‸ = 1', '  1')).toContain('Json');
  });

  it('offers a method taking `&self` only through a place', () => {
    expect(names('fn f() -> int:', '  let xs = [1]', '  xs.‸', '  1')).toContain('push');
    expect(names('fn f() -> int:', '  [1].‸', '  1')).not.toContain('push');
  });

  it('offers the names visible where the name starts, then keywords', () => {
    const offered = names('fn f(count: int) -> int:', '  let total = 1', '  to‸tal + count');
    expect(offered).toEqual(expect.arrayContaining(['total', 'count', 'f', 'fn', 'while']));
  });

  it('answers members alone only where a member is written', () => {
    const { program, module, offset } = programAt('fn f(a: int) -> bool: a >‸ 1');
    expect(memberCompletionsAt(program, module, offset)).toBeUndefined();
  });

  it("doesn't offer a block's name before its declaration", () => {
    expect(names('fn f() -> int:', '  ‸', '  let later = 1', '  later')).not.toContain('later');
  });

  it('offers nothing after a `.` where no member can stand, a keyword spelling included', () => {
    expect(names(time, 'time.‸', 'fn f() -> int: 1')).toEqual([]);
    expect(names(time, 'time.if‸')).toEqual([]);
    expect(names(time, 'time?.‸')).toEqual([]);
    expect(names('1.‸')).toEqual([]);
    expect(names('enum Color.‸:', '  Red')).toEqual([]);
    expect(names(time, 'const t = time.‸')).toContain('now');
  });

  it('offers nothing after a value that has no members', () => {
    expect(names('fn main() -> int:', '  main.‸', '  1')).toEqual([]);
    expect(names('fn g() -> int: 1', 'fn f() -> int:', '  g.‸', '  1')).toEqual([]);
    expect(names('fn f() -> int:', '  nope.‸', '  1')).toEqual([]);
    expect(names('fn f() -> int:', '  let x = nope', '  x.‸', '  1')).toEqual([]);
    expect(names('fn f(o: int?) -> int:', '  o.‸', '  1')).toEqual([]);
    expect(names('fn f(o: int) -> int:', '  o?.‸', '  1')).toEqual([]);
  });

  it("offers neither a namespace's nor a type's members after `?.`", () => {
    expect(names(time, 'fn f() -> int:', '  time?.‸', '  1')).toEqual([]);
    expect(names(...pair, 'fn f() -> int:', '  Pair?.‸', '  1')).toEqual([]);
  });

  it('offers a member whose name so far spells a keyword', () => {
    const xs = ['fn f(xs: Array<int>, maybe: Array<int>?) -> int:', '  let ys = xs'];
    expect(names(...xs, '  ys.in‸', '  1')).toContain('includes');
    expect(names(...xs, '  maybe?.in‸', '  1')).toContain('includes');
  });

  it('offers the visible names after a `.` that ends the line before', () => {
    expect(names(time, 'time.', 'f‸')).toContain('fn');
    expect(names(time, 'const t: time.', 'fn‸')).toContain('fn');
    expect(names('fn f() -> i‸nt: 1')).toContain('int');
  });
});

/**
 * What a call taking its receiver reports when its arguments, each `panic("")`, decide nothing:
 * several overloads take them (5003), or a type parameter only they give is left open (5100).
 */
const undecided = new Set([5003, 5100]);

/** The module every program of these tests is checked as. */
const main = idOf('main');

/**
 * A member read or called after `.` or `?.`: where it is written and what is written there, the
 * call it is the callee of included, which a probe takes the place of.
 */
interface MemberSite {
  readonly text: string;
  readonly tree: SyntaxTree;
  readonly access: MemberAccess;
}

/**
 * The fields and methods offered at `site` that don't resolve when written in its place: each
 * offered member is written after the site's receiver, a method called with as many arguments as
 * a method of its name takes, each `panic("")`, which fits any parameter. It resolves when its
 * name then denotes a declaration, or when what is reported is only what such arguments leave
 * undecided among the functions taking the receiver (`undecided`).
 */
function unresolvedOffers(program: Program, site: MemberSite): readonly string[] {
  const { text, tree, access } = site;
  const memberEnd = spanIn(tree, access.member.span).end;
  const offered = completionsAt(program, main, memberEnd).filter(
    ({ kind }) => kind === 'field' || kind === 'method',
  );
  const receiver = spanIn(tree, access.target.span);
  const before = text.slice(receiver.start, spanIn(tree, access.member.span).start);
  const probes = offered.flatMap(({ name, kind }) =>
    kind === 'field'
      ? [{ name, text: `${before}${name}` }]
      : [...aritiesOf(program, name)].map((arity) => ({
          name,
          text: `${before}${name}(${Array.from({ length: arity }, () => 'panic("")').join(', ')})`,
        })),
  );
  if (probes.length === 0) {
    return [];
  }
  const replaced = spanIn(tree, callOf(tree, access) ?? access.span);
  const head = `${text.slice(0, replaced.start)}(`;
  const starts = probes.map((_, index) =>
    probes.slice(0, index).reduce((at, probe) => at + probe.text.length + 2, head.length),
  );
  const probed = stdProgramOf({
    main: `${head}${probes.map((probe) => probe.text).join(', ')})${text.slice(replaced.end)}`,
  });
  const checker = checkProgram(probed);
  const probedTree = probed.modules.get(main)?.tree;
  if (probedTree === undefined) {
    throw new Error('The probed program lost its module.');
  }
  const resolves = ({ name, text: written }: (typeof probes)[number], start: number) => {
    const member = nodesAt(probedTree, start + written.indexOf(name, before.length)).at(-1);
    if (member?.kind !== 'Identifier') {
      throw new Error(`No member at ${start} of the probed program.`);
    }
    const denoted = checker.lookup.denotationsOf(main, member).map(({ declared }) => declared.kind);
    const reported = checker
      .diagnosticsOf(main)
      .filter(({ span }) => start <= span.start && span.end <= start + written.length)
      .map(({ code }) => code);
    return (
      denoted.some((kind) => kind === 'field' || kind === 'function') ||
      (reported.length > 0 && reported.every((code) => undecided.has(code)))
    );
  };
  const resolved = new Set(
    probes.flatMap((probe, index) => (resolves(probe, starts[index] ?? 0) ? [probe.name] : [])),
  );
  return [...new Set(probes.map(({ name }) => name))].filter((name) => !resolved.has(name));
}

/** The call `access` is the callee of, if it is one. */
function callOf(tree: SyntaxTree, access: MemberAccess) {
  const parent = parentOf(tree, access);
  return parent?.kind === 'Call' && parent.callee === access ? parent.span : undefined;
}

/**
 * How many arguments besides its receiver each method named `name` takes. One taking another
 * argument by `&` is left out: that argument must be a place of its parameter's type exactly,
 * which no probe can write in general.
 */
function aritiesOf(program: Program, name: string): ReadonlySet<number> {
  return new Set(
    [...program.modules.values()].flatMap(({ tree }) =>
      nodesUnder(tree, tree.root).flatMap((node) => {
        if (node.kind !== 'FunctionDeclaration' || node.name.text !== name || !isMethod(node)) {
          return [];
        }
        const others = node.parameters.slice(1).filter((each) => each.kind === 'Parameter');
        return others.some(({ type }) => type?.kind === 'ReferenceType') ? [] : [others.length];
      }),
    ),
  );
}

/** The member sites of a program, its text being `text`, that a probe can stand in for. */
function memberSites(text: string): { readonly program: Program; readonly sites: MemberSite[] } {
  const program = stdProgramOf({ main: text });
  const tree = program.modules.get(main)?.tree;
  if (tree === undefined) {
    throw new Error('The program lost its module.');
  }
  const sites = nodesUnder(tree, tree.root).flatMap((node) => {
    if (node.kind !== 'MemberAccess' || node.target.span.from === node.target.span.to) {
      return [];
    }
    const operator = text
      .slice(spanIn(tree, node.target.span).end, spanIn(tree, node.member.span).start)
      .trim();
    const replaced = parentOf(tree, node)?.kind === 'Call' ? parentOf(tree, node) : node;
    const holder = replaced && parentOf(tree, replaced);
    const isTarget = holder?.kind === 'Assignment' && holder.targets.includes(replaced as never);
    return (operator === '.' || operator === '?.') && !isTarget
      ? [{ text, tree, access: node }]
      : [];
  });
  return { program, sites };
}

/** The site of the member access whose member the cursor mark is at, in `lines`. */
function cursorSite(...lines: readonly string[]): {
  readonly program: Program;
  readonly site: MemberSite;
} {
  const { program, offset } = programAt(...lines);
  const text = `${lines.join('\n')}\n`.replace('‸', '');
  const tree = program.modules.get(main)?.tree;
  const access = tree && nodesAt(tree, offset - 1).findLast((node) => node.kind === 'MemberAccess');
  if (tree === undefined || access?.kind !== 'MemberAccess') {
    throw new Error('No member access at the cursor.');
  }
  return { program, site: { text, tree, access } };
}

describe('member completion offers only what resolves there', () => {
  const corpusSites = [...runPrograms, ...invalidPrograms].flatMap(({ text }) => {
    const { program, sites } = memberSites(text);
    return sites.map((site) => ({ program, site }));
  });

  it('at member accesses of the corpus', () => {
    fc.assert(
      fc.property(fc.constantFrom(...corpusSites), ({ program, site }) => {
        expect(unresolvedOffers(program, site)).toEqual([]);
      }),
      { numRuns: 40 },
    );
  }, 60_000);

  it.each([
    ['a function value', 'fn f(g: fn() -> int) -> int:', '  g.‸', '  1'],
    ['a function named as a value', 'fn g() -> int: 1', 'fn f() -> int:', '  g.‸', '  1'],
    ['the function being declared', 'fn main():', '  main.‸'],
    ['an error-typed value', 'fn f() -> int:', '  nope.‸', '  1'],
    ['a primitive', 'fn f(x: int) -> int:', '  x.‸', '  1'],
    ['a string', 'fn f(x: string) -> int:', '  x.‸', '  1'],
    ['an optional', 'fn f(x: string?) -> int:', '  x.‸', '  1'],
    ['inside an optional', 'fn f(x: string?) -> int:', '  x?.‸', '  1'],
    ['an array', 'fn f(x: Array<int>) -> int:', '  x.‸', '  1'],
    ['a constrained type parameter', 'fn f<T is Stringable>(x: T) -> int:', '  x.‸', '  1'],
    ['a value that is no place', 'fn f() -> int:', '  [1, 2].‸', '  1'],
    ['`?.` on a value that is not optional', 'fn f(x: int) -> int:', '  x?.‸', '  1'],
    [
      'a chain link reading an optional field',
      'struct Address:',
      '  city: string',
      'struct Person:',
      '  address: Address?',
      'fn f(p: Person?) -> int:',
      '  p?.address.‸',
      '  1',
    ],
  ])('after %s', (_, ...lines) => {
    const { program, site } = cursorSite(...lines);
    expect(unresolvedOffers(program, site)).toEqual([]);
  });
});
