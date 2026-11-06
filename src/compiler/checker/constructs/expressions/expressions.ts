/**
 * The checker's tables over expression kinds, one entry per kind (architecture: Registries).
 *
 * - Checking: each handler takes the body's context, the node, and the type its position expects,
 *   and gives the node's type; the context records it.
 * - Accepting: passed to a call, an expression with no type of its own has the type the chosen
 *   function decides (§3.5), so choosing asks it which parameter types it can take. Each kind says
 *   beside its own rules: `none`, a bare variant, a lambda with a parameter to infer, functions
 *   named by a name of several or a generic one, and an empty `[]` or `[:]`; a tuple, collection
 *   literal or branching expression holding one, unless what it agrees on is decided by a part with
 *   a type of its own. A part still to be inferred can be anything.
 * - Own type (`knownTypeHandlers`): for a sibling inside a composite argument, the type it has on
 *   its own without running expression checking or reporting (`acceptedPartOf`); an item already
 *   checked, as an argument literal's may be (literal-items.ts), has the type it was checked to
 *   have.
 * - Building (`buildsHandlers`): a literal of items each with a type of its own has that type when
 *   choosing, and, where its own type doesn't fit, is built as a parameter's type its items fit
 *   (§3.7): a struct, tuple, array or map literal.
 */

import { wellKnown } from '../../../../language/well-known/index.ts';
import { type Handlers, handlerOf } from '../../../../structures/kind-table.ts';
import { localFunctionOf } from '../../../binder/entities.ts';
import type { Expression, IndentedValue, Reference } from '../../../syntax/expressions/index.ts';
import { literalOf, untypedForm } from '../../../syntax/expressions/literals/indented-values.ts';
import { signedNumberOf } from '../../../syntax/expressions/literals/numbers.ts';
import { unparenthesized } from '../../../syntax/expressions/readings.ts';
import type { Identifier } from '../../../syntax/node.ts';
import type { Block } from '../../../syntax/statements/index.ts';
import { tailExpressionOf } from '../../../syntax/statements/readings.ts';
import type {
  AcceptedPart,
  Accepts,
  BodyContext,
  PartReader,
  TypedPart,
} from '../../contexts/body-context.ts';
import { takingUnfolded } from '../../types/fitting/expected.ts';
import type { Type } from '../../types/type/index.ts';
import {
  boolType,
  errorType,
  floatType,
  intType,
  stringType,
  unitType,
} from '../../types/type/primitives.ts';
import { wellKnownOf } from '../../types/type/well-known.ts';
import { literalOrBase } from '../../types/unions/unions.ts';
import { checkLambda, lambdaAccepts } from '../closures/lambdas.ts';
import { checkDereference } from './access/dereference.ts';
import { checkIndex } from './access/indexing.ts';
import { checkMemberAccess, memberAccepts } from './access/member-access.ts';
import { checkName, nameAccepts, variableType } from './access/names.ts';
import { checkUnwrap } from './access/optionals.ts';
import { checkCall } from './calls.ts';
import {
  arrayAccepts,
  arrayBuilds,
  arrayKnownType,
  collectionOpenBuilds,
  mapAccepts,
  mapBuilds,
  mapKnownType,
} from './collections/collection-accepts.ts';
import { checkArrayLiteral, checkMapLiteral, checkRange } from './collections/collections.ts';
import { checkComprehension, checkFieldComprehension } from './collections/comprehensions.ts';
import { checkAwait } from './control/await.ts';
import { blockAccepts } from './control/branches.ts';
import { checkIf, ifAccepts } from './control/control.ts';
import { checkIs, checkMatch, matchAccepts } from './control/match.ts';
import { checkPropagate } from './control/propagate.ts';
import { checkSelect, selectAccepts } from './control/select.ts';
import { checkSpawn } from './control/spawn.ts';
import { checkIndentedValue, indentedAccepts } from './indented-values.ts';
import { checkDurationLiteral } from './literals.ts';
import { checkBinary, checkChainedComparison, checkUnary } from './operators.ts';
import {
  checkNamedLiteral,
  checkStructLiteral,
  structLiteralAccepts,
  structLiteralBuilds,
  structLiteralKnownType,
} from './structs/structs.ts';
import { checkNone, noneAccepted } from './structs/variants.ts';
import { checkTemplate } from './templates.ts';
import { checkTuple, checkTupleElement, tupleAccepts, tupleBuilds } from './tuples.ts';

/** Missing and invalid nodes were reported by the parser. */
const alreadyReported = (): Type => errorType;

/**
 * `&x` anywhere but a whole call argument, which the call checks (calls.ts): the parser reported
 * it, so only `x` is checked, for what else it may hold.
 */
