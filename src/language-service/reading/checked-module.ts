/**
 * What every feature reading types asks of a program: one of its modules, that module's tree, and
 * the program's checker. A feature answers for a module the program holds; a document it doesn't
 * (a std module shown read-only) has syntax alone, which these features don't read.
 */

import { type Checker, checkProgram } from '../../compiler/checker/check.ts';
import type { ModuleId, Program } from '../../compiler/program/program.ts';
import type { SyntaxTree } from '../../compiler/syntax/tree/index.ts';

export interface CheckedModule {
  readonly checker: Checker;
  readonly module: ModuleId;
  readonly tree: SyntaxTree;
}

/**
 * `module` of `program`, with the program's checker; undefined when the program doesn't hold it.
 */
export function checkedModule(program: Program, module: ModuleId): CheckedModule | undefined {
  const tree = program.modules.get(module)?.tree;
  return tree && { checker: checkProgram(program), module, tree };
}
