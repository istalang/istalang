/**
 * Completion inside a struct or variant literal's braces offers exactly the fields it may set: a
 * corpus literal naming its type, emptied, offers fields which, each written in with a value that
 * fits any field, leave none unknown, missing or given twice.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { invalidPrograms, runPrograms } from '../../../../test/corpus/programs.ts';
import { checkProgram } from '../../../compiler/checker/check.ts';
import type { FieldsLiteral } from '../../../compiler/syntax/expressions/index.ts';
import { spanIn } from '../../../compiler/syntax/positions.ts';
import { nodesUnder } from '../../../compiler/syntax/tree.ts';
import { type MainProgram, mainProgram } from '../../language-service.test-kit.ts';
import { completionsAt } from '../index.ts';

/** A field unknown to the literal's type (5013), one left without a value (5014), or one given twice (5015). */
const fieldMistakes = new Set([5013, 5014, 5015]);

interface LiteralSite {
  readonly main: MainProgram;
  readonly literal: FieldsLiteral & { readonly type: NonNullable<FieldsLiteral['type']> };
}

/**
 * What the fields offered in `site`'s literal, emptied, leave wrong when each is written in: the
 * codes of the field mistakes reported in the literal.
 */
function fieldMistakesOf({ main, literal }: LiteralSite): readonly number[] {
  const { tree } = main;
  const { text } = tree.source;
  const { start, end } = spanIn(tree, literal.span);
  const open = text.indexOf('{', spanIn(tree, literal.type.span).end) + 1;
  const close = end - 1;
  const emptied = mainProgram(`${text.slice(0, open)}${text.slice(close)}`);
  const offered = completionsAt(emptied.program, emptied.module, open, '{');
  const items = offered
    .filter(({ kind }) => kind === 'field')
    .map(({ name }) => `${name}: panic("")`)
    .join(', ');
  const probed = mainProgram(`${text.slice(0, open)}${items}${text.slice(close)}`);
  const probedEnd = open + items.length + 1;
  return checkProgram(probed.program)
    .diagnosticsOf(probed.module)
    .filter(
      ({ code, span }) => fieldMistakes.has(code) && start <= span.start && span.end <= probedEnd,
    )
    .map(({ code }) => code);
}

/** The literals of `main` naming their type, written with their braces closed. */
function literalSites(main: MainProgram): readonly LiteralSite[] {
  const { tree } = main;
  return nodesUnder(tree, tree.root).flatMap((node) => {
    const isLiteral = node.kind === 'StructLiteral' || node.kind === 'NewStructLiteral';
    if (!isLiteral || node.type === undefined) {
      return [];
    }
    const closed = tree.source.text.charAt(spanIn(tree, node.span).end - 1) === '}';
    return closed ? [{ main, literal: { ...node, type: node.type } }] : [];
  });
}

describe('field completion offers exactly what a literal may set', () => {
  const corpusSites = [...runPrograms, ...invalidPrograms].flatMap(({ text }) =>
    literalSites(mainProgram(text)),
  );

  it('in the struct and variant literals of the corpus', () => {
    fc.assert(
      fc.property(fc.constantFrom(...corpusSites), (site) => {
        expect(fieldMistakesOf(site)).toEqual([]);
      }),
      { numRuns: 30 },
    );
  }, 60_000);
});
