import { describe, expect, it } from 'vitest';
import { programAt } from '../language-service.test-kit.ts';
import { signatureHelpAt } from './signature-help.ts';

/** The active signature's label, with its active parameter's text. */
function help(...lines: readonly string[]) {
  const { program, module, offset } = programAt(...lines);
  const found = signatureHelpAt(program, module, offset);
  const active = found?.active === undefined ? undefined : found.signatures[found.active];
  const parameter = active?.activeParameter;
  const span = parameter === undefined ? undefined : active?.parameters[parameter];
  return active && { label: active.label, parameter: span && active.label.slice(...span) };
}

describe('signature help', () => {
  it('marks the parameter the argument under the cursor gives', () => {
    expect(help('fn add(a: Int, b: Int) -> Int: a + b', 'fn f() -> Int: add(1, ‸2)')).toEqual({
      label: 'fn add(a: Int, b: Int) -> Int',
      parameter: 'b: Int',
    });
  });

  it("doesn't count a method's receiver among the written arguments", () => {
    expect(
      help(
        'struct P:',
        '  a: Int',
        'fn plus(self: P, n: Int) -> Int: self.a + n',
        'fn f(p: P) -> Int: p.plus(‸1)',
      ),
    ).toEqual({ label: 'fn plus(self: P, n: Int) -> Int', parameter: 'n: Int' });
  });

  it('marks a named argument by its name, and a rest argument by its rest parameter', () => {
    const declared = 'fn g(a: Int, b: Int = 0, ...rest: Array<Int>) -> Int: a';
    expect(help(declared, 'fn f() -> Int: g(1, b: ‸2)')?.parameter).toBe('b: Int = …');
    expect(help(declared, 'fn f() -> Int: g(1, 2, 3, ‸4)')?.parameter).toBe('...rest: Array<Int>');
  });

  it('marks the argument a line starts, where line breaks separate the arguments (§2)', () => {
    const add = 'fn add(a: Int, b: Int, c: Int) -> Int: a + b + c';
    expect(help(add, 'fn f() -> Int: add(', '  1', '  ‸2', '  3', ')')?.parameter).toBe('b: Int');
    expect(help(add, 'fn f() -> Int: add(', '  a: 1', '  ‸c: 3', '  b: 2', ')')?.parameter).toBe(
      'c: Int',
    );
  });

  it('helps with a call being typed, before it resolves', () => {
    const add = 'fn add(a: Int, b: Int, c: Int) -> Int: a + b + c';
    expect(help(add, 'fn f() -> Int: add(1, ‸')).toEqual({
      label: 'fn add(a: Int, b: Int, c: Int) -> Int',
      parameter: 'b: Int',
    });
    expect(help(add, 'fn f() -> Int: add(1, ‸, 3)')?.parameter).toBe('b: Int');
    expect(help(add, 'fn f() -> Int: add( ‸, 2)')?.parameter).toBe('a: Int');
    expect(help(add, 'fn f() -> Int: add(1 ‸, 2, 3)')?.parameter).toBe('a: Int');
  });

  it('helps with a call left open after an argument ending in a parenthesis', () => {
    const declared = ['fn pair(a: Int, b: Int) -> Int: a + b', 'fn one(n: Int) -> Int: n'];
    expect(help(...declared, 'fn f() -> Int: pair(one(1)‸')).toEqual({
      label: 'fn pair(a: Int, b: Int) -> Int',
      parameter: 'a: Int',
    });
    expect(help(...declared, 'fn f() -> Int: pair(one(1) ‸')?.parameter).toBe('a: Int');
    expect(help(...declared, 'fn f() -> Int: pair((1)‸')?.parameter).toBe('a: Int');
  });

  it('helps with a name being typed after a named argument', () => {
    const connect = 'fn connect(host: String, port: Int) -> Int: port';
    expect(help(connect, 'fn f() -> Int: connect(host: "x", po‸')).toEqual({
      label: 'fn connect(host: String, port: Int) -> Int',
      parameter: 'port: Int',
    });
  });

  it("lists a variant's fields as its constructor's parameters, its enum qualifying it (§3.11)", () => {
    const node = [
      'enum Node:',
      '  Leaf',
      '  Group(title: String, open: Bool = false, ...children: Array<Node>)',
    ];
    const label = 'fn Node.Group(title: String, open: Bool = …, ...children: Array<Node>) -> Node';
    expect(help(...node, 'fn f() -> Node: Group(‸')).toEqual({ label, parameter: 'title: String' });
    expect(help(...node, 'fn f() -> Node: Node.Group("t", open: ‸true)')?.parameter).toBe(
      'open: Bool = …',
    );
    expect(help(...node, 'fn f() -> Node: Group("t", true, Leaf, ‸Leaf)')?.parameter).toBe(
      '...children: Array<Node>',
    );
    expect(help('fn f() -> Result<Int>: Ok(‸1)')).toEqual({
      label: 'fn Result.Ok<T, E>(value: T) -> Result<T, E>',
      parameter: 'value: T',
    });
  });

  it("starts a generic call's help at its `(`, not at its type arguments", () => {
    expect(help('fn id<T>(x: T) -> T: x', 'fn f() -> Int: id<Int>‸(1)')).toBeUndefined();
  });

  it("marks no parameter of a function value's type past its last", () => {
    const { program, module, offset } = programAt('fn f(g: fn(Int) -> Int) -> Int: g(1, ‸2)');
    const [signature] = signatureHelpAt(program, module, offset)?.signatures ?? [];
    expect(signature?.label).toBe('fn(Int) -> Int');
    expect(signature?.activeParameter).toBeUndefined();
  });

  it("shows a function value's type", () => {
    expect(help('fn f(g: fn(Int, String) -> Int) -> Int: g(1, ‸"s")')).toEqual({
      label: 'fn(Int, String) -> Int',
      parameter: 'String',
    });
  });

  it("offers nothing outside a call's parentheses", () => {
    const add = 'fn add(a: Int, b: Int) -> Int: a + b';
    expect(help(add, 'fn f() -> Int: add(1, 2)‸')).toBeUndefined();
    expect(help(add, 'fn f(a: Array<Int>) -> Int: add(a[0, 2)‸')).toBeUndefined();
  });
});
