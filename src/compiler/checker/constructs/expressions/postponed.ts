/**
 * Expressions a constraint scope checks only once it knows what is expected of them
 * (docs/work/variance-inference/i2-scope.md §3, wiring/body/constraint-scope.ts): a lambda whose
 * result or a parameter isn't written, a function or a variant named as a value, a bare variant
 * called, an indented value naming no type, `[]` or `[:]`, which build what they go into, and a
 * `struct{…}` with a comprehension, whose fields may be known only once what it builds is (§3.1). Checked in an open scope with nothing settled
 * expected of it, each is a placeholder of the scope, which refuses a bound it can't be a value of
 * (`admits`), so a candidate a call probes that gives it one fails.
 *
 * - What each can be a value of is read from it before checking: a lambda's arity and written
 *   parameters, the enums having a variant of a bare name, a function named's overloads. A
 *   recursive type is taken as what it unfolds to, and a union when one of its members is taken.
 * - A lambda is checked with its parameters as settled and what is known of its result guiding its
 *   body as its expected type (`Scopes.guided`), never as its declared result, so it gives what its
 *   body does (§3.14), as `xs.map(fn x: x * 2)` gives `Int`; where its result is settled, it is
 *   declared so.
 * - A function named where what it gives is still open is chosen by the parameters it is expected
 *   to take, settled, and joins the scope as a call does, its type parameters variables of the
 *   scope (resolution/choosing/named-functions.ts `openedValue`), so what it gives bounds them as a
 *   call's result would; it is checked, and recorded, once, against its type as the scope solved
 *   it. Expected to be no function, it is its lone function's whole type, so a function passed for
 *   a `T` is its whole self.
 */

import type { Expression, Lambda } from '../../../syntax/expressions/index.ts';
import type { BodyContext } from '../../contexts/body-context.ts';
import { useSite } from '../../contexts/use-site.ts';
import {
  type FunctionNaming,
  namedFunctions,
  openedValue,
} from '../../resolution/choosing/named-functions.ts';
import { settlingAt } from '../../resolution/conformance/conformance.ts';
import { placeholderOf } from '../../rules/placeholders.ts';
import type { Admits } from '../../types/fitting/expected.ts';
import {
  builtFrom,
  collectionTarget,
  expectedFunction,
  takingUnfolded,
} from '../../types/fitting/expected.ts';
import { unfolded } from '../../types/type/computed-types.ts';
import type { Type } from '../../types/type/index.ts';
import { errorType, isPrimitive } from '../../types/type/primitives.ts';
import { namedFunctionsAccepted } from '../closures/function-values.ts';
import { checkLambda, lambdaAccepts, writtenInputs } from '../closures/lambdas.ts';
import { memberAccepts, nameAccepts } from './access/names.ts';
import { emptyArrayAdmits, emptyMapAdmits } from './collections/empty-collections.ts';
import { indentedAccepts } from './literals/indented-values.ts';
import { comprehensionOf } from './structs/struct-comprehensions.ts';
import { variantCallAccepts } from './structs/variants.ts';

/** How an expression is postponed: what it can be a value of, what is expected of it so far, and how it is checked as ever. */
export interface Postponing {
  readonly admits: Admits;
  readonly expected: Type | undefined;
  readonly check: (expected: Type | undefined) => Type;
}

/**
 * `node`'s placeholder in the current scope, bounded by what is `expected` of it so far, and by
 * what a lambda's written parameters make it; the scope checks `node` once it knows enough of what
 * is expected of it, a lambda and a name as their judges here say, any other as ever (`check`).
 */
export function postponed(
  context: BodyContext,
  node: Expression,
  { admits, expected, check }: Postponing,
): Type {
  const { inference, type } = placeholderOf(context, node);
  inference.admitOpen(type, admits);
  // Judged once the scope knows enough, inside the functions it is written in, which capture what
  // it names (constructs/closures/functions.ts).
  const { functions } = context;
  const { frames } = functions;
  const checkWithin = (known: Type | undefined) => functions.within(frames, () => check(known));
  const judge = (known: Type | undefined) =>
    functions.within(frames, () => {
      switch (node.kind) {
        case 'Lambda':
          return judgeLambda(context, node, known);
        case 'Identifier':
        case 'MemberAccess':
        case 'TypeApplication':
          return judgeNamed(context, node, known, checkWithin);
        default:
          return check(known);
      }
    });
  const standsAlone = node.kind === 'IndentedValue';
  context.scopes.postpone({ node, inference, type, admits, judge, standsAlone });
  const inputs = node.kind === 'Lambda' ? writtenInputs(context, node) : undefined;
  if (inputs !== undefined) {
    inference.match(type, inputs);
  }
  if (expected !== undefined) {
    inference.match(expected, type);
  }
  return type;
}

/**
 * What `node` can be a value of, when a scope checks it only once it knows what is expected of it;
 * undefined for one with a type of its own, or decided otherwise.
 */
export function postponedAdmits(context: BodyContext, node: Expression): Admits | undefined {
  const admits = ownAdmits(context, node);
  if (admits === undefined) {
    return undefined;
  }
  const taking = takingUnfolded(admits);
  return (expected, isOpen) => isOpen(expected) || taking(expected, isOpen);
}

/**
 * What `node` is checked expecting where `expected` is: of a union, the member it is built as (§2),
 * by what it can be a value of (`admits`) or by its form (`formAdmits`); else `expected` itself.
 */
