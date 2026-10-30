/**
 * Layout (§2, §4): indented and one-line bodies, `;` between statements, `{…}`
 * blocks with layout inside them even within parentheses, and annotations on their own lines.
 * Each layout rule broken once costs one diagnostic at the offending token, and the declarations
 * after it still parse.
 */

import { describe, expect, it } from 'vitest';
import { reportedOnce } from '../../../diagnostics/diagnostic.test-kit.ts';
import type { Module } from '../../syntax/declarations.ts';
import { spanIn } from '../../syntax/positions.ts';
import { dump, handMadeSpan } from '../../syntax/tree.test-kit.ts';
import { parserDiagnostics } from '../diagnostics.ts';
import {
  block,
  bodyOf,
  dumpClean,
  functionOf,
  ifThen,
  lines,
  moduleOf,
  parseAs,
  reported,
  expressionStatement as statement,
} from '../parse.test-kit.ts';

const {
  expected,
  unexpectedIndent,
  inconsistentDedent,
  expectedIndentedBlock,
  semicolonAfterInlineBody,
  blockWithoutSemicolon,
  topLevelStatement,
  declarationInBlock,
  danglingAnnotation,
  misplacedAnnotation,
} = parserDiagnostics;

describe('bodies', () => {
  it.each([
    ['a one-line body', 'if a: b', statement(ifThen('a', bodyOf('b')))],
    [
      'an indented body',
      lines('if a:', '    b', '    c'),
      statement(ifThen('a', block(statement('b'), statement('c')))),
    ],
    [
      'nested blocks, the outer resuming after the inner',
      lines('if a:', '    if b:', '        c', '    d'),
      statement(ifThen('a', block(statement(ifThen('b', bodyOf('c'))), statement('d')))),
    ],
    [
      'statements separated by ";" on one line',
      lines('while a:', '    b; c'),
      `(While _ a ${block(statement('b'), statement('c'))})`,
    ],
    [
      'any indentation width, consistent within a block',
      lines('while a:', '  b', '  c'),
      `(While _ a ${block(statement('b'), statement('c'))})`,
    ],
  ])('parses %s', (_name, text, tree) => {
    expect(dumpClean('statement', text)).toBe(tree);
  });

  it('measures a tab-indented line like any other, leaving the tab to the scanner', () => {
    expect(reported('module', lines('fn f():', '\ta', '\tb')).codes).toEqual([]);
  });

  it('skips blank lines and comment lines inside a block', () => {
    const text = lines('fn f():', '    a', '', '    # note', '    b', 'fn g(): 1');
    expect(dumpClean('module', text)).toBe(
      moduleOf(
        functionOf('f', block(statement('a'), statement('b'))),
        functionOf('g', bodyOf('1')),
      ),
    );
  });
});

describe('if chains (§4)', () => {
  const chain = statement(
    `(If [(ConditionalBranch a ${bodyOf('1')}) (ConditionalBranch b ${bodyOf('2')})] (ElseClause ${bodyOf('3')}))`,
  );

  it.each([
    ['on one line', 'if a: 1 elif b: 2 else: 3'],
    ['over several lines', lines('if a:', '    1', 'elif b:', '    2', 'else: 3')],
  ])('continues %s', (_name, text) => {
    expect(dumpClean('statement', text)).toBe(chain);
  });

  it('continues a multi-line if used as a value at the column its line starts', () => {
    const text = lines('const x = if a:', '    1', 'else:', '    2');
    expect(dumpClean('statement', text)).toBe(
      `(VariableDeclaration _ [(NamePattern [x])] _ ${ifThen('a', bodyOf('1'), bodyOf('2'))})`,
    );
  });

  it('binds a dangling else to the nearest if on its column', () => {
    expect(dumpClean('statement', lines('if a: if b: 1', 'else: 2'))).toBe(
      statement(ifThen('a', block(statement(ifThen('b', bodyOf('1'), bodyOf('2')))))),
    );
  });

  it('keeps a line it crossed to when speculation fails', () => {
    const text = lines('fn f():', '    x, if c: a', '    else: b');
    expect(reported('module', text)).toEqual({
      codes: [expected.code, expected.code],
      spanTexts: [',', 'else'],
    });
  });

  it('leaves an else at another column to the enclosing block', () => {
    const text = lines('fn f():', '    if a:', '        1', 'else: 2');
    expect(reported('module', text)).toEqual(reportedOnce(expected.code, 'else'));
  });
});

