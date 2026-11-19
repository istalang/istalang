/**
 * A union and the traits it meets (§8.2): through functions declared for it, or through its members
 * when every member meets an object-safe trait no rule derives; and a call on a union going
 * through the one visible trait it meets that requires the function, where no function takes the
 * union whole.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { stdProgramOf } from '../../../binder/bind.test-kit.ts';
import { diagnosedAt } from '../../../compile.test-kit.ts';
import { reported } from '../../check.test-kit.ts';
import { checkerDiagnostics } from '../../diagnostics/index.ts';

const { notConforming, noMember, severalTraits } = checkerDiagnostics;

const named = [
  'trait Named:',
  '  fn name(self: Self) -> String',
  'struct Email { to: String }',
  'struct Sms { number: String }',
  'struct Fax { line: Int }',
  'fn name(self: Email) -> String: self.to',
  'fn name(self: Sms) -> String: self.number',
  'fn needNamed<T is Named>(value: T) -> String: value.name()',
];

/** The codes reported for `lines` after `named`. */
function codesAfterNamed(...lines: readonly string[]): readonly number[] {
  return reported([...named, ...lines].join('\n')).codes;
}

/** The messages reported for `lines` after `named`. */
function messagesAfterNamed(...lines: readonly string[]): readonly string[] {
  const text = [...named, ...lines].join('\n');
  const { diagnostics } = diagnosedAt(stdProgramOf({ 'main.ista': text }), 'main.ista');
  return diagnostics.map(({ message }) => message);
}

describe('a union meeting a trait through its members', () => {
  it('meets an object-safe trait exactly when every member meets it', () => {
    const members = fc.uniqueArray(fc.constantFrom('Email', 'Sms', 'Fax'), {
      minLength: 2,
      maxLength: 3,
    });
    fc.assert(
      fc.property(members, (chosen) => {
        const union = chosen.join(' | ');
        const codes = codesAfterNamed(`fn f(x: ${union}) -> String: needNamed(x)`);
        expect(codes).toEqual(chosen.includes('Fax') ? [notConforming.code] : []);
      }),
    );
  });

  it("meets a trait for a literal member through its base's function", () => {
    expect(codesAfterNamed('fn f(x: "draft" | Int) -> String: `${x}`')).toEqual([]);
  });

  it('names the member that falls short', () => {
    expect(messagesAfterNamed('fn f(x: Email | Fax) -> String: needNamed(x)')).toEqual([
      "Email | Fax doesn't satisfy Named: it needs its member Fax to satisfy Named too.",
    ]);
  });

  it("can't meet a trait that can't follow any, nor one whose codecs JSON derives", () => {
    expect(
      messagesAfterNamed(
        'fn zero<T is Default>() -> T: T.default()',
        'fn f() -> Int | String: zero<Int | String>()',
      ),
    ).toEqual([
      "Int | String doesn't satisfy Default: it needs 'default' declared for it, as Default can't be met through its members: 'default' is static.",
    ]);
    expect(
      codesAfterNamed(
        "import * as json from 'json'",
        'fn f(x: Int | String) -> String: json.stringify(x)',
      ),
    ).toEqual([notConforming.code]);
  });

  it('meets a trait through a function declared for it whole beside the trait', () => {
    expect(
      codesAfterNamed(
        'fn name(self: Fax | Int) -> String: "either"',
        'fn f(x: Fax | Int) -> String: needNamed(x)',
      ),
    ).toEqual([]);
  });
});

describe('a call on a union', () => {
  it('goes through the visible trait the union meets', () => {
    expect(codesAfterNamed('fn f(x: Email | Sms) -> String: x.name()')).toEqual([]);
    expect(codesAfterNamed('fn f(x: Email | Sms) -> String: `${x.name()}`')).toEqual([]);
  });

  it('finds nothing when no visible trait the union meets requires the function', () => {
    expect(codesAfterNamed('fn f(x: Email | Fax) -> String: x.name()')).toEqual([noMember.code]);
    const hidden = [
      'trait Hidden:',
      '  fn hidden(self: Self) -> Int',
      'fn hidden(self: Int) -> Int: 1',
      'fn hidden(self: Bool) -> Int: 2',
    ];
    const between = ["import Hidden from 'hidden.ista'", 'struct Thing {}'];
    const main = ["import Thing from 'between.ista'", 'fn f(x: Int | Bool) -> Int: x.hidden()'];
    const others = { 'hidden.ista': hidden.join('\n'), 'between.ista': between.join('\n') };
    expect(
      reported(main.join('\n'), others).codes,
      'a trait in a module the caller never imports is not visible',
    ).toEqual([noMember.code]);
  });

  it('reports several visible traits the union meets that require the function', () => {
    const main = [
      ...named,
      'trait Labelled:',
      '  fn name(self: Self) -> String',
      'fn f(x: Email | Sms) -> String: x.name()',
    ].join('\n');
    const { diagnostics } = diagnosedAt(stdProgramOf({ 'main.ista': main }), 'main.ista');
    expect(diagnostics.map(({ code }) => code)).toEqual([severalTraits.code]);
    expect(diagnostics[0]?.message).toContain('Named, Labelled');
  });

  it('calls the function declared for the union beside its trait, though the caller sees none', () => {
    const shown = [
      'trait Shown:',
      '  fn shown(self: Self) -> String',
      'fn shown(self: Int | String) -> String: "whole"',
    ];
    const main = ["import Shown from 'shown.ista'", 'fn f(x: Int | String) -> String: x.shown()'];
    expect(reported(main.join('\n'), { 'shown.ista': shown.join('\n') }).codes).toEqual([]);
  });

  it('calls a function taking the union whole before any trait', () => {
    const main = [
      "import Email, Sms from 'named.ista'",
      'fn name(self: Email | Sms) -> String: "whole"',
      'fn f(x: Email | Sms) -> String: x.name()',
    ];
    expect(reported(main.join('\n'), { 'named.ista': named.join('\n') }).codes).toEqual([]);
  });
});
