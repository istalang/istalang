/**
 * Parsing after an edit (docs/work/m6-m7/incremental-checking.md, 7A.7): over random edits of the
 * corpus programs and std test modules, the tree built from the one before matches a fresh parse,
 * positions, comments and diagnostics included; after an edit inside one function's body, every
 * other segment keeps its nodes. The module's own segment (its root and docstring) is always new.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { memo } from '../../../foundation/structures/memo.ts';
import { createSourceText } from '../../../foundation/text/source-text.ts';
import { scan } from '../../scanner/scan.ts';
import { bodyOf, extentIn, nodesUnder, type SyntaxTree } from '../../syntax/tree/index.ts';
import type { Segment } from '../../syntax/tree/positions.ts';
import { spanIn } from '../../syntax/tree/positions.ts';
import { dump, spanViolations, strayBodies } from '../../syntax/tree/tree.test-kit.ts';
import {
  applied,
  bodyEditChoices,
  editedTexts,
  editInsideBody,
  editSequences,
} from '../edits.test-kit.ts';
import { parse } from '../parse.ts';

function parsed(text: string, previous?: SyntaxTree): SyntaxTree {
  const source = createSourceText('main.ista', text);
  return parse(source, scan(source), previous);
}

const freshTrees = new Map<string, SyntaxTree>();

/** `text` parsed afresh, once per file: a tree is immutable, so every run may edit from it. */
function parsedOnce(text: string): SyntaxTree {
  return memo(freshTrees, text, () => parsed(text));
}

/** Everything a tree tells of its text: nodes, their places, comments and diagnostics. */
function told(tree: SyntaxTree) {
  return {
    dump: dump(tree, tree.root),
    places: nodesUnder(tree, tree.root).map((node) => {
      const own = spanIn(tree, node.span);
      const extent = extentIn(tree, node);
      return `${node.kind} ${own.start}-${own.end} ${extent.start}-${extent.end}`;
    }),
    comments: tree.comments,
    diagnostics: tree.diagnostics,
  };
}

/** The segments `tree`'s nodes stand in. */
function segmentsHeld(tree: SyntaxTree): ReadonlySet<Segment> {
  return new Set(nodesUnder(tree, tree.root).map((node) => node.span.segment));
}

describe('a tree parsed after an edit', () => {
  it.each(editedTexts)('matches a fresh parse of $name', ({ text }) => {
    fc.assert(
      fc.property(editSequences, (edits) => {
        let tree = parsedOnce(text);
        let edited = text;
        for (const edit of edits) {
          edited = applied(edited, edit);
          tree = parsed(edited, tree);
          expect(told(tree)).toEqual(told(parsed(edited)));
          expect(strayBodies(tree)).toEqual([]);
          expect(spanViolations(tree, tree.root)).toEqual([]);
          expect(new Set(tree.bases.keys())).toEqual(segmentsHeld(tree));
        }
      }),
      { numRuns: 5 },
    );
  });

  it.each(editedTexts)(
    'keeps every segment but the edited body of $name after an edit inside one body',
    ({ text }) => {
      const before = parsedOnce(text);
      fc.assert(
        fc.property(bodyEditChoices, (choices) => {
          const edit = editInsideBody(before, choices);
          if (edit === undefined) {
            return;
          }
          const after = parsed(edit.text, before);
          const editedBody = bodyOf(after, edit.edited);
          const oldNodes = new Set(nodesUnder(before, before.root));
          const changed = new Set(editedBody === undefined ? [] : nodesUnder(after, editedBody));
          const made = nodesUnder(after, after.root).filter(
            (node) =>
              node.span.segment !== after.root.span.segment &&
              !changed.has(node) &&
              !oldNodes.has(node),
          );
          expect(after.root.items).toEqual(before.root.items);
          expect(after.root.items.every((item, index) => item === before.root.items[index])).toBe(
            true,
          );
          expect(made.map((node) => node.kind)).toEqual([]);
          expect(editedBody).not.toBe(bodyOf(before, edit.edited));
        }),
        { numRuns: 5 },
      );
    },
  );

  it('keeps an item moved or repeated, and gives the edited copy new nodes', () => {
    const before = parsed('fn f() -> Int: 1\n\nfn g() -> Int: 2\n');
    const after = parsed('fn g() -> Int: 2\n\nfn f() -> Int: 1\n\nfn f() -> Int: 3\n', before);
    const [g, f, other] = after.root.items;
    expect(f).toBe(before.root.items[0]);
    expect(g).toBe(before.root.items[1]);
    expect(other).not.toBe(before.root.items[0]);
  });

  it('keeps a header whose body changed, with the new body', () => {
    const before = parsed('fn f() -> Int:\n  const x = 1\n  x\n');
    const after = parsed('fn f() -> Int:\n  const x = 2\n  x\n', before);
    const [f] = after.root.items;
    expect(f).toBe(before.root.items[0]);
    expect(f?.kind === 'FunctionDeclaration' && bodyOf(after, f)).not.toBe(
      f?.kind === 'FunctionDeclaration' && bodyOf(before, f),
    );
  });

  it('parses an item again when the indentation its line begins with changed', () => {
    const before = parsed('fn f() -> Int:\n  1\n');
    const after = parsed(' fn f() -> Int:\n  1\n', before);
    expect(after.root.items[0]).not.toBe(before.root.items[0]);
  });
});
