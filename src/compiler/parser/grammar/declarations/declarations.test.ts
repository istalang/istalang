/**
 * Declaration grammar (§3): imports, structs (indented, braced, bare, with the indented field
 * sugar, shared or not), enums, traits, type aliases, every extern form, static functions, type
 * parameters with constraints and defaults, and the top-level-only rule for statements.
 */

import { describe, expect, it } from 'vitest';
import { reportedOnce } from '../../../../foundation/diagnostics/diagnostic.test-kit.ts';
import { parserDiagnostics } from '../../diagnostics.ts';
import {
  bodyOf,
  declaredField,
  dumpClean,
  dumpOf,
  field,
  int,
  lines,
  moduleOf,
  named,
  parseAs,
  reported,
  restField,
} from '../../parse.test-kit.ts';

const { expected, topLevelStatement, externWithBody } = parserDiagnostics;

const typeParameter = (name: string): string => `(TypeParameter _ ${name} _ [] _)`;
const string = named('String');

describe('imports', () => {
  it.each([
    [
      "import approve, Verdict from 'purchase/approve'",
      '(NamedImport [(ImportedName approve _) (ImportedName Verdict _)] "purchase/approve")',
    ],
    [
      "import (approve, decide as decidePurchase) from 'purchase/approve'",
      '(NamedImport [(ImportedName approve _) (ImportedName decide decidePurchase)] isParenthesized "purchase/approve")',
    ],
    ["import * as time from 'time'", '(NamespaceImport time "time")'],
  ])('parses %s', (text, tree) => {
    expect(dumpClean('module', text)).toBe(moduleOf(tree));
  });

  it.each([
    ['import a from m', 'm'],
    ['import a', ''],
    ["import from 'time'", 'from'],
    ["import a, from 'time'", 'from'],
    ["import in from 'time'", 'in'],
  ])('reports a malformed import once: %s', (text, spanText) => {
    expect(reported('module', text)).toEqual(reportedOnce(expected.code, spanText));
  });

  it.each([
    ["import from 'time'", '(NamedImport [(ImportedName <missing name> _)] "time")'],
    [
      "import a, from 'time'",
      '(NamedImport [(ImportedName a _) (ImportedName <missing name> _)] "time")',
    ],
    ["import in from 'time'", '(NamedImport [(ImportedName <missing name> _)] "time")'],
  ])('reads the path of %s, whose name is still being written', (text, tree) => {
    expect(dumpOf(parseAs('module', text))).toBe(moduleOf(tree));
  });
});

