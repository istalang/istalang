/**
 * What a value built from the expected type takes from it (§2, §3.1, §3.5, §3.11): the one home for
 * taking an expected type apart, which every construct with no type of its own reads, as does the
 * inference of lambdas nested in an argument (calls/lambda-arguments.ts).
 *
 * - A value takes its type from the expected one through any optionals around it (`builtFrom`),
 *   since the wrap into `T?` applies after it is built: `[]` where an `Array<Int>?` is expected
 *   builds an empty `Array<Int>`.
 * - A struct, tuple, array or map literal and a lambda each read one part of it: the struct the
 *   expected type is, a tuple's element types, a collection's item or entry types, a function's
 *   parameters.
 * - A bare variant may be of an enum inside the expected optionals, including `Optional` itself:
 *   the checker chooses among them, and completion offers them, outermost first.
 * - A value named without type arguments, a fieldless generic struct or a bare variant, takes them
 *   from the expected type, else from its declaration's defaults (`expectedNominal`).
 */

import { wellKnown } from '../../../language/well-known.ts';
import { typeParametersOf } from '../../syntax/declarations.ts';
import type { AnchoredSpan } from '../../syntax/positions.ts';
import type { BodyContext, CheckerContext } from '../context.ts';
import { checkerDiagnostics } from '../diagnostics/index.ts';
import { type OptionalEntity, optionalInner, withoutOptionals } from './fit.ts';
import { typeArgumentsFor } from './resolve-type.ts';
import {
  errorType,
  expectsError,
  type FunctionType,
  type NominalDeclaration,
  type NominalEntity,
  type NominalType,
  nominalType,
  type Type,
} from './type.ts';
import { arrayElement, wellKnownArguments } from './well-known.ts';

/** What taking an expected type apart needs of the program: which type is `Optional`. */
type Expecting = Pick<CheckerContext, 'optionalEntity' | 'wellKnownType'>;

/** The type a value built where `expected` is expected takes its type from (§2). */
export function builtFrom(checker: Expecting, expected: Type | undefined): Type | undefined {
  return expected === undefined ? undefined : withoutOptionals(expected, checker.optionalEntity);
}

/** The element types `expected` asks a tuple of `length` elements for. */
export function expectedTuple(
  checker: Expecting,
  expected: Type | undefined,
  length: number,
): readonly Type[] | undefined {
  const target = builtFrom(checker, expected);
  return target?.kind === 'tuple' && target.elements.length === length
    ? target.elements
    : undefined;
}

/** The function type `expected` asks a lambda or a function value for. */
export function expectedFunction(
  checker: Expecting,
  expected: Type | undefined,
): FunctionType | undefined {
  const target = builtFrom(checker, expected);
  return target?.kind === 'function' ? target : undefined;
}

/**
 * What an array or map literal builds where `expected` is expected (§2): an `Array`'s items, a
 * `Map`'s entries, or another declared type, built through its `default()`; undefined when it
 * doesn't guide the literal.
 */
export type CollectionTarget =
  | { readonly kind: 'array'; readonly item: Type }
  | { readonly kind: 'map'; readonly type: Type; readonly arguments: readonly Type[] }
  | { readonly kind: 'declared'; readonly type: NominalType };

export function collectionTarget(
  checker: Expecting,
  expected: Type | undefined,
): CollectionTarget | undefined {
  const type = builtFrom(checker, expected);
  if (type === undefined || type.kind !== 'nominal') {
    return undefined;
  }
  const item = arrayElement(checker, type);
  if (item !== undefined) {
    return { kind: 'array', item };
  }
  const entry = wellKnownArguments(checker, wellKnown.map, type);
  return entry === undefined ? { kind: 'declared', type } : { kind: 'map', type, arguments: entry };
}

/**
 * The types a value of `expected` may be a value of when it names its type's member, outermost
 * first: the expected type and those inside its optionals.
 */
function namedCandidates(optional: OptionalEntity, expected: Type | undefined): readonly Type[] {
  const candidates: Type[] = [];
  for (let current = expected; current !== undefined; current = optionalInner(current, optional)) {
    candidates.push(current);
  }
  return candidates;
}

/** The nominal type of `declaration` that `expected` asks for, through its optionals. */
export function sameNominal(
  checker: Pick<CheckerContext, 'optionalEntity'>,
  expected: Type | undefined,
  declaration: NominalDeclaration,
): NominalType | undefined {
  return namedCandidates(checker.optionalEntity, expected).find(
    (candidate): candidate is NominalType =>
      candidate.kind === 'nominal' && candidate.entity.declaration === declaration,
  );
}

/** The enums a bare variant of `expected` may be of, outermost first, as `sameNominal` finds them. */
export function enumsExpected(
  checker: Pick<CheckerContext, 'optionalEntity'>,
  expected: Type | undefined,
) {
  return namedCandidates(checker.optionalEntity, expected).flatMap((candidate) =>
    candidate.kind === 'nominal' && candidate.entity.declaration.kind === 'EnumDeclaration'
      ? [candidate.entity.declaration]
      : [],
  );
}

/**
 * The type a value of `entity`'s type named at `at` without type arguments has (§3.1, §3.11): the
 * one `expected` asks for, else its declaration's defaults; the error type after reporting a type
 * parameter with neither.
 */
export function expectedNominal(
  context: BodyContext,
  at: AnchoredSpan,
  entity: NominalEntity,
  expected: Type | undefined,
): Type {
  const { declaration } = entity;
  const same = sameNominal(context.checker, expected, declaration);
  if (same !== undefined) {
    return same;
  }
  if (expectsError(expected)) {
    return errorType;
  }
  const open = typeParametersOf(declaration.typeParameters).find(
    (parameter) => parameter.defaultType === undefined,
  );
  if (open !== undefined) {
    context.report(checkerDiagnostics.cannotInfer(at, declaration.name.text, open.name.text));
    return errorType;
  }
  const list = { at, declaration, types: [] };
  const typeArguments = typeArgumentsFor(context.checker, context.module, list);
  return typeArguments === undefined ? errorType : nominalType(entity, typeArguments);
}
