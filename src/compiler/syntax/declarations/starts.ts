/**
 * A top-level function as the rule of what a host may start reads it
 * (foundation/language/starts.ts): all of it written, so the binder, the checker, lowering and the
 * compiler read one shape of it. An extern is the only top-level function with no body; one the
 * parser found none for is an error, which nothing past checking sees.
 */

import { isMainShaped, type StartShape } from '../../../foundation/language/starts.ts';
import { entryFunction } from '../../../foundation/language/well-known/index.ts';
import { writtenByReference } from '../expressions/parameters.ts';
import { awaits } from '../tokens/modifiers.ts';
import { type FunctionDeclaration, typeParametersOf } from './index.ts';

/** What the rule reads of `declaration`, a top-level function. */
export function startShapeOf(declaration: FunctionDeclaration): StartShape {
  return {
    hasBody: !declaration.isExtern,
    isStatic: declaration.owner !== undefined,
    isGeneric: typeParametersOf(declaration.typeParameters).length > 0,
    parameters: declaration.parameters.map((parameter) => ({
      reference: parameter.kind === 'Parameter' && writtenByReference(parameter),
    })),
    awaits: awaits(declaration.qualifiers),
    isIsta: declaration.qualifiers.kind === 'ista',
  };
}

/** Whether `declaration`, a top-level function of the entry module, is the program's `main`. */
export function isMain(declaration: FunctionDeclaration): boolean {
  return declaration.name.text === entryFunction && isMainShaped(startShapeOf(declaration));
}
