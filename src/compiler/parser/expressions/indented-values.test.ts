/**
 * Parsing indented values (proposal 5 §1): every opening token ('=', 'return', an entry's ':',
 * an item's '-'), anonymous and named 'T:' / 'new T:' forms, every entry and item shape,
 * alignment of '- key: value' siblings, one parse whatever the expected type, and the places and
 * forms the grammar refuses.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { reportedOnce } from '../../../diagnostics/diagnostic.test-kit.ts';
import { createSourceText } from '../../../text/source-text.ts';
import { scan } from '../../scanner/scan.ts';
import type { StructDeclaration } from '../../syntax/declarations.ts';
import type { VariableDeclaration } from '../../syntax/statements.ts';
import { dump, errorNodes, spanViolations, strayBodies } from '../../syntax/tree.test-kit.ts';
import type { SyntaxTree } from '../../syntax/tree.ts';
import { parserDiagnostics } from '../diagnostics.ts';
import { dumpClean, lines, reported } from '../parse.test-kit.ts';
import { parse } from '../parse.ts';

function parseModuleText(text: string): SyntaxTree {
  const source = createSourceText('test.ista', text);
  return parse(source, scan(source));
}

function moduleProblems(text: string): readonly string[] {
  const tree = parseModuleText(text);
  return [
    ...tree.diagnostics.map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`),
    ...spanViolations(tree, tree.root),
    ...strayBodies(tree),
    ...errorNodes(tree, tree.root).map((node) => `error node ${node.kind}`),
  ];
}

function initializerDump(header: string, body: string): string {
  const tree = parseModuleText(`${header}\n${body}`);
  const declaration = tree.root.items[0] as VariableDeclaration;
  return `${moduleProblems(`${header}\n${body}`).join('|')}:${dump(tree, declaration.initializer)}`;
}

describe('indented value openings (§1)', () => {
  it.each([
    [
      'const with expected type, named type T:, and both',
      lines(
        'const a: Config =',
        '  retries: 3',
        '  region: "eu"',
        'const b = Config:',
        '  retries: 3',
        'const c: Config = Config:',
        '  retries: 3',
      ),
    ],
    [
      'let, hold let and hold _ inside a function',
      lines(
        'fn f():',
        '  let a: Config =',
        '    retries: 3',
        '  hold let b = Config:',
        '    retries: 5',
        '  hold _ = Config:',
        '    retries: 1',
      ),
    ],
    [
      'assignment to variable, field, index and shared struct dereference',
      lines(
        'fn f():',
        '  c =',
        '    retries: 3',
        '  s.config = Config:',
        '    retries: 4',
        '  xs[0] =',
        '    - 1',
        '    - 2',
        '  *u =',
        '    count: 10',
      ),
    ],
    [
      'field defaults in a struct declaration',
      lines(
        'struct Service:',
        '  name: String',
        '  retry: Retry =',
        '    times: 3',
        '    backoffMs: 200',
        '  fallback = Retry:',
        '    times: 1',
        '    backoffMs: 50',
      ),
    ],
    [
      'return with anonymous block, T:, and new T:',
      lines(
        'fn a() -> Config:',
        '  return',
        '    retries: 3',
        '    region: "eu"',
        'fn b() -> Pair<Int, String>:',
        '  return Pair<Int, String>:',
        '    first: 1',
        '    second: "x"',
        'fn c() -> Counter:',
        '  return new Counter:',
        '    n: 0',
      ),
    ],
    [
      'qualified names, generic types, Map, Array, and new T:',
      lines(
        'const a = m.Service:',
        '  name: "api"',
        'const b = Decision.Rejected:',
        '  by: "legal"',
        '  reason: "late"',
        'const c = Pair<Int, String>:',
        '  first: 1',
        '  second: "ok"',
        'const d = Map<String, Int>:',
        '  a: 1',
        '  "b": 2',
        'const e = Array<Int>:',
        '  - 10',
        '  - 20',
        'const f = new Shared<Int>:',
        '  value: 42',
      ),
    ],
  ])('parses %s cleanly into a well-nested tree', (_name, text) => {
    expect(moduleProblems(text)).toEqual([]);
  });

  it('keeps a struct field without "=" as an indented field block (StructType), not a default value', () => {
    const text = lines(
      'struct Service:',
      '  retry:',
      '    times: Int',
      '    backoffMs: Int',
      '  defaultRetry =',
      '    times: 3',
      '    backoffMs: 200',
    );
    expect(moduleProblems(text)).toEqual([]);
    const tree = parseModuleText(text);
    const declaration = tree.root.items[0] as StructDeclaration;
    const [typeField, defaultField] = declaration.fields;
    expect(typeField?.kind === 'DeclaredField' && typeField.type?.kind).toBe('StructType');
    expect(typeField?.kind === 'DeclaredField' && typeField.defaultValue).toBeUndefined();
    expect(defaultField?.kind === 'DeclaredField' && defaultField.type).toBeUndefined();
    expect(defaultField?.kind === 'DeclaredField' && defaultField.defaultValue).toBeDefined();
  });
});

describe('entries, items, alignment and continuation (§1)', () => {
  it.each([
    [
      'named keys, quoted keys, shorthand names, comma-separated entries on one line, and spreads',
      lines(
        'const api = Service:',
        '  ...base',
        '  name',
        '  host, port',
        '  times: 3, backoffMs: 200',
        '  LOG_LEVEL: "debug"',
        '  "x-region": "eu"',
        "  'for': 1",
      ),
    ],
    [
      'nested entry blocks (key: and key: T: and key: new T:) and struct comprehension last',
      lines(
        'const api = Service:',
        '  retry:',
        '    times: 3',
        '    backoffMs: 200',
        '  backup: Retry:',
        '    times: 1',
        '    backoffMs: 50',
        '  cell: new Shared<Int>:',
        '    value: 7',
        '  for field, node in ...rest: [field]: node.value',
      ),
    ],
    [
      'array items (- value, - ...spread, - -1, - alone, - T:, - new T:)',
      lines(
        'const matrix =',
        '  - 1',
        '  - -1',
        '  - ...middle',
        '  - [2, 3]',
        '  -',
        '    - 4',
        '    - 5',
        '  - Point:',
        '      x: 1',
        '      y: 2',
        '  - new Counter:',
        '      n: 9',
      ),
    ],
    [
      '- key: value opening an anonymous keyed value whose other entries align with key',
      lines(
        'const services =',
        '  - name: "api"',
        '    port: 80',
        '    retry:',
        '      times: 3',
        '      backoffMs: 200',
        '    "x-region": "eu"',
        '    enabled',
        '  - "id": "worker"',
        '    port: 90',
        '  - name: "cron"',
      ),
    ],
    [
      'comments and blank lines anywhere, and expressions continuing in brackets and templates',
      lines(
        'fn build(a: Int, b: Int) -> Service:',
        '  # before return',
        '  return Service: # after colon',
        '    # leading comment',
        '',
        '    name: `service-${a',
        '      + b}`',
        '',
        '    # between entries',
        '    ports: [80, 443]',
        '    total: compute(a, b)',
      ),
    ],
  ])('parses %s cleanly', (_name, text) => {
    expect(moduleProblems(text)).toEqual([]);
  });

  it('ends the indented value at the first line at or left of the opening line', () => {
    const text = lines(
      'fn f() -> Int:',
      '  const a = Service:',
      '    name: "api"',
      '    retry:',
      '      times: 3',
      '  const b = 2',
      '  a.retry.times + b',
    );
    expect(moduleProblems(text)).toEqual([]);
    expect(parseModuleText(text).root.items).toHaveLength(1);
  });
});

describe('one parse whatever the expected type (§1, note 11)', () => {
  it('parses a keyed block identically regardless of the expected type annotation', () => {
    const body = lines(
      '  ...base',
      '  name: "api"',
      '  "x-region": "eu"',
      '  shorthand',
      '  nested:',
      '    count: 1',
    );
    const untyped = initializerDump('const x =', body);
    expect(untyped.startsWith(':')).toBe(true);
    expect(initializerDump('const x: Service =', body)).toBe(untyped);
    expect(initializerDump('const x: Map<String, String> =', body)).toBe(untyped);
    expect(initializerDump('const x: { name: String, shorthand: Int } =', body)).toBe(untyped);
    expect(initializerDump('const x: Service | Map<String, String> =', body)).toBe(untyped);
  });

  it('parses an item block identically regardless of the expected type annotation', () => {
    const body = lines('  - 1', '  - -1', '  - ...rest', '  - key: "a"', '    count: 2');
    const untyped = initializerDump('const xs =', body);
    expect(untyped.startsWith(':')).toBe(true);
    expect(initializerDump('const xs: Array<Int> =', body)).toBe(untyped);
    expect(initializerDump('const xs: Json =', body)).toBe(untyped);
  });

  it('parses generated indented blocks identically under any expected type annotation', () => {
    const entryArb = fc.oneof(
      fc.constantFrom('a: 1', 'b: "x"', '"quoted": 2', 'short', '...base'),
      fc.constant('nested:\n    inner: 1'),
    );
    fc.assert(
      fc.property(fc.array(entryArb, { minLength: 1, maxLength: 5 }), (entries) => {
        const body = entries.map((entry) => `  ${entry}`).join('\n');
        const plain = initializerDump('const x =', body);
        const typed = initializerDump('const x: Map<String, Any> =', body);
        expect(plain.startsWith(':')).toBe(true);
        expect(typed).toBe(plain);
      }),
      { numRuns: 50 },
    );
  });
});

describe('nowhere else and parser refusals (§1)', () => {
  it('keeps a body line "Config:" with a block below as a LabelledBlock, not an indented value', () => {
    const text = lines('fn f():', '  Config:', '    const x = 1');
    expect(dumpClean('module', text)).toContain('(LabelledBlock Config');
  });

  it('keeps headers (if, while, for, match, case, select) as statement bodies', () => {
    const text = lines(
      'fn f(c: Bool, xs: Array<Int>):',
      '  if c:',
      '    const a = 1',
      '  while c:',
      '    break',
      '  for x in xs:',
      '    const b = x',
    );
    expect(moduleProblems(text)).toEqual([]);
  });

  it.each([
    ['-1 at the start of a line (no space after "-")', lines('const xs =', '  -1'), '-1'],
    ['- - 1 (an item expression starting with "- ")', lines('const xs =', '  - - 1'), '-'],
    ['a positional expression in an indented value', lines('const x = Ok:', '  42'), '42'],
    ['a parenthesized expression in an indented value', lines('const x = Ok:', '  (value)'), '('],
    ['a template literal used as a key', lines('const x =', '  `key`: 1'), '`key`'],
    ['entries on the opening line after T:', lines('const x = Service: name: "api"'), 'name'],
    ['a lambda header followed by key: value', lines('const f = fn(x: Int):', '  name: x'), 'name'],
    [
      'an indented value inside parentheses',
      lines('const x = f(Service:', '  name: "api"', ')'),
      ':',
    ],
    ['an indented value inside brackets', lines('const xs = [Service:', '  name: "api"', ']'), ':'],
  ])('reports %s', (_name, text, offending) => {
    const result = reported('module', text);
    expect(result.codes.length).toBeGreaterThan(0);
    expect(result.spanTexts).toContain(offending);
  });

  it('reports a struct comprehension that is not the last entry or stands beside a spread', () => {
    expect(
      reported(
        'module',
        lines('const s = Settings:', '  for k, v in ...rest: [k]: v', '  extra: 1'),
      ),
    ).toEqual(reportedOnce(parserDiagnostics.structComprehensionLast.code, 'extra: 1'));
    expect(
      reported(
        'module',
        lines('const s = Settings:', '  ...base', '  for k, v in ...rest: [k]: v'),
      ),
    ).toEqual(reportedOnce(parserDiagnostics.structComprehensionLast.code, '...base'));
  });

  it('reports missing blocks, inconsistent dedents and unexpected indents', () => {
    expect(reported('module', lines('const a: Config =', 'const b = 1')).codes).toContain(
      parserDiagnostics.expectedIndentedBlock.code,
    );
    expect(
      reported('module', lines('const a = Config:', '    retries: 3', '  region: "eu"')).codes,
    ).toContain(parserDiagnostics.inconsistentDedent.code);
    expect(
      reported('module', lines('const a = Config:', '  retries: 3', '    region: "eu"')).codes,
    ).toContain(parserDiagnostics.unexpectedIndent.code);
  });
});
