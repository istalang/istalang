/**
 * Places the scenario catalogue doesn't hold (its own are tested as `<ID> place` beside the
 * scenarios): expressions inside patterns and annotations, a guard before its `:`, and lines that
 * only look like an import's or an annotation's.
 */

import { describe, expect, it } from 'vitest';
import { checkedModule } from '../checked-module.ts';
import { programAt } from '../language-service.test-kit.ts';
import { cursorAt } from './cursor.ts';
import { type PlaceKind, placeAt } from './place.ts';

const decision = ['enum Decision:', '  Approved { by: string }', '  Expired', ''];

function placeIn(...lines: readonly string[]): PlaceKind {
  const { program, module, offset } = programAt(...lines);
  const checked = checkedModule(program, module);
  if (checked === undefined) {
    throw new Error('the program holds no main module');
  }
  return placeAt(cursorAt(checked, offset, undefined, [])).kind;
}

describe('the place a cursor is in', () => {
  it("is the grammar's in a guard written before the case's `:`", () => {
    const guarded = [
      'fn f(d: Decision, a: bool) -> int:',
      '  match d:',
      '    case Approved{by} if a ‸',
    ];
    expect(placeIn(...decision, ...guarded, '  0')).toBe('grammar');
  });

  it("is the grammar's in a case's arm inside a template's value", () => {
    const templated = ['fn f(d: Decision) -> string:', '  const s = `${match d: case Expired: ‸}`'];
    expect(placeIn(...decision, ...templated, '  s')).toBe('grammar');
  });

  it("is the grammar's in a field's value inside an annotation", () => {
    const annotated = ['struct D:', '  reason: string', '', '@D{reason: ‸}', 'fn f(): 1'];
    expect(placeIn(...annotated)).toBe('grammar');
  });

  it('declares a name after `as`, in a pattern or a field pattern', () => {
    const cases = ['fn f(d: Decision) -> int:', '  match d:'];
    expect(placeIn(...decision, ...cases, '    case Approved{by} as ‸', '  0')).toBe(
      'declaredName',
    );
    expect(placeIn(...decision, ...cases, '    case Approved{by as ‸', '  0')).toBe('declaredName');
  });

  it("is nothing in a comment, even after a member's `.` or a literal's `{`", () => {
    const pair = ['struct Pair:', '  first: int', ''];
    expect(placeIn(...pair, 'fn f() -> Pair: Pair{ # a‸', '  first: 1}')).toBe('nothing');
    expect(placeIn(...pair, 'fn f(p: Pair) -> int: p. # a‸', '  first')).toBe('nothing');
  });

  it("is nothing in a docstring's text", () => {
    expect(placeIn('"""A module, ‸documented."""', '', 'fn f() -> int: 1')).toBe('nothing');
  });

  it('reads a line by its first token, not by how a name there is spelled', () => {
    expect(placeIn('fn f(imports: int) -> int:', '  imports + ‸', '  0')).toBe('grammar');
    expect(placeIn("import ‸ from 'time'")).toBe('import');
  });
});
