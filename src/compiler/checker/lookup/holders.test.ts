import { describe, expect, it } from 'vitest';
import type { FunctionDeclaration } from '../../syntax/declarations.ts';
import { fieldsFunctionOf } from '../../syntax/field-defaults.ts';
import type { VariableDeclaration } from '../../syntax/statements.ts';
import { checkedMain } from './lookup.test-kit.ts';

const text = `const zero = 0
const two = zero + 2
struct Tag { text: string }
struct Point { x: int; y: int = zero }
enum Shape:
  Dot { size: int = zero }
const label = "x"
@Tag{label}
fn f(a: int, b: int = zero) -> int: a + b
`;

describe('the body holding a node', () => {
  const { checker, module, named, first } = checkedMain(text);
  const { lookup } = checker;
  const items = (kind: string) =>
    checker.program.modules.get(module)?.tree.root.items.filter((item) => item.kind === kind) ?? [];
  const [, twoDeclaration] = items('VariableDeclaration') as VariableDeclaration[];
  const [f] = items('FunctionDeclaration') as FunctionDeclaration[];
  const [, point] = items('StructDeclaration');
  const shape = first('EnumDeclaration');

  it("is a function's body, or its parameters' defaults", () => {
    expect(f && lookup.bodyHolding(module, named('a', 1))).toBe(f && checker.bodyOf(f));
    expect(f && lookup.bodyHolding(module, named('zero', 4))).toBe(f && checker.defaultsOf(f));
  });

  it("is a constant's, and a struct's or a variant's field defaults", () => {
    expect(twoDeclaration && lookup.bodyHolding(module, named('zero', 1))).toBe(
      twoDeclaration && checker.constantBodyOf(twoDeclaration),
    );
    const pointFields = point?.kind === 'StructDeclaration' ? fieldsFunctionOf(point) : undefined;
    expect(lookup.bodyHolding(module, named('zero', 2))).toBe(
      pointFields && checker.defaultsOf(pointFields),
    );
    const dot = shape?.variants[0];
    const dotFields = shape && dot?.kind === 'Variant' ? fieldsFunctionOf(shape, dot) : undefined;
    expect(lookup.bodyHolding(module, named('zero', 3))).toBe(
      dotFields && checker.defaultsOf(dotFields),
    );
  });

  it("is an annotation's own, wherever it stands", () => {
    const annotation = first('Annotation');
    const body = lookup.bodyHolding(module, named('label', 1));
    expect(body).toBeDefined();
    expect(body).toBe(annotation && checker.annotations.bodyOf(module, annotation));
  });

  it('is none for a signature or a declaring name', () => {
    expect(lookup.bodyHolding(module, named('a'))).toBeUndefined();
    expect(lookup.bodyHolding(module, named('Point'))).toBeUndefined();
  });
});