const misplacedReference = (context: BodyContext, node: Reference): Type => {
  context.expression(node.expression);
  return errorType;
};

// biome-ignore-start lint/style/useNamingConvention: the keys are the tree's node kinds.
export const expressionHandlers: Handlers<BodyContext, Expression, [Type | undefined], Type> = {
  Identifier: checkName,
  IntegerLiteral: (_context, node, expected) => literalOrBase(node.value, expected),
  FloatLiteral: () => floatType,
  StringLiteral: (_context, node, expected) => literalOrBase(node.value, expected),
  BooleanLiteral: (_context, node, expected) => literalOrBase(node.value, expected),
  Parenthesized: (context, node, expected) => context.expression(node.expression, expected),
  Binary: checkBinary,
  Unary: checkUnary,
  Call: checkCall,
  StructLiteral: checkStructLiteral,
  NewStructLiteral: checkNamedLiteral,
  IndentedValue: checkIndentedValue,
  MemberAccess: checkMemberAccess,
  TupleElement: checkTupleElement,
  BlockExpression: (context, node, expected) => context.block(node.block, expected),
  If: checkIf,
  DurationLiteral: checkDurationLiteral,
  NoneLiteral: checkNone,
  ArrayLiteral: checkArrayLiteral,
  MapLiteral: checkMapLiteral,
  Comprehension: checkComprehension,
  FieldComprehension: checkFieldComprehension,
  Tuple: checkTuple,
  Lambda: checkLambda,
  Reference: misplacedReference,
  Index: checkIndex,
  Propagate: checkPropagate,
  Spawn: checkSpawn,
  Unwrap: checkUnwrap,
  ChainedComparison: checkChainedComparison,
  TemplateLiteral: checkTemplate,
  Dereference: checkDereference,
  Await: checkAwait,
  Is: checkIs,
  Range: checkRange,
  Match: checkMatch,
  Select: checkSelect,
  Missing: alreadyReported,
  Invalid: alreadyReported,
};
// biome-ignore-end lint/style/useNamingConvention: the keys are the tree's node kinds.

/** A kind whose value has a type of its own, which takes part in choosing like any argument's. */
const ownType = (): undefined => undefined;

// biome-ignore-start lint/style/useNamingConvention: the keys are the tree's node kinds.
const acceptsHandlers: Handlers<BodyContext, Expression, [], Accepts | undefined> = {
  Identifier: nameAccepts,
  IntegerLiteral: ownType,
  FloatLiteral: ownType,
  StringLiteral: ownType,
  BooleanLiteral: ownType,
  Parenthesized: (context, node) => context.accepts(node.expression),
  Binary: ownType,
  Unary: ownType,
  Call: ownType,
  StructLiteral: structLiteralAccepts,
  NewStructLiteral: ownType,
  IndentedValue: indentedAccepts,
  MemberAccess: memberAccepts,
  TupleElement: ownType,
  BlockExpression: (context, node) => blockAccepts(context, node.block),
  If: ifAccepts,
  DurationLiteral: ownType,
  NoneLiteral: noneAccepted,
  ArrayLiteral: arrayAccepts,
  MapLiteral: mapAccepts,
  Comprehension: ownType,
  FieldComprehension: ownType,
  Tuple: tupleAccepts,
  Lambda: lambdaAccepts,
  Reference: ownType,
  Index: ownType,
  Propagate: ownType,
  Spawn: ownType,
  Unwrap: ownType,
  ChainedComparison: ownType,
  TemplateLiteral: ownType,
  Dereference: ownType,
  Await: ownType,
  Is: ownType,
  Range: ownType,
  Match: matchAccepts,
  Select: selectAccepts,
  Missing: ownType,
  Invalid: ownType,
};
// biome-ignore-end lint/style/useNamingConvention: the keys are the tree's node kinds.

/**
 * Which parameter types `node` can take when the call it is passed to decides its type; undefined
 * when it has a type of its own. A recursive type takes it as what it unfolds to, and a union of
 * which the value can be built as one member takes it too, as it is then built (§2,
 * types/fitting/expected.ts `memberBuilt`).
 */
export function acceptsOf(context: BodyContext, node: Expression): Accepts | undefined {
  const accepts = handlerOf(acceptsHandlers, node)(context, node);
  if (accepts === undefined) {
    return undefined;
  }
  const taking = takingUnfolded(accepts);
  return (expected, isOpen) => isOpen(expected) || taking(expected, isOpen);
}

/** A kind whose value depends on checking or on the expected type. */
const unknownType = (): undefined => undefined;

