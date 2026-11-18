/**
 * `ista fmt` changes how a program reads, never what it does: the program formatted reports what
 * the original does, positions aside, and compiles to the same Definition but for where its code
 * stands (`withoutPlaces`); only when they differ anyway, as a lambda's name holds its place, do
 * both run, ending alike but for a panic's frame, which names a line. A program fmt leaves as it
 * is holds nothing. The CLI's side of `ista fmt` is test/fmt-corpus.sweep.test.ts's.
 *
 * The corpus is kept formatted, so its text alone would leave the check with little to format. Each
 * program is also formatted from a scrambled copy, laid out as formatting never leaves one but
 * meaning the same: its imports moved to the end, reversed and an item a statement, which the
 * formatter hoists, merges and sorts back, and a blank line more before each other item, which it
 * collapses. Comments stay put, and an import with one after it on its line or with an annotation
 * isn't moved, nor split when it holds one.
 */

import { isDeepStrictEqual } from 'node:util';
import { expect } from 'vitest';
import { diagnosticsWithoutPlaces } from '../../../src/compiler/compile.test-kit.ts';
import type { ImportDeclaration } from '../../../src/compiler/syntax/declarations/index.ts';
import { extentIn, type SyntaxTree } from '../../../src/compiler/syntax/tree/index.ts';
import { withoutPlaces } from '../../../src/definition/definition.test-kit.ts';
import { parseText } from '../../../src/formatter/format.test-kit.ts';
import { formatTree } from '../../../src/formatter/format.ts';
import { lineMapOf, lineStartAt } from '../../../src/foundation/text/line-map.ts';
import { encloses, textOf } from '../../../src/foundation/text/span.ts';
import type { Observation } from '../../golden/observation.ts';
import { compiledAt, observeCompiled } from '../../golden/pipeline/index.ts';
import type { ProgramSubject } from '../../golden/subjects.ts';
import { type Check, compiledOf, type Held, observedOf } from '../swept.ts';

async function behavesAlike(_: undefined, { subject }: { readonly subject: ProgramSubject }) {
  const tree = parseText(subject.text);
  const written = await formatsAlike(subject, tree);
  const scrambled = await formatsAlike(subject, parseText(scrambledText(tree)));
  return written + scrambled;
}

/**
 * Whether `tree`, a layout of `subject`'s program, formats to a program behaving as `subject`
 * does: 1 when that held, 0 when formatting leaves `subject`'s text as it is.
 */
async function formatsAlike(subject: ProgramSubject, tree: SyntaxTree): Promise<Held> {
  // The formatter itself, which formats a module its banner keeps as written too.
  const text = formatTree(tree);
  expect(text).toBeDefined();
  if (text === undefined || text === subject.text) {
    return 0;
  }
  const formatted = compiledAt(subject.directory, subject.path, text);
  if ('problem' in formatted) {
    throw new Error(`${subject.name} formatted doesn't compile: ${formatted.problem}`);
  }
  const original = compiledOf(subject);
  expect(diagnosticsWithoutPlaces(formatted.program)).toEqual(
    diagnosticsWithoutPlaces(original.program),
  );
  if (!isDeepStrictEqual(withoutPlaces(formatted.definition), withoutPlaces(original.definition))) {
    const shown = await observeCompiled(formatted.definition, { ...subject, text });
    expect(withoutFrame(shown)).toEqual(withoutFrame(await observedOf(subject)));
  }
  return 1;
}

/** A text edit: what replaces `start` to `end`. */
interface Edit {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

/**
 * `tree`'s program laid out as its formatting never leaves one (banner): every import moved to the
 * end, reversed and an item a statement, and a blank line more before every other item.
 */
function scrambledText(tree: SyntaxTree): string {
  const { text } = tree.source;
  const lines = lineMapOf(tree.source);
  const [, ...later] = tree.root.items;
  const moved = tree.root.items.filter(
    (item): item is ImportDeclaration => item.kind === 'ImportDeclaration' && isMovable(tree, item),
  );
  const edits: Edit[] = [
    ...moved.map((declaration): Edit => {
      const { start, end } = extentIn(tree, declaration);
      return { start, end: lines.lineSpan(lines.positionAt(end).line + 1).start, text: '' };
    }),
    ...later
      .filter((item) => item.kind !== 'ImportDeclaration')
      .map((item): Edit => {
        const at = lineStartAt(text, extentIn(tree, item).start);
        return { start: at, end: at, text: '\n' };
      }),
  ];
  const kept = edits
    .toSorted((first, second) => second.start - first.start)
    .reduce(
      (edited, edit) => edited.slice(0, edit.start) + edit.text + edited.slice(edit.end),
      text,
    );
  const appended = moved.toReversed().flatMap((declaration) => splitImport(tree, declaration));
  return [kept.endsWith('\n') ? kept : `${kept}\n`, ...appended.map((line) => `${line}\n`)].join(
    '',
  );
}

/** Whether `declaration` moves whole: unannotated, and nothing after it on its last line. */
function isMovable(tree: SyntaxTree, declaration: ImportDeclaration): boolean {
  const lines = lineMapOf(tree.source);
  const { end } = extentIn(tree, declaration);
  const rest = textOf(tree.source, {
    start: end,
    end: lines.lineSpan(lines.positionAt(end).line).end,
  });
  return (declaration.annotations ?? []).length === 0 && rest.trim() === '';
}

/** `declaration`'s statements, one per item, or itself when it holds a comment. */
function splitImport(tree: SyntaxTree, declaration: ImportDeclaration): readonly string[] {
  const extent = extentIn(tree, declaration);
  const whole = textOf(tree.source, extent);
  const commented = tree.comments.some(({ span }) => encloses(extent, span));
  if (commented) {
    return [whole];
  }
  const path = textOf(tree.source, extentIn(tree, declaration.path));
  return declaration.items.map(
    (item) => `import ${textOf(tree.source, extentIn(tree, item))} from ${path}`,
  );
}

/** `observation` but for a panic's frame. */
function withoutFrame({ ending, ...rest }: Observation): unknown {
  return { ...rest, ending: 'frame' in ending ? { panic: ending.panic } : ending };
}

export const formatting: Check = { holds: { stating: behavesAlike, example: behavesAlike } };