export function memberBuilt(
  context: BodyContext,
  node: Expression,
  expected: Type | undefined,
  admits: Admits | undefined,
): Type | undefined {
  const taking =
    expected === undefined ? undefined : (admits ?? formAdmits(context, node, expected));
  return expected === undefined || taking === undefined
    ? expected
    : memberAdmitted(context, node, expected, taking);
}

/**
 * The member of `expected`, a union, a value of `node` is built as (§2), as `admits`, what it can
 * be a value of, takes: the one member it takes, at any depth, so a lambda against an optional
 * function is the function, and a bare variant the enum having it; of several, an empty `[]` takes
 * the arrays. `expected` itself where none or several are taken, which fitting then judges.
 */
function memberAdmitted(
  context: BodyContext,
  node: Expression,
  expected: Type,
  admits: Admits,
): Type {
  const union = unfolded(expected);
  if (union.kind !== 'union') {
    return expected;
  }
  const taking = union.members.filter((member) => admits(member, () => false));
  const preferred =
    taking.length > 1 && node.kind === 'ArrayLiteral'
      ? taking.filter((member) => collectionTarget(context.checker, member)?.kind === 'array')
      : taking;
  const [only] = preferred;
  return preferred.length === 1 && only !== undefined
    ? memberAdmitted(context, node, only, admits)
    : expected;
}

/**
 * What a literal of items can be built as by its form, as a member of an expected union is chosen
 * for it (§2, `memberAdmitted`): an array literal an array, a map literal a map, a tuple a tuple of
 * as many elements; undefined for any other expression, and for a union an `any` type is a member
 * of, which may take the literal's own type whole.
 */
function formAdmits(context: BodyContext, node: Expression, expected: Type): Admits | undefined {
  const union = unfolded(expected);
  if (union.kind === 'union' && union.members.some((member) => member.kind === 'any')) {
    return undefined;
  }
  const { checker } = context;
  switch (node.kind) {
    case 'ArrayLiteral':
      return (member) => collectionTarget(checker, member)?.kind === 'array';
    case 'MapLiteral':
      return (member) => collectionTarget(checker, member)?.kind === 'map';
    case 'Tuple':
      return (member) => {
        const target = unfolded(member);
        return target.kind === 'tuple' && target.elements.length === node.elements.length;
      };
    default:
      return undefined;
  }
}

function ownAdmits(context: BodyContext, node: Expression): Admits | undefined {
  switch (node.kind) {
    case 'Lambda':
      return lambdaAccepts(context, node);
    case 'Identifier':
      return nameAccepts(context, node);
    case 'MemberAccess':
      return memberAccepts(context, node);
    case 'TypeApplication':
      return namedFunctionsAccepted(context, node);
    case 'Call':
      return variantCallAccepts(context, node);
    case 'IndentedValue':
      return indentedAccepts(context, node);
    case 'StructLiteral':
      return node.type === undefined && comprehensionOf(node) !== undefined
        ? (expected) => builtFrom(expected) !== undefined
        : undefined;
    case 'ArrayLiteral':
      return node.elements.length === 0 ? emptyArrayAdmits(context, node) : undefined;
    case 'MapLiteral':
      return node.entries.length === 0 ? emptyMapAdmits(context, node) : undefined;
    default:
      return undefined;
  }
}

/**
 * Checks `node`, a lambda a scope postponed, with what is known of what is expected of it: its
 * parameters as settled, its body guided by what is known of its result.
 */
function judgeLambda(context: BodyContext, node: Lambda, expected: Type | undefined): Type {
  const shape = expectedFunction(expected);
  // A result of `Never` tells nothing: it is what a lambda's own written parameters bound it with.
  if (shape !== undefined && isPrimitive(shape.result, 'Never')) {
    return context.inferLambda(node, shape);
  }
  if (shape === undefined || !context.scopes.holds(shape.result)) {
    return checkLambda(context, node, expected);
  }
  return context.inferLambda(node, shape, context.scopes.guided(shape.result));
}

/**
 * Checks `node`, a name a scope postponed, with what is known of what is expected of it: while what
 * the function gives is still open, as a member of the scope, the function its settled parameters
 * choose, checked and recorded as ever (`check`) once the scope is solved; else as ever at once,
 * against a function known whole, a value it is, or nothing. One naming no function that takes
 * the parameters is the error type, checked once the scope is solved, which says why.
 */
function judgeNamed(
  context: BodyContext,
  node: FunctionNaming,
  expected: Type | undefined,
  check: (expected: Type | undefined) => Type,
): Type {
  const { scopes } = context;
  const shape = expectedFunction(expected);
  if (shape === undefined || !scopes.holds(shape.result)) {
    return check(expected);
  }
  const named = namedFunctions(context, node);
  const opened = named === undefined ? undefined : openedValue(context, named, shape);
  if (opened === undefined) {
    scopes.whenSolved((solved) => check(solved(expected ?? errorType)));
    return errorType;
  }
  const { application, type } = opened;
  const { inference, signature } = application;
  // What the scope would choose of what it gives advises it, as an expected type advises a call.
  const result = scopes.guided(shape.result);
  if (!scopes.holds(result)) {
    inference.expect(type, { ...shape, result });
  }
  const { checker, module } = context;
  return scopes.join({
    node: undefined,
    inference,
    settling: settlingAt(useSite(checker, module, node.span), signature),
    type,
    complete: () => check(inference.solved(type)),
  });
}
