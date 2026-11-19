/**
 * A goal asked at the root of a search, a trait or a struct constraint, is searched once per
 * program (§8.2: meeting is coherent, the same wherever it is asked), however many sites ask it,
 * and each asking site still reports why it isn't met. A goal is an entry, so a revision after an
 * edit changing whether it is met answers as a checker made afresh does.
 */

import { describe, expect, it, vi } from 'vitest';
import { stdProgramOf } from '../../../binder/bind.test-kit.ts';
import { type Files, idOf } from '../../../program/program.test-kit.ts';
import { checkedApart } from '../../check.test-kit.ts';
import { checkProgram } from '../../check.ts';
import { typeText } from '../../types/type/type-text.ts';
import type { ProgramChecker } from '../../wiring/program/program-checker.ts';

/** How a program's sites ask a goal over `given`: what they ask through, then each site. */
interface Asker {
  readonly declared: (given: string) => string;
  readonly site: (index: number, given: string) => string;
}

/** A program of `prelude` whose `sites` sites ask a goal over `given` as `asker` does. */
function asking(prelude: readonly string[], asker: Asker, sites: number, given: string): string {
  const each = Array.from({ length: sites }, (_, index) => asker.site(index, given));
  return [...prelude, asker.declared(given), ...each].join('\n');
}

/** `Box<W>` meets `Shows` through a generic witness, whose own parameter is `W`. */
const shows = [
  'trait Shows { fn show(self: Self) -> String }',
  'struct Box<T> { value: T }',
  'fn show<W is Shows>(self: Box<W>) -> String: self.value.show()',
  'fn show(self: Int) -> String: "i"',
];

/** Sites asking whether `Box<given>` meets `Shows`: converting one to `any Shows`, or a call. */
const showsAskers: Record<string, Asker> = {
  'sites ask it': {
    declared: () => 'fn take(x: any Shows): ()',
    site: (index, shown) => `ista fn f${index}(b: Box<${shown}>): take(b)`,
  },
  'calls instantiate a function with it': {
    declared: () => 'fn shown<V is Shows>(v: V) -> String: v.show()',
    site: (index, shown) => `fn f${index}(b: Box<${shown}>): shown(b)`,
  },
};

/** How often checking `source` asks the constraints of the witness's own parameter `W`. */
function witnessSearches(source: string): number {
  const checker = checkedApart(stdProgramOf({ 'main.ista': source }));
  const constraintsOf = vi.spyOn(checker, 'constraintsOf');
  checker.diagnosticsOf(idOf('main.ista'));
  return constraintsOf.mock.calls.filter(([parameter]) => parameter.name.text === 'W').length;
}

const points = ['struct P { x: Int, y: Int }'];

/** Sites asking whether `P` meets `struct { given: Int }`: writing a type, or a call. */
const structAskers: Record<string, Asker> = {
  'sites ask it': {
    declared: (needed) => `struct Holder<S is struct { ${needed}: Int }> { s: S }`,
    site: (index) => `fn f${index}(h: Holder<P>): ()`,
  },
  'calls instantiate a function with it': {
    declared: (needed) => `fn need<S is struct { ${needed}: Int }>(s: S): ()`,
    site: (index) => `fn f${index}(p: P): need(p)`,
  },
};

/** How often checking `source` reads the fields of `P`. */
function fieldReads(source: string): number {
  const checker = checkedApart(stdProgramOf({ 'main.ista': source }));
  const fieldsOf = vi.spyOn(checker, 'fieldsOf');
  checker.diagnosticsOf(idOf('main.ista'));
  return fieldsOf.mock.calls.filter(([type]) => typeText(type) === 'P').length;
}

/** The starts of what checking `source` reports in `main.ista`. */
function reportedStarts(source: string): readonly number[] {
  const checker = checkProgram(stdProgramOf({ 'main.ista': source }));
  return checker.diagnosticsOf(idOf('main.ista')).map(({ span }) => span.start);
}