describe('type declarations', () => {
  it.each([
    ['struct Marker', '(StructDeclaration Marker [] [] [])'],
    [
      'struct Req { id: Int, value: String }',
      `(StructDeclaration Req [] [${declaredField('id', int)} ${declaredField('value', string)}] [])`,
    ],
    [
      lines(
        'struct Response:',
        '    id: String',
        '    data:',
        '        value: Int',
        '        result: String',
      ),
      `(StructDeclaration Response [] [${declaredField('id', string)} ${declaredField('data', `(StructType [${field('value', int)} ${field('result', string)}])`)}] [])`,
    ],
    [
      'struct Node<T is Sendable & Comparable = Int> { value: T }',
      `(StructDeclaration Node [(TypeParameter _ T _ [${named('Sendable')} ${named('Comparable')}] ${int})] [${declaredField('value', named('T'))}] [])`,
    ],
    [
      lines('enum Decision:', '    Approved(by: String)', '    Expired'),
      `(EnumDeclaration Decision [] [(Variant Approved [${declaredField('by', string)}]) (Variant Expired [])] [])`,
    ],
    [
      'enum Color { Red, Green, Blue }',
      '(EnumDeclaration Color [] [(Variant Red []) (Variant Green []) (Variant Blue [])] [])',
    ],
    [
      'enum Node { Group(title: String, open = false, ...children: Array<Node>) }',
      `(EnumDeclaration Node [] [(Variant Group [${declaredField('title', string)} ${declaredField('open', '_', 'false')} ${restField('children', '(NamedType [Array] [(NamedType [Node] [])])')}])] [])`,
    ],
    [
      lines(
        'enum Decision:',
        '    Rejected(',
        '        by: String',
        '        reason: String',
        '    )',
      ),
      `(EnumDeclaration Decision [] [(Variant Rejected [${declaredField('by', string)} ${declaredField('reason', string)}])] [])`,
    ],
    [
      lines(
        'trait Monoid:',
        '    fn Self.zero() -> Self',
        '    fn add(left: Self, right: Self) -> Self',
        '    value: Int',
      ),
      `(TraitDeclaration Monoid [] [(FunctionDeclaration Self zero [] [] ${named('Self')} _) (FunctionDeclaration _ add [] [(Parameter left _ ${named('Self')} _) (Parameter right _ ${named('Self')} _)] ${named('Self')} _) ${field('value', int)}])`,
    ],
    [
      'type Entries<T> = Array<(String, T)>',
      `(TypeAliasDeclaration Entries [${typeParameter('T')}] (NamedType [Array] [(TupleType [${string} ${named('T')}])]))`,
    ],
    [
      'type Entries<T>= Array<T>',
      `(TypeAliasDeclaration Entries [${typeParameter('T')}] (NamedType [Array] [${named('T')}]))`,
    ],
    [
      lines('shared struct Inbox<T>:', '    backlog: Array<T>', '    queued: Int = 0'),
      `(SharedStructDeclaration Inbox [${typeParameter('T')}] [${declaredField('backlog', `(NamedType [Array] [${named('T')}])`)} ${declaredField('queued', int, '0')}] [])`,
    ],
    ['shared struct Token', '(SharedStructDeclaration Token [] [] [])'],
    [
      lines('struct Retry:', '    times: Int = 3', '    backoff = times * 2'),
      `(StructDeclaration Retry [] [${declaredField('times', int, '3')} ${declaredField('backoff', '_', '(Binary times * 2)')}] [])`,
    ],
    [
      'enum Shape { Circle(r: Float = 1.0) }',
      `(EnumDeclaration Shape [] [(Variant Circle [${declaredField('r', named('Float'), '1')}])] [])`,
    ],
  ])('parses %s', (text, tree) => {
    expect(dumpClean('module', text)).toBe(moduleOf(tree));
  });

  it.each([
    ['struct S { data: { n: Int = 1 } }', '1'],
    ['trait T { n: Int = 1 }', '1'],
  ])('reports a default outside a declaration once: %s', (text, spanText) => {
    expect(reported('module', text)).toEqual(
      reportedOnce(parserDiagnostics.misplacedFieldDefault.code, spanText),
    );
  });

  it.each([
    [
      'enum E { V { a: Int, b: String = "x" @JsonName{"bee"} } }',
      'V(a: Int, b: String = "x" @JsonName{"bee"})',
    ],
    ['enum E { V { a: Int, ...b: Array<Int> } }', 'V(a: Int, ...b: Array<Int>)'],
    ['enum E { V {} }', 'write V '],
  ])("refuses a variant's fields in braces once, naming what to write: %s", (text, corrected) => {
    const { diagnostics } = parseAs('module', text);
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      parserDiagnostics.bracedVariant.code,
    ]);
    expect(diagnostics[0]?.message).toContain(corrected);
  });

  it("reads a variant's field type on its line, never as an indented block of fields", () => {
    expect(reported('module', 'enum E:\n  V(a:\n  B').codes).toEqual([
      expected.code,
      parserDiagnostics.unclosedBracket.code,
    ]);
  });

  it('reads `shared` as a name where no `struct` follows it', () => {
    expect(dumpClean('module', 'const shared = 1')).toBe(
      moduleOf('(VariableDeclaration _ [(NamePattern [shared] [])] _ 1)'),
    );
  });
});

describe('externs and functions', () => {
  it.each([
    [
      'extern fn chargeCard(id: String) -> Result<String>',
      `(FunctionDeclaration isExtern _ chargeCard [] [(Parameter id _ ${string} _)] (NamedType [Result] [${string}]) _)`,
    ],
    [
      'extern approvalDeadline: Duration',
      `(ExternConstantDeclaration approvalDeadline ${named('Duration')})`,
    ],
    [
      'extern sendable struct Queue<T is Sendable>',
      `(ExternStructDeclaration sendable Queue [(TypeParameter _ T _ [${named('Sendable')}] _)] [] [])`,
    ],
    [
      'extern shared struct Slot<T>',
      `(ExternStructDeclaration shared Slot [${typeParameter('T')}] [] [])`,
    ],
    ['extern live struct Socket', '(ExternStructDeclaration live Socket [] [] [])'],
    ['extern struct Zone', '(ExternStructDeclaration _ Zone [] [] [])'],
    [
      'extern shared struct Future<T, K in Persistence>:\n  type Mode = K',
      `(ExternStructDeclaration shared Future [${typeParameter('T')} (TypeParameter _ K ${named('Persistence')} [] _)] [] [(AssociatedType Mode ${named('K')})])`,
    ],
    [
      'fn Duration.zero() -> Duration: Duration{value: 0}',
      `(FunctionDeclaration Duration zero [] [] ${named('Duration')} ${bodyOf(`(StructLiteral ${named('Duration')} [(FieldInitializer value 0)])`)})`,
    ],
    [
      'const limit: Int = 50_000',
      `(VariableDeclaration _ [(NamePattern [limit] [])] ${int} 50000)`,
    ],
  ])('parses %s', (text, tree) => {
    expect(dumpClean('module', text)).toBe(moduleOf(tree));
  });

  it.each([
    ['extern fn f(): 1', externWithBody, '1'],
    ['fn f', expected, ''],
    ['let x = 1', topLevelStatement, 'let x = 1'],
    ['hold let x = 1', topLevelStatement, 'hold let x = 1'],
  ])('reports %s once', (text, diagnostic, spanText) => {
    expect(reported('module', text)).toEqual(reportedOnce(diagnostic.code, spanText));
  });
});

