/**
 * The parser's entry over whole files:
 * - every spec example that is a module parses without diagnostics
 * - statements shown outside a function report only that
 * - parsing stays total and well nested when spec examples are broken at random
 *
 * Placeholders for omitted code (`...`, `…`, `{ … }`) are the one thing a spec example may leave
 * unexplained (test/corpus/spec-examples.ts).
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  isPlaceholder,
  type SpecExample,
  specExamples,
} from '../../../test/corpus/spec-examples.ts';
import { createSourceText } from '../../text/source-text.ts';
import { textOf } from '../../text/span.ts';
import { scan } from '../scanner/scan.ts';
import { dump, errorNodes, spanViolations } from '../syntax/tree.test-kit.ts';
import type { SyntaxTree } from '../syntax/tree.ts';
import { parserDiagnostics } from './diagnostics.ts';
import { bodyOf, functionOf } from './parse.test-kit.ts';
import { parse } from './parse.ts';

function parseText(text: string): SyntaxTree {
  const source = createSourceText('example.ista', text);
  return parse(source, scan(source));
}

/** Diagnostics other than placeholders and the codes `allowed`, as `code 'span text'`. */
function unexplained(example: SpecExample, allowed: readonly number[]): readonly string[] {
  const tree = parseText(example.code);
  return tree.diagnostics
    .map((diagnostic) => ({ code: diagnostic.code, text: textOf(tree.source, diagnostic.span) }))
    .filter(({ code, text }) => !(allowed.includes(code) || isPlaceholder(text)))
    .map(({ code, text }) => `${code} '${text}'`);
}

const examplesOf = (form: SpecExample['form']): readonly SpecExample[] =>
  specExamples.filter((example) => example.form === form);

const modules = examplesOf('module');

describe('spec examples', () => {
  it.each(modules)('parse the $section module at spec line $line', (example) => {
    expect(unexplained(example, [])).toEqual([]);
  });

  it.each(examplesOf('statements'))(
    'parse the $section statements at spec line $line, reporting only that they stand outside a function',
    (example) => {
      expect(unexplained(example, [parserDiagnostics.topLevelStatement.code])).toEqual([]);
    },
  );

  it.each(examplesOf('fragment'))(
    'parse the $section fragment at spec line $line into a well-nested tree',
    (example) => {
      expect(spanViolations(parseText(example.code).root)).toEqual([]);
    },
  );

  it('count every §12 example as a whole module without placeholders', () => {
    const sectionTwelve = specExamples.filter((example) => example.section.startsWith('12.'));
    expect(sectionTwelve.length).toBeGreaterThan(0);
    expect(sectionTwelve.filter((example) => example.form !== 'module' || example.elided)).toEqual(
      [],
    );
  });
});

interface Mutation {
  readonly kind: 'delete' | 'duplicate' | 'swap';
  readonly at: number;
  readonly to: number;
}

const mutation = fc.record({
  kind: fc.constantFrom('delete', 'duplicate', 'swap'),
  at: fc.nat(),
  to: fc.nat(),
}) satisfies fc.Arbitrary<Mutation>;

/** Applies `change` to `pieces`, wrapping its positions into range. */
function mutate(pieces: readonly string[], change: Mutation): string[] {
  const result = [...pieces];
  if (result.length === 0) {
    return result;
  }
  const at = change.at % result.length;
  const to = change.to % result.length;
  const piece = result[at] ?? '';
  switch (change.kind) {
    case 'delete':
      result.splice(at, 1);
      break;
    case 'duplicate':
      result.splice(to, 0, piece);
      break;
    default:
      result[at] = result[to] ?? '';
      result[to] = piece;
  }
  return result;
}

/** The text cut into tokens, each with the whitespace and comments before it. */
function tokenPieces(text: string): string[] {
  const { tokens } = scan(createSourceText('example.ista', text));
  return tokens.map((token, index) => text.slice(tokens[index - 1]?.span.end ?? 0, token.span.end));
}

const brokenExample = fc
  .record({
    example: fc.constantFrom(...modules),
    byLines: fc.boolean(),
    changes: fc.array(mutation, { minLength: 1, maxLength: 4 }),
  })
  .map(({ example, byLines, changes }) => {
    const pieces = byLines ? example.code.split('\n') : tokenPieces(example.code);
    const broken = changes.reduce<string[]>((current, change) => mutate(current, change), pieces);
    return broken.join(byLines ? '\n' : '');
  });

describe('totality', () => {
  it('parses spec examples broken at random into well-nested trees with every error reported', () => {
    fc.assert(
      fc.property(brokenExample, (text) => {
        const tree = parseText(text);
        const unexplainedError = errorNodes(tree.root).length > 0 && tree.diagnostics.length === 0;
        expect(spanViolations(tree.root)).toEqual([]);
        expect(unexplainedError).toBe(false);
      }),
      { numRuns: 300 },
    );
  });
});

describe('hostile nesting', () => {
  const depth = 5000;
  // Indentation grows with depth, so the text grows with its square; 1000 levels is already 1 MB,
  // and five times the limit.
  const indentedDepth = 1000;
  const indented = (line: (level: number) => string): string =>
    Array.from(
      { length: indentedDepth },
      (_, level) => `${' '.repeat(level * 2)}${line(level)}`,
    ).join('\n');

  it.each([
    ['parentheses', `fn f(): ${'('.repeat(depth)}1${')'.repeat(depth)}`],
    ['prefix operators', `fn f(): ${'-'.repeat(depth)}1`],
    ['type arguments', `const x: ${'Array<'.repeat(depth)}int${'>'.repeat(depth)} = 1`],
    ['patterns', `fn f(): x is ${'('.repeat(depth)}_${')'.repeat(depth)}`],
    ['indented blocks', `fn f():\n${indented((level) => `${' '.repeat(2)}if a${level}:`)}`],
    ['indented struct fields', `struct S:\n${indented((level) => `${' '.repeat(2)}f${level}:`)}`],
  ])('reports %s nested past the limit once, and parses the code after it', (_name, deep) => {
    const tree = parseText(`${deep}\nfn after(): 1`);
    const codes = tree.diagnostics.map((diagnostic) => diagnostic.code);
    expect(codes.filter((code) => code === parserDiagnostics.nestingTooDeep.code)).toHaveLength(1);
    expect(spanViolations(tree.root)).toEqual([]);
    expect(dump(tree.root.items.at(-1) ?? tree.root)).toBe(functionOf('after', bodyOf('1')));
  });

  it('reports unclosed parentheses nested past the limit once, without throwing', () => {
    const tree = parseText(`fn f(): ${'('.repeat(depth)}`);
    const codes = tree.diagnostics.map((diagnostic) => diagnostic.code);
    expect(codes.filter((code) => code === parserDiagnostics.nestingTooDeep.code)).toHaveLength(1);
    expect(spanViolations(tree.root)).toEqual([]);
  });
});
