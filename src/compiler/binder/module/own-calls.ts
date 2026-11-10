/**
 * A function's own call (§7): a name before a `.` that names the functions of an enclosing async
 * function denotes that function's call, held in a variable of it; `main`'s call nothing holds,
 * and a name naming no enclosing async function denotes no call, which is reported.
 */

import type { Diagnostic } from '../../../foundation/diagnostics/diagnostic.ts';
import type { FunctionDeclaration } from '../../syntax/declarations/index.ts';
import { isMain } from '../../syntax/declarations/starts.ts';
import type { Lambda } from '../../syntax/expressions/index.ts';
import type { Identifier } from '../../syntax/tree/node.ts';
import type { AnchoredSpan } from '../../syntax/tree/positions.ts';
import { binderDiagnostics } from '../diagnostics.ts';
import { localFunctionOf } from '../entities.ts';
import type { LocalEntity } from './scope.ts';

/**
 * Why `name`, naming the functions `entity` before a `.`, denotes no call (§7): what it names
 * encloses it as the program's `main`, whose call nothing holds, or doesn't enclose it as an async
 * function at all.
 */
export function noOwnCall(
  name: Identifier,
  enclosing: FunctionDeclaration | Lambda | undefined,
): Diagnostic<AnchoredSpan> {
  return enclosing?.kind === 'FunctionDeclaration' && isMain(enclosing)
    ? binderDiagnostics.mainNeverDisposed(name.span)
    : binderDiagnostics.notOwnCall(name.span, name.text);
}

/**
 * The functions `entity` names: a top-level set of this tree's, or a local `fn` or named lambda.
 */
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
