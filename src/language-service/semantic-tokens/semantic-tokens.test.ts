import { describe, expect, it } from 'vitest';
import { textOf } from '../../foundation/text/span.ts';
import { treeOf } from '../language-service.test-kit.ts';
import { semanticTokensOf } from './semantic-tokens.ts';

/** Each highlighted piece of the module `lines` make, as its text and kind. */
function highlighted(...lines: readonly string[]): readonly (readonly [string, string])[] {
  const tree = treeOf(...lines);
  return semanticTokensOf(tree).map(({ span, type }) => [textOf(tree.source, span), type]);
}

describe('highlighting', () => {
  it('shows a contextual word as a keyword where it acts as one, and as a name elsewhere', () => {
    expect(highlighted('fn f(from: Pair): new Pair{type: from}')).toEqual([
      ['fn', 'keyword'],
      ['f', 'function'],
      ['from', 'parameter'],
      ['Pair', 'type'],
      ['new', 'keyword'],
      ['Pair', 'type'],
      ['type', 'property'],
      ['from', 'variable'],
    ]);
  });

  it('shows what a name declares, calls or reaches from the syntax around it', () => {
    expect(
      highlighted('@Note{"x"} @Skip', 'fn Box.make<T>(self: Box) -> m.T: self.open(m.f())'),
    ).toEqual([
      ['@', 'decorator'],
      ['Note', 'type'],
      ['"x"', 'string'],
      ['@', 'decorator'],
      ['Skip', 'type'],
      ['fn', 'keyword'],
      ['Box', 'type'],
      ['make', 'method'],
      ['T', 'typeParameter'],
      ['self', 'parameter'],
      ['Box', 'type'],
      ['->', 'operator'],
      ['m', 'namespace'],
      ['T', 'type'],
      ['self', 'variable'],
      ['open', 'method'],
      ['m', 'variable'],
      ['f', 'method'],
    ]);
  });

  it("shows a template's tag as what it calls", () => {
    expect(highlighted('const s = m.sql`a` + sql`b`')).toEqual([
      ['const', 'keyword'],
      ['s', 'variable'],
      ['=', 'operator'],
      ['m', 'variable'],
      ['sql', 'method'],
      ['`a`', 'string'],
      ['+', 'operator'],
      ['sql', 'function'],
      ['`b`', 'string'],
    ]);
  });

  it('shows a union, its literal members and a generic pattern as types, their angles as brackets', () => {
    expect(highlighted('fn f<S in "a" | -1>(x: S): match x:', '  case m.Box<S> as b: b')).toEqual([
      ['fn', 'keyword'],
      ['f', 'function'],
      ['S', 'typeParameter'],
      ['in', 'keyword'],
      ['"a"', 'string'],
      ['|', 'operator'],
      ['-', 'operator'],
      ['1', 'number'],
      ['x', 'parameter'],
      ['S', 'type'],
      ['match', 'keyword'],
      ['x', 'variable'],
      ['case', 'keyword'],
      ['m', 'namespace'],
      ['Box', 'type'],
      ['S', 'type'],
      ['as', 'keyword'],
      ['b', 'variable'],
      ['b', 'variable'],
    ]);
  });

  it("shows a template's quotes and text as a string, and its values as code", () => {
    expect(highlighted('const s = `a ${x + 1} b` # done')).toEqual([
      ['const', 'keyword'],
      ['s', 'variable'],
      ['=', 'operator'],
      ['`a ', 'string'],
      ['x', 'variable'],
      ['+', 'operator'],
      ['1', 'number'],
      [' b`', 'string'],
      ['# done', 'comment'],
    ]);
  });
});
