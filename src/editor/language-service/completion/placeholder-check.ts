/**
 * The checker of a placeholder parse (placeholder.ts): the cursor's module read as that parse, its
 * imports as they were, checked tentatively over the program's checker. It takes over from that
 * checker (incremental checking), so a request checks about the item holding the cursor, and being
 * tentative it leaves the program's checker to the next edit. What checking records of a node of the
 * parse, the placeholder's expectation or the type a pattern being written is matched against, is
 * read off it, with no rule repeated here. One per parse, however many providers ask.
 */

import { type Checker, checkProgram } from '../../../compiler/checker/check.ts';
import type { ModuleId, Program } from '../../../compiler/program/program.ts';
import type { SyntaxTree } from '../../../compiler/syntax/tree/index.ts';
import { memo } from '../../../foundation/structures/memo.ts';
import type { Cursor } from './cursor.ts';

const placeholderCheckers = new WeakMap<SyntaxTree, Checker>();

/** The checker of the program with the cursor's module read as `tree`, its placeholder parse. */
export function placeholderChecker({ checker, module }: Cursor, tree: SyntaxTree): Checker {
  return memo(placeholderCheckers, tree, () =>
    checkProgram(withTree(checker.program, module, tree), {
      previous: checker.program,
      tentative: true,
    }),
  );
}

/** `program` with `module` read as `tree`, its imports as they were. */
function withTree(program: Program, module: ModuleId, tree: SyntaxTree): Program {
  const loaded = program.modules.get(module);
  return loaded === undefined
    ? program
    : { ...program, modules: new Map(program.modules).set(module, { ...loaded, tree }) };
}