describe('block expressions', () => {
  it.each([
    ['on one line', '{ a; b }'],
    ['over several lines', lines('{', '    a', '    b', '}')],
    ['with the first statement on the brace line', lines('{ a', '  b }')],
  ])('parse %s', (_name, text) => {
    expect(dumpClean('statement', text)).toBe(
      statement(`(BlockExpression ${block(statement('a'), statement('b'))})`),
    );
  });

  it('keep layout inside them within parentheses', () => {
    const text = lines('f(fn(x): {', '    if x:', '        g()', '    h()', '})');
    expect(dumpClean('statement', text)).toBe(
      statement(
        `(Call f [] [(Lambda _ [(Parameter x _ _)] _ (BlockExpression ${block(
          statement(ifThen('x', bodyOf('(Call g [] [])'))),
          statement('(Call h [] [])'),
        )}))])`,
      ),
    );
  });

  it('nest multi-line blocks directly and inside call arguments', () => {
    const text = lines(
      '{',
      '    const f = fn(): {',
      '        a()',
      '        b()',
      '    }',
      '    retry(fn(): {',
      '        f()',
      '    }, 2)',
      '}',
    );
    expect(dumpClean('statement', text)).toBe(
      statement(
        `(BlockExpression ${block(
          `(VariableDeclaration _ [(NamePattern [f])] _ (Lambda _ [] _ (BlockExpression ${block(
            statement('(Call a [] [])'),
            statement('(Call b [] [])'),
          )})))`,
          statement(
            `(Call retry [] [(Lambda _ [] _ (BlockExpression ${bodyOf('(Call f [] [])')})) 2])`,
          ),
        )})`,
      ),
    );
  });
});

describe('annotations', () => {
  it('apply to the next item from a line of their own, and to their own line before or after', () => {
    const text = lines('struct S:', '    @A', '    @B x: int @C', '    y: int');
    expect(dumpClean('module', text)).toBe(
      '(Module [(StructDeclaration S [] [(DeclaredField x (NamedType [int] []) _ [(Annotation A) (Annotation B) (Annotation C)]) (DeclaredField y (NamedType [int] []) _)])])',
    );
  });

  it('wait on their own line for the next entry in braces, as in an indented block', () => {
    const text = lines('struct S {', '    @A', '    x: int', '}');
    expect(dumpClean('module', text)).toBe(
      '(Module [(StructDeclaration S [] [(DeclaredField x (NamedType [int] []) _ [(Annotation A)])])])',
    );
  });

  it('stay, with nothing to apply to, in the Invalid node covering them', () => {
    const parsed = parseAs('module', lines('fn f(): 1', '@A{x: 1}'));
    const last = (parsed.node as Module).items.at(-1);
    expect(last?.kind).toBe('Invalid');
    expect(last?.annotations?.map((annotation) => dump(parsed, annotation))).toEqual([
      '(Annotation (StructLiteral (NamedType [A] []) [(FieldInitializer x 1)]))',
    ]);
  });

  it("widen their item's span over them, a function's over its header", () => {
    const parsed = parseAs('module', lines('@A', 'fn f(): 1'));
    const [item] = (parsed.node as Module).items;
    expect(item && spanIn(parsed, item.span)).toEqual({ start: 0, end: '@A\nfn f():'.length });
  });
});

describe('layout errors', () => {
  const after = 'fn ok(): 1';

  it.each([
    ['an unexpected indent', lines('fn f():', '    a', '        b'), unexpectedIndent, 'b'],
    ['an indented first declaration', '  fn f(): 1', unexpectedIndent, 'fn'],
    ['an inconsistent dedent', lines('fn f():', '        a', '    b'), inconsistentDedent, 'b'],
    ['a missing body', 'fn f():', expectedIndentedBlock, ''],
    [
      "';' after a one-line body",
      lines('fn f():', '    if x: a; b'),
      semicolonAfterInlineBody,
      ';',
    ],
    [
      "a one-line block without ';'",
      lines('fn f():', '    x = { a }'),
      blockWithoutSemicolon,
      '{ a }',
    ],
    ['a top-level statement', 'a = 1', topLevelStatement, 'a = 1'],
    [
      'a declaration inside a block',
      lines('fn f():', '    struct S { a: int }'),
      declarationInBlock,
      'struct S { a: int }',
    ],
    [
      'an annotation followed by nothing',
      lines('fn f():', '    @Waypoint{"a"}'),
      danglingAnnotation,
      '@Waypoint{"a"}',
    ],
    [
      'an annotation on a match case',
      lines('fn f():', '    match x:', '        @A', '        case 1: 2'),
      misplacedAnnotation,
      '@A',
    ],
  ])('reports %s once and parses on', (_name, text, diagnostic, spanText) => {
    const source = lines(text, after);
    expect(reported('module', source)).toEqual(reportedOnce(diagnostic.code, spanText));
    const parsed = parseAs('module', source);
    const { items } = parsed.node as Module;
    expect(dump(parsed, items.at(-1) ?? { kind: 'Missing', span: handMadeSpan(0) })).toBe(
      functionOf('ok', bodyOf('1')),
    );
  });
});
