/**
 * What a value built from the expected type takes from it (§2, §3.1, §3.5, §3.11): the one home for
 * taking an expected type apart, which every construct with no type of its own reads, as does the
 * inference of lambdas nested in an argument (calls/lambda-arguments.ts).
 *
 * - A value with no type of its own is built as the one member of the expected union that takes
 *   it (`memberBuilt`, which every expression's check goes through), then goes into the union:
 *   `[]` where an `Array<Int>?` is expected builds an empty `Array<Int>`. So is a literal whose own
 *   type doesn't go into the union, as one member its items can build it as: `[1, [2]]` where a
 *   `Json` is expected builds an `Array<Json>`, each item against `Json`. Where an array and a map
 *   member both take an empty literal, `[]` is the array and `[:]` the map. A construct reading the
 *   expected type itself sees past `None` (`builtFrom`).
 * - A struct, tuple, array or map literal and a lambda each read one part of it: the struct the
 *   expected type is, a tuple's element types, a collection's item or entry types, a function's
 *   parameters.
 * - A bare variant may be of an enum among the expected union's members: the checker chooses
 *   among them, and completion offers them.
 * - A value named without type arguments, a fieldless generic struct or a bare variant, takes them
 *   from the expected type, else from its declaration's defaults (`expectedNominal`).
 */

import { wellKnown } from '../../../language/well-known.ts';
import { typeParametersOf } from '../../syntax/declarations.ts';
import type { Expression } from '../../syntax/expressions/index.ts';
import type { AnchoredSpan } from '../../syntax/positions.ts';
import type { AcceptedPart, Accepts, BodyContext } from '../body-context.ts';
import type { CheckerContext } from '../context.ts';
import { checkerDiagnostics } from '../diagnostics/index.ts';
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
import { typeArgumentsFor } from './type-arguments.ts';
import { unfolded } from './type-match.ts';
import type { TypeRules } from './type-rules.ts';
import { membersOf, optionalInner } from './unions.ts';
import { arrayElement, wellKnownArguments } from './well-known.ts';

/** What taking an expected type apart needs of the program: its well-known types. */
type Expecting = Pick<CheckerContext, 'wellKnownType'>;

/** What choosing the member of an expected union a value is built as reads of the value. */
export interface MemberChoice {
  readonly checker: Expecting;
  readonly rules: TypeRules;
  /** The value as a part of a literal is read before checking (body-context.ts). */
  readonly part: () => AcceptedPart;
  /** Whether a value of its own type goes into the expected union as it is. */
  readonly fits: (type: Type) => boolean;
}

/**
 * Which types a value read as `part` can be built as, where its own type doesn't go into the
 * expected union as it is; undefined where it does, or where nothing builds it.
 */
function acceptedBy(part: AcceptedPart, choice: MemberChoice): Accepts | undefined {
  if (part.kind === 'decided') {
    return part.accepts;
  }
  return part.type !== undefined && choice.fits(part.type) ? undefined : part.builds;
}

/**
 * The member of the union `expected` a value is built as (§2): the one member it takes, so
 * `Entry{key: "region", …}` against `Entry<S, "retries"> | Entry<S, "region">` builds the second;
 * for a value with a type of its own that doesn't go into the union, the one member its items can
 * build it as. The union itself when the value goes in as it is, or no member or several take it,
 * which fitting then reports; of several, an empty `[]` takes the arrays (the banner).
 */
export function memberBuilt(expected: Type, node: Expression, choice: MemberChoice): Type {
  if (expected.kind !== 'union' || !builtKinds.has(node.kind)) {
    return expected;
  }
  const accepted = acceptedBy(choice.part(), choice);
  if (accepted === undefined) {
    return expected;
  }
  const taking = expected.members.filter((member) =>
    takingUnfolded(accepted, choice.rules)(member, () => false),
  );
  const preferred =
    taking.length > 1 && node.kind === 'ArrayLiteral' && node.elements.length === 0
      ? taking.filter((member) => collectionTarget(choice.checker, member)?.kind === 'array')
      : taking;
  const [only] = preferred;
  return preferred.length === 1 && only !== undefined ? only : expected;
}

/**
 * The expressions built from the expected type itself; a branching one passes it on to each
 * branch, whose own value is then built from its member.
 */
const builtKinds: ReadonlySet<Expression['kind']> = new Set([
  'Identifier',
  'MemberAccess',
  'StructLiteral',
  'IndentedValue',
  'ArrayLiteral',
  'MapLiteral',
  'Tuple',
  'Lambda',
  'NoneLiteral',
]);

/**
 * `accepts`, taking as well a recursive use it takes what it unfolds to, and a recursive union of
 * whose members it takes one, as the value is then built (`memberBuilt`): `[1, [2]]` takes `Json`.
 */
export function takingUnfolded(accepts: Accepts, rules: TypeRules): Accepts {
  return (expected, isOpen) => {
    if (accepts(expected, isOpen)) {
      return true;
    }
    const target = unfolded(expected, rules);
    return target.kind === 'union' && target.recursion !== undefined
      ? target.members.some((member) => accepts(member, isOpen))
      : target !== expected && accepts(target, isOpen);
  };
}

/** The type a value built where `expected` is expected takes its type from (§2). */
export function builtFrom(expected: Type | undefined): Type | undefined {
  return expected === undefined ? undefined : (optionalInner(expected) ?? expected);
}

/** The element types `expected` asks a tuple of `length` elements for. */
export function expectedTuple(
  expected: Type | undefined,
  length: number,
): readonly Type[] | undefined {
  const target = builtFrom(expected);
  return target?.kind === 'tuple' && target.elements.length === length
    ? target.elements
    : undefined;
}

/** The function type `expected` asks a lambda or a function value for. */
export function expectedFunction(expected: Type | undefined): FunctionType | undefined {
  const target = builtFrom(expected);
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
  const type = builtFrom(expected);
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

/** The nominal type of `declaration` that `expected` asks for: it, or its member. */
export function sameNominal(
  expected: Type | undefined,
  declaration: NominalDeclaration,
): NominalType | undefined {
  return candidatesOf(expected).find(
    (candidate): candidate is NominalType =>
      candidate.kind === 'nominal' && candidate.entity.declaration === declaration,
  );
}

/** The enums a bare variant of `expected` may be of, as `sameNominal` finds them. */
export function enumsExpected(expected: Type | undefined) {
  return candidatesOf(expected).flatMap((candidate) =>
    candidate.kind === 'nominal' && candidate.entity.declaration.kind === 'EnumDeclaration'
      ? [candidate.entity.declaration]
      : [],
  );
}

/** The types a value named by its type's member may be of where `expected` is expected. */
function candidatesOf(expected: Type | undefined): readonly Type[] {
  return expected === undefined ? [] : membersOf(expected);
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
  const same = sameNominal(expected, declaration);
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
