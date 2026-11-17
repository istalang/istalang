/**
 * Entities outlive an edit that leaves their nodes alike (entities.ts; docs/work/done/m6-m7/
 * incremental-checking.md, 7A.7): after an edit inside one function's body, every name outside that
 * body denotes the very entity it did before, over the corpus programs and std test modules.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { bodyEditChoices, editedTexts, editInsideBody } from '../parser/edits.test-kit.ts';
import { idOf, moduleAt } from '../program/program.test-kit.ts';
import { bodyOf, nodesUnder } from '../syntax/tree/index.ts';
import { stdProgramOf } from './bind.test-kit.ts';
import { bindProgram } from './bind.ts';

const module = 'main.test.ista';

describe('an entity', () => {
  it.each(editedTexts)(
    'outlives an edit inside another body of $name, as every name outside it denotes',
    ({ text }) => {
      const before = stdProgramOf({ [module]: text });
      const { tree } = moduleAt(before, module);
      fc.assert(
        fc.property(bodyEditChoices, (choices) => {
          const edit = editInsideBody(tree, choices);
          if (edit === undefined) {
            return;
          }
          const after = stdProgramOf({ [module]: edit.text }, before);
          const edited = moduleAt(after, module).tree;
          const body = bodyOf(edited, edit.edited);
          const inBody = new Set(body === undefined ? [] : nodesUnder(edited, body));
          const id = idOf(module);
          const [was, is] = [bindProgram(before), bindProgram(after)];
          const changed = nodesUnder(edited, edited.root).filter(
            (node) =>
              node.kind === 'Identifier' &&
              !inBody.has(node) &&
              is.entityOf(id, node) !== was.entityOf(id, node),
          );
          expect(changed).toEqual([]);
        }),
        { numRuns: 3 },
      );
    },
  );
});
