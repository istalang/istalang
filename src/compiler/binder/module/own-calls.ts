/**
 * A function's own call (§16): a name before a `.` that names the functions of an enclosing async
 * function denotes that function's call, held in a variable of it; `main`'s call nothing holds,
 * a transient's initializer reads no variable of its function (§7.1), and a name naming no
 * enclosing async function denotes no call, which is reported.
 */

import type { Diagnostic } from '../../../foundation/diagnostics/diagnostic.ts';
import type { FunctionDeclaration } from '../../syntax/declarations/index.ts';
import { isMain } from '../../syntax/declarations/starts.ts';
import type { Lambda } from '../../syntax/expressions/index.ts';
import { awaits } from '../../syntax/tokens/modifiers.ts';
import type { Identifier } from '../../syntax/tree/node.ts';
import type { AnchoredSpan } from '../../syntax/tree/positions.ts';
import { binderDiagnostics } from '../diagnostics.ts';
import { localFunctionOf } from '../entities.ts';
import type { Enclosing, LocalEntity } from './scope.ts';

/** Whether a variable of `node` holds its own call: an async function's, but `main`'s. */
export function holdsOwnCall(node: FunctionDeclaration | Lambda): boolean {
  return awaits(node.qualifiers) && !(node.kind === 'FunctionDeclaration' && isMain(node));
}

/**
 * Why `name`, naming the functions of `enclosing` before a `.`, denotes no call (§16): it stands in
 * a transient's initializer of a function holding its call, or what it names encloses it as the
 * program's `main`, whose call nothing holds, or doesn't enclose it as an async function at all.
 */
export function noOwnCall(
  name: Identifier,
  enclosing: Enclosing | undefined,
): Diagnostic<AnchoredSpan> {
  const found = enclosing?.function;
  if (found !== undefined && holdsOwnCall(found)) {
    return binderDiagnostics.transientReads(name.span, name.text);
  }
  return found?.kind === 'FunctionDeclaration' && isMain(found)
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
