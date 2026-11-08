/**
 * Member completion offers only what resolves where it is offered: every field or method offered
 * after a receiver's `.` or `?.`, written in, reads or calls without a member-resolution
 * diagnostic. Over the corpus's member accesses, and over receivers of every kind.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { invalidPrograms, runPrograms } from '../../../../../test/corpus/programs.ts';
import { checkProgram } from '../../../../compiler/checker/check.ts';
import type { Program } from '../../../../compiler/program/program.ts';
import { isMethod } from '../../../../compiler/syntax/declarations/methods.ts';
import type { MemberAccess } from '../../../../compiler/syntax/expressions/index.ts';
import { callOfCallee } from '../../../../compiler/syntax/expressions/readings.ts';
import {
  ancestorsOf,
  nodesAt,
  nodesUnder,
  parentOf,
} from '../../../../compiler/syntax/tree/index.ts';
import { spanIn } from '../../../../compiler/syntax/tree/positions.ts';
import { type MainProgram, mainProgram, programAt } from '../../language-service.test-kit.ts';
import { completionsAt } from '../index.ts';

/**
 * What a call taking its receiver reports when its arguments, each `panic("")`, decide nothing:
 * several overloads take them (5003), or a type parameter only they give is left open (5100).
 */
const undecided = new Set([5003, 5100]);

/**
 * A member read or called after `.` or `?.`, in `main`: a probe takes the place of the access, or
 * of the call it is the callee of.
 */
interface MemberSite {
  readonly main: MainProgram;
  readonly access: MemberAccess;
}

/**
 * The fields and methods offered at `site` that don't resolve when written in its place: each
 * offered member is written after the site's receiver, a method called with as many arguments as
 * a method of its name takes, each `panic("")`, which fits any parameter. It resolves when its
 * name then denotes a declaration, or when what is reported is only what such arguments leave
 * undecided among the functions taking the receiver (`undecided`).
 */
function unresolvedOffers({ main, access }: MemberSite): readonly string[] {
  const { program, module, tree } = main;
  const { text } = tree.source;
  const member = spanIn(tree, access.member.span);
  const offered = completionsAt(program, module, member.end).filter(
    ({ kind }) => kind === 'field' || kind === 'method',
  );
  const before = text.slice(spanIn(tree, access.target.span).start, member.start);
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
  const replaced = spanIn(tree, callOf(main, access) ?? access.span);
  const head = `${text.slice(0, replaced.start)}(`;
  const starts = probes.map((_, index) =>
    probes.slice(0, index).reduce((at, probe) => at + probe.text.length + 2, head.length),
  );
  const probed = mainProgram(
    `${head}${probes.map((probe) => probe.text).join(', ')})${text.slice(replaced.end)}`,
  );
  const checker = checkProgram(probed.program);
  const resolves = ({ name, text: written }: (typeof probes)[number], start: number) => {
    const probedName = nodesAt(probed.tree, start + written.indexOf(name, before.length)).at(-1);
    if (probedName?.kind !== 'Identifier') {
      throw new Error(`No member at ${start} of the probed program.`);
    }
    const denoted = checker.lookup.denotationsOf(probed.module, probedName);
    const reported = checker
      .diagnosticsOf(probed.module)
      .filter(({ span }) => start <= span.start && span.end <= start + written.length)
      .map(({ code }) => code);
    return (
      denoted.some(({ declared }) => declared.kind === 'field' || declared.kind === 'function') ||
      (reported.length > 0 && reported.every((code) => undecided.has(code)))
    );
  };
  const resolved = new Set(
    probes.flatMap((probe, index) => (resolves(probe, starts[index] ?? 0) ? [probe.name] : [])),
  );
  return [...new Set(probes.map(({ name }) => name))].filter((name) => !resolved.has(name));
}

/** The call `access` is the callee of, if it is one. */
function callOf({ tree }: MainProgram, access: MemberAccess) {
  return callOfCallee(access, ancestorsOf(tree, access).slice(1))?.span;
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

/** The member sites of `main` a probe can stand in for: after `.` or `?.`, not assigned to. */
function memberSites(main: MainProgram): readonly MemberSite[] {
  const { tree } = main;
  return nodesUnder(tree, tree.root).flatMap((node) => {
    if (node.kind !== 'MemberAccess' || node.target.span.from === node.target.span.to) {
      return [];
    }
    const operator = tree.source.text
      .slice(spanIn(tree, node.target.span).end, spanIn(tree, node.member.span).start)
      .trim();
    const replaced = callOfCallee(node, ancestorsOf(tree, node).slice(1)) ?? node;
    const holder = replaced && parentOf(tree, replaced);
    const isTarget = holder?.kind === 'Assignment' && holder.targets.includes(replaced as never);
    return (operator === '.' || operator === '?.') && !isTarget ? [{ main, access: node }] : [];
  });
}

/** The site of the member access whose member the cursor mark is at, in `lines`. */
function cursorSite(...lines: readonly string[]): MemberSite {
  const main = programAt(...lines);
  const access = nodesAt(main.tree, main.offset - 1).findLast(
    (node) => node.kind === 'MemberAccess',
  );
  if (access?.kind !== 'MemberAccess') {
    throw new Error('No member access at the cursor.');
  }
  return { main, access };
}

describe('member completion offers only what resolves there', () => {
  const corpusSites = [...runPrograms, ...invalidPrograms].flatMap(({ text }) =>
    memberSites(mainProgram(text)),
  );

  it('at member accesses of the corpus', () => {
    fc.assert(
      fc.property(fc.constantFrom(...corpusSites), (site) => {
        expect(unresolvedOffers(site)).toEqual([]);
      }),
      { numRuns: 40 },
    );
  }, 60_000);

  it.each([
    ['a function value', 'fn f(g: fn() -> Int) -> Int:', '  g.‸', '  1'],
    ['a function named as a value', 'fn g() -> Int: 1', 'fn f() -> Int:', '  g.‸', '  1'],
    ['the function being declared', 'fn main():', '  main.‸'],
    ["an async function's own call", 'async fn worker() -> Future<Int>:', '  worker.‸', '  1'],
    ['an error-typed value', 'fn f() -> Int:', '  nope.‸', '  1'],
    ['a primitive', 'fn f(x: Int) -> Int:', '  x.‸', '  1'],
    ['a string', 'fn f(x: String) -> Int:', '  x.‸', '  1'],
    ['an optional', 'fn f(x: String?) -> Int:', '  x.‸', '  1'],
    ['inside an optional', 'fn f(x: String?) -> Int:', '  x?.‸', '  1'],
    ['an array', 'fn f(x: Array<Int>) -> Int:', '  x.‸', '  1'],
    ['a constrained type parameter', 'fn f<T is Stringable>(x: T) -> Int:', '  x.‸', '  1'],
    ['a value that is no place', 'fn f() -> Int:', '  [1, 2].‸', '  1'],
    ['`?.` on a value that is not optional', 'fn f(x: Int) -> Int:', '  x?.‸', '  1'],
    [
      'a chain link reading an optional field',
      'struct Address:',
      '  city: String',
      'struct Person:',
      '  address: Address?',
      'fn f(p: Person?) -> Int:',
      '  p?.address.‸',
      '  1',
    ],
  ])('after %s', (_, ...lines) => {
    expect(unresolvedOffers(cursorSite(...lines))).toEqual([]);
  });
});
