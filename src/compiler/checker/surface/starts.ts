/**
 * A checked function as the rule of what a host may start reads it
 * (foundation/language/starts.ts), so the checker, the compiler and lowering read one shape of it.
 */

import { isMainShaped, type StartShape } from '../../../foundation/language/starts.ts';
import { entryFunction } from '../../../foundation/language/well-known/index.ts';
import type { FunctionDeclaration } from '../../syntax/declarations/index.ts';
import { awaits } from '../../syntax/tokens/modifiers.ts';
import { bodyOf, type SyntaxTree } from '../../syntax/tree/index.ts';
import type { Checker } from '../check.ts';

type Reading = Pick<Checker, 'parametersOf'>;

/** What the rule reads of `declaration`, a top-level function of `tree`. */
export function startShapeOf(
  checker: Reading,
  tree: SyntaxTree,
  declaration: FunctionDeclaration,
): StartShape {
  return {
    hasBody: !declaration.isExtern && bodyOf(tree, declaration) !== undefined,
    isGeneric: declaration.typeParameters.length > 0,
    parameters: checker.parametersOf(declaration),
    awaits: awaits(declaration.qualifiers),
  };
}

/** Whether `declaration`, a top-level function of `tree`, is the program's `main` if it is the entry. */
export function isMain(
  checker: Reading,
  tree: SyntaxTree,
  declaration: FunctionDeclaration,
): boolean {
  return (
    declaration.name.text === entryFunction &&
    isMainShaped(startShapeOf(checker, tree, declaration))
  );
}
