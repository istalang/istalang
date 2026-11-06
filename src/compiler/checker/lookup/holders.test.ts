import { describe, expect, it } from 'vitest';
import type { FunctionDeclaration } from '../../syntax/declarations.ts';
import { fieldsFunctionOf } from '../../syntax/field-defaults.ts';
import type { VariableDeclaration } from '../../syntax/statements.ts';
import { typeText } from '../types/type-text.ts';
import { checkedMain } from './lookup.test-kit.ts';

const text = `const zero = 0
const two = zero + 2
struct Tag { text: String }
struct Point { x: Int, y: Int = zero }
enum Shape:
  Dot { size: Int = zero }
const label = "x"
@Tag{label}
fn f(a: Int, b: Int = zero) -> Int: a + b
`;

/**
 * Which body a view reads: its own labels, which the view tools read at a node answers with
 * unchanged where no field loop's passes join.
 */
function bodyRead(body: { readonly labels: object } | undefined): object | undefined {
  return body?.labels;
}

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
    expect(bodyRead(lookup.bodyHolding(module, named('a', 1)))).toBe(
      bodyRead(f && checker.bodyOf(f)),
    );
    expect(bodyRead(lookup.bodyHolding(module, named('zero', 4)))).toBe(
      bodyRead(f && checker.defaultsOf(f)),
    );
  });

  it("is a constant's, and a struct's or a variant's field defaults", () => {
    expect(bodyRead(lookup.bodyHolding(module, named('zero', 1)))).toBe(
      bodyRead(twoDeclaration && checker.constantBodyOf(twoDeclaration)),
    );
    const pointFields = point?.kind === 'StructDeclaration' ? fieldsFunctionOf(point) : undefined;
    expect(bodyRead(lookup.bodyHolding(module, named('zero', 2)))).toBe(
      bodyRead(pointFields && checker.defaultsOf(pointFields)),
    );
    const dot = shape?.variants[0];
    const dotFields = shape && dot?.kind === 'Variant' ? fieldsFunctionOf(shape, dot) : undefined;
    expect(bodyRead(lookup.bodyHolding(module, named('zero', 3)))).toBe(
      bodyRead(dotFields && checker.defaultsOf(dotFields)),
    );
  });

  it("is an annotation's own, wherever it stands", () => {
    const annotation = first('Annotation');
    const body = lookup.bodyHolding(module, named('label', 1));
    expect(body).toBeDefined();
    expect(bodyRead(body)).toBe(
      bodyRead(annotation && checker.annotations.bodyOf(module, annotation)),
    );
  });

  it('is none for a signature or a declaring name', () => {
    expect(lookup.bodyHolding(module, named('a'))).toBeUndefined();
    expect(lookup.bodyHolding(module, named('Point'))).toBeUndefined();
  });
});

describe('an annotation nothing takes', () => {
  it('denotes the field a name in it gives, asked before anything else', () => {
    const { checker, module, named } = checkedMain(
      'struct Tag { text: String }\nfn f(): 1\n@Tag{text: "x"}\n',
    );
    const [denoted] = checker.lookup.denotationsOf(module, named('text', 1));
    expect(denoted?.declared.kind).toBe('field');
    expect(denoted?.type && typeText(denoted.type)).toBe('String');
  });

  it('denotes its names among the cases of a match', () => {
    const { checker, module, named } = checkedMain(
      'struct Tag { text: String }\nfn f(n: Int) -> Int:\n  match n:\n    @Tag{"a"}\n    case 1: 2\n    case _: 3\n',
    );
    const [denoted] = checker.lookup.denotationsOf(module, named('Tag', 1));
    expect(denoted?.declared.kind).toBe('type');
  });
});