// biome-ignore-start lint/style/useNamingConvention: the keys are the tree's node kinds.
const knownTypeHandlers: Handlers<BodyContext, Expression, [], Type | undefined> = {
  Identifier: identifierKnownType,
  IntegerLiteral: () => intType,
  FloatLiteral: () => floatType,
  StringLiteral: () => stringType,
  BooleanLiteral: () => boolType,
  Parenthesized: (context, node) => knownTypeOf(context, node.expression),
  Binary: unknownType,
  Unary: (_context, node) => signedNumberType(node),
  Call: unknownType,
  StructLiteral: structLiteralKnownType,
  NewStructLiteral: unknownType,
  IndentedValue: (context, node) => {
    const literal = untypedLiteral(node);
    return literal === undefined ? undefined : knownTypeOf(context, literal);
  },
  MemberAccess: unknownType,
  TupleElement: unknownType,
  BlockExpression: (context, node) => blockKnownType(context, node.block),
  If: unknownType,
  DurationLiteral: (context) => wellKnownOf(context.checker, wellKnown.duration),
  NoneLiteral: unknownType,
  ArrayLiteral: arrayKnownType,
  MapLiteral: mapKnownType,
  Comprehension: unknownType,
  FieldComprehension: unknownType,
  Tuple: (context, node) => tupleKnownType(context, node.elements),
  Lambda: unknownType,
  Reference: unknownType,
  Index: unknownType,
  Propagate: unknownType,
  Spawn: unknownType,
  Unwrap: unknownType,
  ChainedComparison: unknownType,
  TemplateLiteral: (_context, node) => (node.tag === undefined ? stringType : undefined),
  Dereference: unknownType,
  Await: unknownType,
  Is: () => boolType,
  Range: (context) => wellKnownOf(context.checker, wellKnown.range),
  Match: unknownType,
  Select: unknownType,
  Missing: unknownType,
  Invalid: unknownType,
};
// biome-ignore-end lint/style/useNamingConvention: the keys are the tree's node kinds.

/** How `node` takes part in a composite argument's `Accepts` check, read before checking it. */
export function acceptedPartOf(context: BodyContext, node: Expression | undefined): AcceptedPart {
  if (node === undefined) {
    return { kind: 'typed', type: undefined };
  }
  const accepts = context.accepts(node);
  if (accepts !== undefined) {
    return { kind: 'decided', accepts };
  }
  const read: PartReader = (part) => acceptedPartOf(context, part);
  const type = knownTypeOf(context, node);
  const builds = buildsOf(context, node, read);
  // A literal whose items agree on no one type has none of its own: where it goes decides it.
  return type === undefined && builds !== undefined
    ? { kind: 'decided', accepts: builds }
    : { kind: 'typed', type, builds };
}

/**
 * How `node`, already checked, takes part in building a literal as another type (§3.7): its type
 * as checked, and, for a literal of items, the types its checked items can build it as.
 */
export function checkedPartOf(context: BodyContext, node: Expression | undefined): TypedPart {
  if (node === undefined) {
    return { kind: 'typed', type: undefined };
  }
  const read: PartReader = (part) => checkedPartOf(context, part);
  return { kind: 'typed', type: context.typeOf(node), builds: buildsOf(context, node, read) };
}

/**
 * Whether `node` is a literal of items that can be built as another type than its own (§3.7): a
 * tuple, an array or map literal, a `struct{…}` or an indented value naming no type, maybe
 * parenthesized. A literal naming its type builds that type alone.
 */
export function isBuiltLiteral(node: Expression): boolean {
  switch (node.kind) {
    case 'Tuple':
    case 'ArrayLiteral':
    case 'MapLiteral':
      return true;
    case 'StructLiteral':
    case 'IndentedValue':
      return node.type === undefined;
    case 'Parenthesized':
      return isBuiltLiteral(node.expression);
    default:
      return false;
  }
}

/** A kind that is no literal of items, or one whose items can't be built as another type. */
const builtAsItIs = (): undefined => undefined;

