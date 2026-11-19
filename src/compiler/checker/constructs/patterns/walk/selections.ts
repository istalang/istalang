/**
 * What a pattern selects of a value before taking it apart (§8.3, §11.3): against an `any` value,
 * the type a downcast names (walk/kinds/downcasts.ts); against a union's, the members it matches
 * (members.ts). Either is a test, then the rest of the pattern against the value it selected, so
 * the walk takes both alike (walk/index.ts).
 *
 * - A name that binds selects nothing, nor does a name naming the part's own type, which matches
 *   every value of it: an `any` type's, or a union's through its alias.
 * - A pattern selecting nothing its part's type holds, a union member or, on a known type of no
 *   union, another type or another enum's variant, is ruled out (§11.3): it never matches, a
 *   `never` test (checked-pattern.ts), and its case never runs.
 * - A literal against an `any` type that took it whole selects it as a union's member is, as a
 *   downcast does its type.
 * - A literal leaves its literal type to what binds it, and type arguments are written only where a
 *   union's member is selected (§11.3).
 * - The types inside an `any` type are an open set, so a downcast acts as a guard for
 *   exhaustiveness; a union's members are a closed set, each a constructor
 *   (exhaustiveness/shapes.ts).
 */

import {
  type LiteralPattern,
  type NamePattern,
  type Pattern,
  type PatternPart,
  patternHead,
  type StructPattern,
  type VariantCallPattern,
} from '../../../../syntax/patterns.ts';
import { lastName } from '../../../../syntax/tree/node.ts';
import { spanAcross } from '../../../../syntax/tree/positions.ts';
import type { BodyContext } from '../../../contexts/body-context.ts';
import { checkerDiagnostics } from '../../../diagnostics/index.ts';
import { sameType } from '../../../types/identity/identity.ts';
import type { AnyType, Type } from '../../../types/type/index.ts';
import { isKnown } from '../../../types/unions/equality.ts';
import { baseOf } from '../../../types/unions/union-members.ts';
import {
  literalMembers,
  namesOwnType,
  patternTypeOf,
  variantOwners,
} from '../../../types/written/pattern-types.ts';
import { downcastOf } from './kinds/downcasts.ts';
import { literalTypeOf, memberTaken, selectsMember, unionPart } from './members.ts';
import type { ValuePart } from './parts.ts';
import { ruledOutSelection, type Selection } from './pattern-tests.ts';

/**
 * What `node`, a pattern that may fail and doesn't bind, selects of `part`: a selection, `refused`
 * after a report, or undefined when it selects nothing, so it is taken as it is.
 */
export function selectionOf(
  context: BodyContext,
  node: Pattern | PatternPart,
  part: ValuePart,
): Selection | 'refused' | undefined {
  const { type } = part;
  if (type.kind === 'any' && node.kind === 'LiteralPattern') {
    return literalThroughAny(context, node, { ...part, type });
  }
  if (type.kind === 'any') {
    return isDowncasting(context, node, type)
      ? downcastSelection(context, node, { ...part, type })
      : undefined;
  }
  const union = unionPart(part);
  if (union === undefined) {
    return namesOtherType(context, node, type) ? ruledOutSelection(part) : undefined;
  }
  if (!selectsMember(context, node, part)) {
    return undefined;
  }
  return memberTaken(context, node, part, union) ?? 'refused';
}

/**
 * Whether `node` names a type, or a variant, that no value of `type` is, so the part's type rules
 * the pattern out (§11.3): `type` must be known where the pattern is checked, not only per
 * instantiation (types/unions/equality.ts `isKnown`). A generic alias names no one type, which is
 * reported where the pattern stands, not ruled out.
 */
function namesOtherType(context: BodyContext, node: Pattern | PatternPart, type: Type): boolean {
  const named = patternHead(node);
  const entity = named === undefined ? undefined : context.entityOf(lastName(named.path));
  if (entity === undefined || !isKnown(type)) {
    return false;
  }
  switch (entity.kind) {
    case 'variant':
      return !(type.kind === 'nominal' && type.entity.declaration === entity.enum);
    case 'variants':
      return variantOwners(context.checker, [type], entity.name).length === 0;
    case 'type':
    case 'primitive': {
      const naming = patternTypeOf(context.checker, entity).kind;
      return (
        (naming === 'type' || naming === 'generic') && !namesOwnType(context.checker, entity, type)
      );
    }
    default:
      return false;
  }
}

/**
 * Whether `node`, against a part of the `any` type `type`, names a type to downcast to: a struct
 * or call pattern, or a name not naming `type` itself.
 */
function isDowncasting(
  context: BodyContext,
  node: Pattern | PatternPart,
  type: AnyType,
): node is StructPattern | VariantCallPattern | NamePattern {
  if (node.kind !== 'NamePattern') {
    return node.kind === 'StructPattern' || node.kind === 'VariantCallPattern';
  }
  const entity = context.entityOf(lastName(node.path));
  return entity === undefined || !namesOwnType(context.checker, entity, type);
}

/**
 * A downcast, then the rest of the pattern against the value of the type it names; a guard for
 * exhaustiveness, since the types inside an `any` type are an open set.
 */
function downcastSelection(
  context: BodyContext,
  node: StructPattern | VariantCallPattern | NamePattern,
  part: ValuePart & { readonly type: AnyType },
): Selection | 'refused' {
  const downcast = downcastOf(context, node, part);
  if (downcast === 'ruledOut') {
    return ruledOutSelection(part);
  }
  return downcast === undefined
    ? 'refused'
    : { ...downcast, decided: false, shapeOf: () => undefined };
}

/**
 * A literal against a part of the `any` type that took the literal whole (§4.2): the literal selected
 * through it as a union's member is (`literalMembers`), the value inside being the literal's own;
 * a guard for exhaustiveness, since the types inside are an open set. Undefined where the `any`
 * type holds no such value, so the literal is compared as written.
 */
function literalThroughAny(
  context: BodyContext,
  node: LiteralPattern,
  part: ValuePart & { readonly type: AnyType },
): Selection | undefined {
  const literal = literalTypeOf(node.value);
  const [member] =
    literal === undefined ? [] : literalMembers([part.type], literal, context.checker);
  return member === undefined
    ? undefined
    : {
        test: { kind: 'member', path: part.path, union: part.type, members: [member] },
        part: { type: member, path: part.path, narrowedFrom: part.type },
        decided: true,
        shapeOf: () => undefined,
      };
}

/**
 * The part a literal pattern leaves to what binds it: its literal type, where the part is of its
 * base (`case "draft" as d` against a `String`), as only that value matched.
 */
export function literalPart(node: Pattern | PatternPart, part: ValuePart): ValuePart {
  const literal = node.kind === 'LiteralPattern' ? literalTypeOf(node.value) : undefined;
  return literal?.kind === 'literal' && sameType(baseOf(literal), part.type)
    ? { ...part, type: literal }
    : part;
}

/**
 * Reports type arguments written in a pattern that selects no member of a union: only that one
 * gives them, to tell apart the members instantiating one generic type (§11.3).
 */
export function refuseTypeArguments(
  context: Pick<BodyContext, 'report'>,
  node: Pattern | PatternPart,
): void {
  const named = patternHead(node);
  if (named === undefined) {
    return;
  }
  const [first] = named.typeArguments;
  const last = named.typeArguments.at(-1);
  if (first !== undefined && last !== undefined) {
    context.report(
      checkerDiagnostics.typeArgumentsOutsideUnion(
        spanAcross(first.span, last.span),
        lastName(named.path).text,
      ),
    );
  }
}
