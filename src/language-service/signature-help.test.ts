import { describe, expect, it } from 'vitest';
import { programAt } from './language-service.test-kit.ts';
import { signatureHelpAt } from './signature-help.ts';

/** The active signature's label, with its active parameter's text. */
function help(...lines: readonly string[]) {
  const { program, module, offset } = programAt(...lines);
  const found = signatureHelpAt(program, module, offset);
  const active = found?.signatures[found.active];
  const parameter = active?.activeParameter;
  const span = parameter === undefined ? undefined : active?.parameters[parameter];
  return active && { label: active.label, parameter: span && active.label.slice(...span) };
}

describe('signature help', () => {
  it('marks the parameter the argument under the cursor gives', () => {
    expect(help('fn add(a: int, b: int) -> int: a + b', 'fn f() -> int: add(1, ‸2)')).toEqual({
      label: 'fn add(a: int, b: int) -> int',
      parameter: 'b: int',
    });
  });

  it("doesn't count a method's receiver among the written arguments", () => {
    expect(
      help(
        'struct P:',
        '  a: int',
        'fn plus(self: P, n: int) -> int: self.a + n',
        'fn f(p: P) -> int: p.plus(‸1)',
      ),
    ).toEqual({ label: 'fn plus(self: P, n: int) -> int', parameter: 'n: int' });
  });

  it('marks a named argument by its name, and a rest argument by its rest parameter', () => {
    const declared = 'fn g(a: int, b: int = 0, ...rest: Array<int>) -> int: a';
    expect(help(declared, 'fn f() -> int: g(1, b: ‸2)')?.parameter).toBe('b: int = …');
    expect(help(declared, 'fn f() -> int: g(1, 2, 3, ‸4)')?.parameter).toBe('...rest: Array<int>');
  });

  it('helps with a call being typed, before it resolves', () => {
    const add = 'fn add(a: int, b: int, c: int) -> int: a + b + c';
    expect(help(add, 'fn f() -> int: add(1, ‸')).toEqual({
      label: 'fn add(a: int, b: int, c: int) -> int',
      parameter: 'b: int',
    });
    expect(help(add, 'fn f() -> int: add(1, ‸, 3)')?.parameter).toBe('b: int');
    expect(help(add, 'fn f() -> int: add( ‸, 2)')?.parameter).toBe('a: int');
    expect(help(add, 'fn f() -> int: add(1 ‸, 2, 3)')?.parameter).toBe('a: int');
  });

  it('helps with a call left open after an argument ending in a parenthesis', () => {
    const declared = ['fn pair(a: int, b: int) -> int: a + b', 'fn one(n: int) -> int: n'];
    expect(help(...declared, 'fn f() -> int: pair(one(1)‸')).toEqual({
      label: 'fn pair(a: int, b: int) -> int',
      parameter: 'a: int',
    });
    expect(help(...declared, 'fn f() -> int: pair(one(1) ‸')?.parameter).toBe('a: int');
    expect(help(...declared, 'fn f() -> int: pair((1)‸')?.parameter).toBe('a: int');
  });

  it('helps with a name being typed after a named argument', () => {
    const connect = 'fn connect(host: string, port: int) -> int: port';
    expect(help(connect, 'fn f() -> int: connect(host: "x", po‸')).toEqual({
      label: 'fn connect(host: string, port: int) -> int',
      parameter: 'port: int',
    });
  });

  it("starts a generic call's help at its `(`, not at its type arguments", () => {
    expect(help('fn id<T>(x: T) -> T: x', 'fn f() -> int: id<int>‸(1)')).toBeUndefined();
  });

  it("marks no parameter of a function value's type past its last", () => {
    const { program, module, offset } = programAt('fn f(g: fn(int) -> int) -> int: g(1, ‸2)');
    const [signature] = signatureHelpAt(program, module, offset)?.signatures ?? [];
    expect(signature?.label).toBe('fn(int) -> int');
    expect(signature?.activeParameter).toBeUndefined();
  });

  it("shows a function value's type", () => {
    expect(help('fn f(g: fn(int, string) -> int) -> int: g(1, ‸"s")')).toEqual({
      label: 'fn(int, string) -> int',
      parameter: 'string',
    });
  });

  it("offers nothing outside a call's parentheses", () => {
    const add = 'fn add(a: int, b: int) -> int: a + b';
    expect(help(add, 'fn f() -> int: add(1, 2)‸')).toBeUndefined();
    expect(help(add, 'fn f(a: Array<int>) -> int: add(a[0, 2)‸')).toBeUndefined();
  });
});
