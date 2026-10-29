/**
 * The written body of a function lowering compiles. The tree holds a function's body apart from
 * its declaration (syntax/tree.ts), so lowering finds it in the tree of the module declaring it.
 */

import { type ModuleId, type Program, programModule } from '../program/program.ts';
import type { FunctionDeclaration } from '../syntax/declarations.ts';
import type { Block } from '../syntax/statements.ts';
import { bodyOf } from '../syntax/tree.ts';

/** The body written for `declaration`, a function of `module`; undefined for one written without. */
export function writtenBodyOf(
  program: Program,
  module: ModuleId,
  declaration: FunctionDeclaration,
): Block | undefined {
  return bodyOf(programModule(program, module).tree, declaration);
}