describe('member type parameters (§3.5)', () => {
  it.each([
    ['fn describe<S in Status>(s: S): s', `[(TypeParameter _ S ${named('Status')} [] _)]`],
    [
      'struct Entry<S, K in "a" | "b">:\n  key: K',
      `[${typeParameter('S')} (TypeParameter _ K (UnionType [(LiteralType "a") (LiteralType "b")]) [] _)]`,
    ],
  ])('reads `name in Type` in %j', (text, parameters) => {
    expect(dumpClean('module', text)).toContain(parameters);
  });

  it.each([
    ['fn f<S in Status is Stringable>(): 1', 'is Stringable'],
    ['fn f<S in Status is A & B = C>(): 1', 'is A & B'],
  ])('reports a constraint beside the membership in %j once', (text, spanText) => {
    expect(reported('module', text)).toEqual(
      reportedOnce(parserDiagnostics.memberParameterAlone.code, spanText),
    );
  });
});

describe('member-bounded associated types (§3.10)', () => {
  it('reads `type Name in Type` in a trait', () => {
    expect(dumpClean('module', 'trait Waits:\n  type Mode in Persistence')).toContain(
      `(RequiredAssociatedType Mode ${named('Persistence')} [])`,
    );
  });

  it('reports a constraint beside the membership once', () => {
    expect(reported('module', 'trait Waits:\n  type Mode in Persistence is Stringable')).toEqual(
      reportedOnce(parserDiagnostics.memberParameterAlone.code, 'is Stringable'),
    );
  });
});

describe('extern struct bodies (§3.6)', () => {
  it('reports a field, the host having fields of its own', () => {
    expect(reported('module', 'extern struct Zone:\n  name: String\n  type Mode = "live"')).toEqual(
      reportedOnce(parserDiagnostics.externStructField.code, 'name: String'),
    );
  });
});

describe('variance words', () => {
  it('reads `gives` and `takes` before a name or a pack', () => {
    expect(dumpClean('module', 'extern struct F<gives T, takes U, gives ...A>')).toContain(
      '[(TypeParameter gives T _ [] _) (TypeParameter takes U _ [] _) (TypeParameter gives isPack A _ [] _)]',
    );
  });

  it('reads a parameter named `gives` as a name', () => {
    expect(dumpClean('module', 'struct S<gives>')).toContain(`[${typeParameter('gives')}]`);
  });

  it('reports two variance words once, over both', () => {
    expect(reported('module', 'struct S<gives takes T>')).toEqual(
      reportedOnce(parserDiagnostics.twoVariances.code, 'gives takes'),
    );
  });
});

describe('type parameter packs', () => {
  it('reads `...A` as a pack, beside plain type parameters', () => {
    expect(dumpClean('module', 'fn logged<...A, R>(f: fn(...A) -> R): f')).toContain(
      `[(TypeParameter _ isPack A _ [] _) ${typeParameter('R')}]`,
    );
  });
});

describe('context constants (proposal 9)', () => {
  it.each([
    ['ista const verdicts = Inbox.create()', '(ContextConstantDeclaration verdicts _ '],
    ['ista const count: Int = 0', `(ContextConstantDeclaration count ${int} 0)`],
  ])('parses %s', (text, tree) => {
    expect(dumpClean('module', text)).toContain(tree);
  });

  it('reports a head of a top-level const whose kind is live, once', () => {
    expect(reported('module', 'live const count = 0')).toEqual(
      reportedOnce(parserDiagnostics.contextConstantWord.code, 'live const'),
    );
  });

  it('reports a modifier a context constant takes none of as any head does', () => {
    expect(reported('module', 'extern ista const count = 0')).toEqual(
      reportedOnce(parserDiagnostics.misplacedModifier.code, 'extern'),
    );
    expect(reported('module', 'ista ista const count = 0')).toEqual(
      reportedOnce(parserDiagnostics.repeatedModifier.code, 'ista'),
    );
  });

  it('allows one only at the top level', () => {
    expect(reported('module', 'fn f():\n  ista const count = 0')).toEqual(
      reportedOnce(parserDiagnostics.declarationInBlock.code, 'ista const count = 0'),
    );
  });
});
