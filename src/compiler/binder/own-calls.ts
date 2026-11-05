/**
 * A function's own call (§7): a name before a `.` that names the functions of an enclosing async
 * function denotes that function's call, held in a variable of it; `main`'s call nothing holds,
 * and a name naming no enclosing async function denotes no call, which is reported.
 */

import type { Diagnostic } from '../../diagnostics/diagnostic.ts';
import { entryFunction } from '../../language/well-known.ts';
import type { FunctionDeclaration } from '../syntax/declarations.ts';
import type { Lambda } from '../syntax/expressions/index.ts';
import type { Identifier } from '../syntax/node.ts';
import type { AnchoredSpan } from '../syntax/positions.ts';
import { binderDiagnostics } from './diagnostics.ts';
import { localFunctionOf } from './entities.ts';
import type { LocalEntity } from './scope.ts';

/**
 * Why `name`, naming the functions `entity` before a `.`, denotes no call (§7): none of them that
 * encloses it is async, or it names `main`, whose call nothing holds.
 */
export function noOwnCall(name: Identifier, entity: LocalEntity): Diagnostic<AnchoredSpan> {
  return namesMain(name, entity)
    ? binderDiagnostics.mainNeverDisposed(name.span)
    : binderDiagnostics.notOwnCall(name.span, name.text);
}

/** Whether `name` names `main`, whose call nothing holds (§7). */
export function namesMain(name: Identifier, entity: LocalEntity): boolean {
  return entity.kind === 'functions' && name.text === entryFunction;
}

/** The functions `entity` names: a top-level set of this tree's, or a local `fn` or named lambda. */
export function functionsNamed(
  entity: LocalEntity | undefined,
): readonly (FunctionDeclaration | Lambda)[] | undefined {
  switch (entity?.kind) {
    case 'functions':
      return entity.overloads;
    case 'variable': {
      const local = localFunctionOf(entity);
      return local === undefined ? undefined : [local];
    }
    default:
      return undefined;
  }
}