// biome-ignore-start lint/style/useNamingConvention: the keys are the tree's node kinds.
const buildsHandlers: Handlers<BodyContext, Expression, [PartReader], Accepts | undefined> = {
  Identifier: builtAsItIs,
  IntegerLiteral: builtAsItIs,
  FloatLiteral: builtAsItIs,
  StringLiteral: builtAsItIs,
  BooleanLiteral: builtAsItIs,
  Parenthesized: (context, node, read) => buildsOf(context, node.expression, read),
  Binary: builtAsItIs,
  Unary: builtAsItIs,
  Call: builtAsItIs,
  StructLiteral: structLiteralBuilds,
  NewStructLiteral: builtAsItIs,
  IndentedValue: (context, node, read) => {
    const literal = untypedLiteral(node);
    return literal === undefined ? undefined : buildsOf(context, literal, read);
  },
  MemberAccess: builtAsItIs,
  TupleElement: builtAsItIs,
  BlockExpression: builtAsItIs,
  If: builtAsItIs,
  DurationLiteral: builtAsItIs,
  NoneLiteral: builtAsItIs,
  ArrayLiteral: arrayBuilds,
  MapLiteral: mapBuilds,
  Comprehension: builtAsItIs,
  FieldComprehension: builtAsItIs,
  Tuple: tupleBuilds,
  Lambda: builtAsItIs,
  Reference: builtAsItIs,
  Index: builtAsItIs,
  Propagate: builtAsItIs,
  Spawn: builtAsItIs,
  Unwrap: builtAsItIs,
  ChainedComparison: builtAsItIs,
  TemplateLiteral: builtAsItIs,
  Dereference: builtAsItIs,
  Await: builtAsItIs,
  Is: builtAsItIs,
  Range: builtAsItIs,
  Match: builtAsItIs,
  Select: builtAsItIs,
  Missing: builtAsItIs,
  Invalid: builtAsItIs,
};
// biome-ignore-end lint/style/useNamingConvention: the keys are the tree's node kinds.

/**
 * Which parameter types a literal of items each with a type of its own can be built as instead of
 * its own (§3.7), its items read by `read`; undefined for any other expression.
 */
/**
 * The types `node`'s items, as `read` reads them, can build it as instead of its own (§3.7), and,
 * as every `Accepts` taken apart does, a recursive type or a union it is built as one member of
 * (types/fitting/expected.ts `takingUnfolded`).
 */
function buildsOf(context: BodyContext, node: Expression, read: PartReader): Accepts | undefined {
  const builds = handlerOf(buildsHandlers, node)(context, node, read);
  return builds === undefined ? undefined : takingUnfolded(builds);
}

/**
 * The types `node` can be built as while its own type is known only through checking (§2,
 * types/fitting/expected.ts `memberBuilt`): a collection literal's by its shape, maybe
 * parenthesized or written as an indented value naming no type; undefined for any other expression.
 */
export function openBuildsOf(context: BodyContext, node: Expression): Accepts | undefined {
  const inner = unparenthesized(node);
  const literal = inner.kind === 'IndentedValue' ? untypedLiteral(inner) : inner;
  const builds =
    literal?.kind === 'ArrayLiteral' || literal?.kind === 'MapLiteral'
      ? collectionOpenBuilds(context, literal)
      : undefined;
  return builds === undefined ? undefined : takingUnfolded(builds);
}

/** The type `node` has on its own: as checked, for an item checked already, else as written. */
function knownTypeOf(context: BodyContext, node: Expression): Type | undefined {
  const checked = isBuiltLiteral(node) ? undefined : context.checkedTypeOf(node);
  return checked ?? handlerOf(knownTypeHandlers, node)(context, node);
}

/**
 * The literal an indented value naming no type reads as before its type is decided, the one its
 * entries make (`untypedForm`), as a bracket or `struct{…}` literal has its own type and builds;
 * undefined for one naming its type, which builds that type alone, as a literal naming it does.
 */
export function untypedLiteral(node: IndentedValue): Expression | undefined {
  return node.type === undefined ? literalOf(node, untypedForm(node)) : undefined;
}

/**
 * A negated number written in place has its literal's type
 * (syntax/expressions/literals/numbers.ts).
 */
function signedNumberType(node: Expression): Type | undefined {
  switch (signedNumberOf(node)?.kind) {
    case 'IntegerLiteral':
      return intType;
    case 'FloatLiteral':
      return floatType;
    default:
      return undefined;
  }
}

function blockKnownType(context: BodyContext, block: Block): Type | undefined {
  const tail = tailExpressionOf(block);
  return tail !== undefined && block.statements.length === 1
    ? knownTypeOf(context, tail)
    : undefined;
}

function identifierKnownType(context: BodyContext, node: Identifier): Type | undefined {
  const entity = context.entityOf(node);
  if (entity?.kind !== 'variable' || localFunctionOf(entity) !== undefined) {
    return undefined;
  }
  const type = variableType(context, entity);
  return type.kind === 'error' ? undefined : type;
}

function tupleKnownType(context: BodyContext, elements: readonly Expression[]): Type | undefined {
  if (elements.length === 0) {
    return unitType;
  }
  const types: Type[] = [];
  for (const element of elements) {
    const type = knownTypeOf(context, element);
    if (type === undefined) {
      return undefined;
    }
    types.push(type);
  }
  return { kind: 'tuple', elements: types };
}
