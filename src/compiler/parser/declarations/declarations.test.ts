/**
 * Declaration grammar (§3): imports, structs (indented, braced, bare, with the indented field
 * sugar), enums, traits, type aliases, every extern form, static functions, type parameters with
 * constraints and defaults, and the top-level-only rule for statements.
 */

import { describe, expect, it } from 'vitest';
import { reportedOnce } from '../../../diagnostics/diagnostic.test-kit.ts';
import { parserDiagnostics } from '../diagnostics.ts';
import {
  bodyOf,
  dumpClean,
  field,
  int,
  lines,
  moduleOf,
  named,
  reported,
} from '../parse.test-kit.ts';

const { expected, topLevelStatement, externWithBody } = parserDiagnostics;

const typeParameter = (name: string): string => `(TypeParameter ${name} [] _)`;
const string = named('string');

describe('imports', () => {
  it.each([
    [
      "import approve, Verdict from 'purchase/approve'",
      '(NamedImport [approve Verdict] "purchase/approve")',
    ],
    ["import * as time from 'time'", '(NamespaceImport time "time")'],
  ])('parses %s', (text, tree) => {
    expect(dumpClean('module', text)).toBe(moduleOf(tree));
  });

  it.each([
    ['import a from m', 'm'],
    ['import a', ''],
  ])('reports a malformed import once: %s', (text, spanText) => {
    expect(reported('module', text)).toEqual(reportedOnce(expected.code, spanText));
  });
});

describe('type declarations', () => {
  it.each([
    ['struct Marker', '(StructDeclaration Marker [] [])'],
    [
      'struct Req { id: int; value: string }',
      `(StructDeclaration Req [] [${field('id', int)} ${field('value', string)}])`,
    ],
    [
      lines(
        'struct Response:',
        '    id: string',
        '    data:',
        '        value: int',
        '        result: string',
      ),
      `(StructDeclaration Response [] [${field('id', string)} ${field('data', `(StructType [${field('value', int)} ${field('result', string)}])`)}])`,
    ],
    [
      'struct Node<T is Sendable & Comparable = int> { value: T }',
      `(StructDeclaration Node [(TypeParameter T [${named('Sendable')} ${named('Comparable')}] ${int})] [${field('value', named('T'))}])`,
    ],
    [
      lines('enum Decision:', '    Approved { by: string }', '    Expired'),
      `(EnumDeclaration Decision [] [(Variant Approved [${field('by', string)}]) (Variant Expired [])])`,
    ],
    [
      'enum Color { Red; Green; Blue }',
      '(EnumDeclaration Color [] [(Variant Red []) (Variant Green []) (Variant Blue [])])',
    ],
    [
      lines(
        'trait Monoid:',
        '    fn Self.zero() -> Self',
        '    fn add(left: Self, right: Self) -> Self',
        '    value: int',
      ),
      `(TraitDeclaration Monoid [] [(FunctionDeclaration Self zero [] [] ${named('Self')} _) (FunctionDeclaration _ add [] [(Parameter left ${named('Self')} _) (Parameter right ${named('Self')} _)] ${named('Self')} _) ${field('value', int)}])`,
    ],
    [
      'type Entries<T> = Array<(string, T)>',
      `(TypeAliasDeclaration Entries [${typeParameter('T')}] (NamedType [Array] [(TupleType [${string} ${named('T')}])]))`,
    ],
    [
      'type Entries<T>= Array<T>',
      `(TypeAliasDeclaration Entries [${typeParameter('T')}] (NamedType [Array] [${named('T')}]))`,
    ],
  ])('parses %s', (text, tree) => {
    expect(dumpClean('module', text)).toBe(moduleOf(tree));
  });
});

describe('externs and functions', () => {
  it.each([
    [
      'extern fn chargeCard(id: string) -> Result<string>',
      `(FunctionDeclaration isExtern _ chargeCard [] [(Parameter id ${string} _)] (NamedType [Result] [${string}]) _)`,
    ],
    [
      'extern approvalDeadline: Duration',
      `(ExternConstantDeclaration approvalDeadline ${named('Duration')})`,
    ],
    [
      'extern sendable struct Queue<T is Sendable>',
      `(ExternStructDeclaration isSendable Queue [(TypeParameter T [${named('Sendable')}] _)])`,
    ],
    ['extern struct Slot<T>', `(ExternStructDeclaration Slot [${typeParameter('T')}])`],
    [
      'fn Duration.zero() -> Duration: Duration{value: 0}',
      `(FunctionDeclaration Duration zero [] [] ${named('Duration')} ${bodyOf(`(StructLiteral ${named('Duration')} [(FieldInitializer value 0)])`)})`,
    ],
    ['const limit: int = 50_000', `(VariableDeclaration [limit] ${int} 50000)`],
  ])('parses %s', (text, tree) => {
    expect(dumpClean('module', text)).toBe(moduleOf(tree));
  });

  it.each([
    ['extern fn f(): 1', externWithBody, '1'],
    ['fn f', expected, ''],
    ['let x = 1', topLevelStatement, 'let x = 1'],
    ['fn let x = 1', topLevelStatement, 'fn let x = 1'],
  ])('reports %s once', (text, diagnostic, spanText) => {
    expect(reported('module', text)).toEqual(reportedOnce(diagnostic.code, spanText));
  });
});
