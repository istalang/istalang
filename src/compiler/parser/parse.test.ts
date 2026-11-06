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
import { brokenText } from '../../../test/broken.ts';
import {
  isPlaceholder,
  type SpecExample,
  specExamples,
} from '../../../test/corpus/spec-examples.ts';
import { createSourceText } from '../../foundation/text/source-text.ts';
import { textOf } from '../../foundation/text/span.ts';
import { scan } from '../scanner/scan.ts';
import type { SyntaxTree } from '../syntax/tree/index.ts';
import { dump, errorNodes, spanViolations, strayBodies } from '../syntax/tree/tree.test-kit.ts';
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
  it.each(modules)('parse the module at $document:$line', (example) => {
    expect(unexplained(example, [])).toEqual([]);
  });

  it.each(examplesOf('statements'))(
    'parse the statements at $document:$line, reporting only that they stand outside a function',
    (example) => {
      expect(unexplained(example, [parserDiagnostics.topLevelStatement.code])).toEqual([]);
    },
  );

  it.each(examplesOf('fragment'))(
    'parse the fragment at $document:$line into a well-nested tree',
    (example) => {
      const tree = parseText(example.code);
      expect(spanViolations(tree, tree.root)).toEqual([]);
    },
  );

  it('count every §12 example as a whole module without placeholders', () => {
    const sectionTwelve = specExamples.filter(
      (example) => example.document === 'docs/spec.md' && example.section.startsWith('12.'),
    );
    expect(sectionTwelve.length).toBeGreaterThan(0);
    expect(sectionTwelve.filter((example) => example.form !== 'module' || example.elided)).toEqual(
      [],
    );
  });
});

describe('totality', () => {
  it('parses spec examples broken at random into well-nested trees with every error reported', () => {
    fc.assert(
      fc.property(brokenText(modules.map(({ code }) => code)), (text) => {
        const tree = parseText(text);
        const unexplainedError =
          errorNodes(tree, tree.root).length > 0 && tree.diagnostics.length === 0;
        expect(spanViolations(tree, tree.root)).toEqual([]);
        expect(strayBodies(tree)).toEqual([]);
        expect(unexplainedError).toBe(false);
      }),
      { numRuns: 300 },
    );
  });

  it('nests a field loop header missing its comma, its value target left out where the key ends', () => {
    const tree = parseText('fn f(s: S):\n  _ = struct{for field node in ...s: [field]: node}\n');
    expect(spanViolations(tree, tree.root)).toEqual([]);
    expect(tree.diagnostics.length).toBeGreaterThan(0);
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
    expect(spanViolations(tree, tree.root)).toEqual([]);
    expect(dump(tree, tree.root.items.at(-1) ?? tree.root)).toBe(functionOf('after', bodyOf('1')));
  });

  it('reports unclosed parentheses nested past the limit once, without throwing', () => {
    const tree = parseText(`fn f(): ${'('.repeat(depth)}`);
    const codes = tree.diagnostics.map((diagnostic) => diagnostic.code);
    expect(codes.filter((code) => code === parserDiagnostics.nestingTooDeep.code)).toHaveLength(1);
    expect(spanViolations(tree, tree.root)).toEqual([]);
  });
});