describe('a struct goal asked at the root', () => {
  const askers = Object.entries(structAskers);

  it.each(askers)('is judged once however many %s', (_, asker) => {
    const once = fieldReads(asking(points, asker, 1, 'x'));
    expect(once).toBeGreaterThan(0);
    expect(fieldReads(asking(points, asker, 4, 'x'))).toBe(once);
  });

  it.each(askers)('is reported unmet wherever %s', (_, asker) => {
    expect(new Set(reportedStarts(asking(points, asker, 3, 'z'))).size).toBe(3);
  });
});

describe('a trait goal asked at the root', () => {
  const askers = Object.entries(showsAskers);

  it.each(askers)('is searched once however many %s', (_, asker) => {
    const once = witnessSearches(asking(shows, asker, 1, 'Int'));
    expect(once).toBeGreaterThan(0);
    expect(witnessSearches(asking(shows, asker, 4, 'Int'))).toBe(once);
  });

  it.each(askers)('is reported unmet wherever %s', (_, asker) => {
    const starts = reportedStarts(asking(shows, asker, 3, 'Bool'));
    expect(starts).toHaveLength(3);
    expect(new Set(starts).size).toBe(3);
  });
});

/**
 * The codes and starts a revision reports in `main.ista` after `lib` is edited, `beside` modules
 * left as they are, and a fresh checker's.
 */
function afterLibEdit(main: string, before: string, after: string, beside: Files = {}) {
  const files = { 'main.ista': main, lib: before, ...beside };
  const first = stdProgramOf(files);
  const second = stdProgramOf({ ...files, lib: after }, first);
  const previous = checkedApart(first);
  previous.diagnosticsOf(idOf('main.ista'));
  const reported = (checker: ProgramChecker) =>
    checker.diagnosticsOf(idOf('main.ista')).map(({ code, span }) => [code, span.start]);
  return {
    revision: reported(checkedApart(second, { previous })),
    fresh: reported(checkedApart(second)),
  };
}

describe('a revision after an edit changing whether a root goal is met', () => {
  it.each([
    {
      name: 'a trait goal whose witness the edit takes away',
      main: [
        "import Shows from 'lib'",
        'fn take(x: any Shows): ()',
        'fn f(n: Int): take(n)',
        'fn g(n: Int): take(n)',
      ].join('\n'),
      before: 'trait Shows { fn show(self: Self) -> String }\nfn show(self: Int) -> String: "i"\n',
      after: 'trait Shows { fn show(self: Self) -> String }\nfn show(self: Bool) -> String: "b"\n',
      reported: 2,
    },
    {
      name: 'a struct goal whose field the edit renames',
      main: [
        "import P from 'lib'",
        'struct Holder<S is struct { x: Int }> { s: S }',
        'fn f(h: Holder<P>): ()',
        'fn g(h: Holder<P>): ()',
      ].join('\n'),
      before: 'struct P { x: Int }\n',
      after: 'struct P { y: Int }\n',
      reported: 2,
    },
    {
      name: 'a goal a dependency replayed while the goal is taken over asks again',
      main: [
        "import MyTrait, A from 'traits'",
        'struct Holder<T is MyTrait> { item: T }',
        'fn f(h: Holder<A>): ()',
      ].join('\n'),
      before: 'type Ret = Int\n',
      after: 'type Ret = String\n',
      beside: {
        traits: [
          "import Ret from 'lib'",
          'trait MyTrait:',
          '  fn act(self: Self) -> Ret | any MyTrait',
          'struct A { x: Int }',
          'fn act(self: A) -> A | any MyTrait: self',
        ].join('\n'),
      },
      reported: 0,
    },
  ])('answers $name as a checker made afresh', ({ main, before, after, beside, reported }) => {
    const { revision, fresh } = afterLibEdit(main, before, after, beside);
    expect(fresh).toHaveLength(reported);
    expect(revision).toEqual(fresh);
  });
});
