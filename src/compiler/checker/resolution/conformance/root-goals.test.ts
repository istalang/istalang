/**
 * A goal asked at the root of a search, a trait or a struct constraint, is searched once per
 * program (§3.10: meeting is coherent, the same wherever it is asked), however many sites ask it,
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

/**
 * A program converting a `Box<Int>` into `any Shows` at `sites` sites, met through a generic
 * witness.
 */
function converting(sites: number, shown: string): string {
  return [
    'trait Shows { fn show(self: Self) -> String }',
    'struct Box<T> { value: T }',
    'fn show<W is Shows>(self: Box<W>) -> String: self.value.show()',
    'fn show(self: Int) -> String: "i"',
    'fn take(x: any Shows): ()',
    ...Array.from({ length: sites }, (_, site) => `fn f${site}(b: Box<${shown}>): take(b)`),
  ].join('\n');
}

/** How often checking `source` asks the constraints of the witness's own parameter `W`. */
function witnessSearches(source: string): number {
  const checker = checkedApart(stdProgramOf({ 'main.ista': source }));
  const constraintsOf = vi.spyOn(checker, 'constraintsOf');
  checker.diagnosticsOf(idOf('main.ista'));
  return constraintsOf.mock.calls.filter(([parameter]) => parameter.name.text === 'W').length;
}

/**
 * A program writing `Holder<P>` at `sites` sites, each noting a check of `Holder`'s struct
 * constraint.
 */
function holding(sites: number, needed: string): string {
  return [
    'struct P { x: Int, y: Int }',
    `struct Holder<S is struct { ${needed}: Int }> { s: S }`,
    ...Array.from({ length: sites }, (_, site) => `fn f${site}(h: Holder<P>): ()`),
  ].join('\n');
}

/** How often checking `source` reads the fields of `P`. */
function fieldReads(source: string): number {
  const checker = checkedApart(stdProgramOf({ 'main.ista': source }));
  const fieldsOf = vi.spyOn(checker, 'fieldsOf');
  checker.diagnosticsOf(idOf('main.ista'));
  return fieldsOf.mock.calls.filter(([type]) => typeText(type) === 'P').length;
}

describe('a struct goal asked at the root', () => {
  it('is judged once however many sites ask it', () => {
    const once = fieldReads(holding(1, 'x'));
    expect(once).toBeGreaterThan(0);
    expect(fieldReads(holding(4, 'x'))).toBe(once);
  });

  it('is reported unmet at every site asking it', () => {
    const checker = checkProgram(stdProgramOf({ 'main.ista': holding(3, 'z') }));
    const unmet = checker.diagnosticsOf(idOf('main.ista'));
    expect(new Set(unmet.map(({ span }) => span.start)).size).toBe(3);
  });
});

describe('a trait goal asked at the root', () => {
  it('is searched once however many sites ask it', () => {
    const once = witnessSearches(converting(1, 'Int'));
    expect(once).toBeGreaterThan(0);
    expect(witnessSearches(converting(4, 'Int'))).toBe(once);
  });

  it('is reported unmet at every site asking it', () => {
    const checker = checkProgram(stdProgramOf({ 'main.ista': converting(3, 'Bool') }));
    const unmet = checker.diagnosticsOf(idOf('main.ista'));
    expect(unmet.map(({ code }) => code)).toHaveLength(3);
    expect(new Set(unmet.map(({ span }) => span.start)).size).toBe(3);
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
