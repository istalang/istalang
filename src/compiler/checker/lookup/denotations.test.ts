import { describe, expect, it } from 'vitest';
import type { Denotation } from '../surface/denotation.ts';
import { intType, stringType, tupleType } from '../types/type/primitives.ts';
import { typeText } from '../types/type-text.ts';
import { checkedMain } from './lookup.test-kit.ts';

const text = `struct Pair { first: Int, second: Int }
fn Pair.zero() -> Pair: Pair{first: 0, second: 0}
fn total(self: Pair) -> Int: self.first + self.second
fn sum(a: Int, b: Int = 1) -> Int: a + b
fn main() -> Int:
  const first = 1
  const p = Pair{first, second: 2}
  match p:
    case Pair{first, second as s}: sum(first, b: s)
    case _: p.total()
fn Pair.from(n: Int) -> Pair: Pair{first: n, second: n}
fn converted() -> Pair: Pair(3)
trait Measured:
  size: Int
  fn measure(self: Self) -> Int
  fn Self.unit() -> Self
fn measuredSize<T is Measured>(t: T) -> Int: t.size + t.measure()
`;

/** The name a declaration is declared with, or its kind where it has none to show. */
function declaredName(declared: Denotation['declared']): string {
  switch (declared.kind) {
    case 'field':
      return declared.field.name;
    case 'function':
      return declared.declaration.name.text;
    case 'variable':
      return declared.entity.name.text;
    default:
      return declared.kind;
  }
}

/** What each denotation declares, by kind and name, with its type's text. */
function described(denotations: readonly Denotation[]): readonly string[] {
  return denotations.map(
    ({ declared, type }) =>
      `${declared.kind} ${declaredName(declared)}: ${type === undefined ? '-' : typeText(type)}`,
  );
}

describe('what an identifier denotes', () => {
  const { checker, module, named, first } = checkedMain(text);
  const at = (name: string, nth: number) =>
    described(checker.lookup.denotationsOf(module, named(name, nth)));

  it('answers a shorthand with its field and its variable', () => {
    expect(at('first', 4)).toEqual(['field first: Int', 'variable first: Int']);
    expect(at('first', 5)).toEqual(['field first: Int', 'variable first: Int']);
  });

  it("answers a field's declaring name, a read and a literal's name with the field", () => {
    expect(at('first', 0)).toEqual(['field first: Int']);
    expect(at('first', 1)).toEqual(['field first: Int']);
    expect(at('first', 2)).toEqual(['field first: Int']);
  });

  it('answers a call, a method call and a named argument with what the call resolved to', () => {
    expect(at('sum', 1)).toEqual(['function sum: -']);
    expect(at('total', 1)).toEqual(['function total: -']);
    expect(at('b', 2)).toEqual(['variable b: Int']);
  });

  it("answers a static's and a trait's function by its declaring name", () => {
    expect(at('zero', 0)).toEqual(['function zero: -']);
    expect(at('measure', 0)).toEqual(['function measure: -']);
  });

  it('answers a conversion with its type and the function converting', () => {
    expect(at('Pair', 11)).toEqual(['type type: Pair', 'function from: -']);
  });

  it("answers a parameter's declaring name with its signature's type", () => {
    expect(at('a', 0)).toEqual(['variable a: Int']);
  });

  it('answers a written type with the type it denotes', () => {
    const written = first('NamedType');
    const type = written && checker.lookup.typeOfNode(module, written);
    expect(type && typeText(type)).toBe('Int');
  });

  it('lists the fields, methods and static functions of a type', () => {
    const pair = checker.lookup.denotationsOf(module, named('Pair', 0))[0]?.type;
    const members = pair && checker.lookup.membersOf(module, pair);
    expect(members?.fields.map(({ name }) => name)).toEqual(['first', 'second']);
    expect(members?.methods.map(({ name }) => name.text)).toEqual(['total']);
    expect(members?.statics.map(({ name }) => name.text)).toEqual(['zero', 'from']);
  });

  it("lists a tuple's elements by position as its fields", () => {
    const members = checker.lookup.membersOf(module, tupleType([intType, stringType]));
    expect(members.fields.map(({ name, type }) => `${name}: ${typeText(type)}`)).toEqual([
      '0: Int',
      '1: String',
    ]);
  });

  it('answers a tag read from a value with the method its template calls', () => {
    const tagged = checkedMain(
      'struct Db { prefix: String }\nfn query(self: Db, parts: Array<String>, n: Int) -> String: self.prefix\nfn main() -> String: Db{prefix: ">"}.query`a${1}`\n',
    );
    expect(tagged.checker.diagnosticsOf(tagged.module)).toEqual([]);
    const call = tagged.checker.lookup.denotationsOf(tagged.module, tagged.named('query', 1));
    expect(described(call)).toEqual(['function query: -']);
  });

  it('answers a hold naming its own function with that function', () => {
    const held = checkedMain(
      'async fn work(n: Int):\n  for i in 0..n:\n    hold(work) _ = 1\nfn main(): 0\n',
    );
    expect(held.checker.diagnosticsOf(held.module)).toEqual([]);
    const label = held.checker.lookup.denotationsOf(held.module, held.named('work', 1));
    expect(described(label)).toEqual(['function work: -']);
  });

  it('lists what the constraints on a type parameter require', () => {
    const t = checker.lookup.denotationsOf(module, named('t', 1))[0]?.type;
    const members = t && checker.lookup.membersOf(module, t);
    expect(members?.fields.map(({ name }) => name)).toEqual(['size']);
    expect(members?.methods.map(({ name }) => name.text)).toEqual(['measure']);
    expect(members?.statics.map(({ name }) => name.text)).toEqual(['unit']);
  });
});

describe('what a function imported or named through a module denotes', () => {
  it("is the module's own function, not a prelude function of that name", () => {
    const lib = 'struct Note { text: String }\nfn read(self: Note) -> String: self.text\n';
    const imported = checkedMain(
      `import Note, read from 'lib'\nfn main() -> String: Note{text: "a"}.read()\n`,
      { lib },
    );
    expect(
      described(imported.checker.lookup.denotationsOf(imported.module, imported.named('read', 0))),
    ).toEqual(['function read: -']);
  });
});
