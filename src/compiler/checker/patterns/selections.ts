/**
 * What a pattern selects of a value before taking it apart (§3.10, §3.11): against an `any` value,
 * the type a downcast names (downcasts.ts); against a union's, the members it matches (members.ts).
 * Either is a test, then the rest of the pattern against the value it selected, so the walk takes
 * both alike (walk.ts).
 *
 * - A name that binds selects nothing, nor does a name naming the part's own type, which matches
 *   every value of it: an `any` type's, or a union's through its alias.
 * - A pattern selecting nothing its part's type holds, a union member or, on a known type of no
 *   union, another type or another enum's variant, is ruled out (§3.11): it never matches, a
 *   `never` test (checked-pattern.ts), and its case never runs.
 * - A literal against an `any` type that took it whole selects it as a union's member is, as a
 *   downcast does its type.
 * - A literal leaves its literal type to what binds it, and type arguments are written only where a
 *   union's member is selected (§3.11).
 * - The types inside an `any` type are an open set, so a downcast acts as a guard for exhaustiveness;
 *   a union's members are a closed set, each a constructor (shapes.ts).
 */

import { lastName } from '../../syntax/node.ts';
import type {
  LiteralPattern,
  NamePattern,
  Pattern,
  PatternPart,
  StructPattern,
} from '../../syntax/patterns.ts';
import { spanAcross } from '../../syntax/positions.ts';
import { checkerDiagnostics } from '../diagnostics/index.ts';
import { sameType } from '../types/identity.ts';
import { isKnown } from '../types/known-literals.ts';
import {
  literalMembers,
  namesOwnType,
  patternTypeOf,
  variantOwners,
} from '../types/named-types.ts';
import type { AnyType, Type } from '../types/type.ts';
import { baseOf } from '../types/unions.ts';
import { literalTypeOf, memberTaken, selectsMember, unionPart } from './members.ts';
import type { PatternScope, ValuePart } from './parts.ts';
import { type PatternTests, ruledOutSelection, type Selection } from './pattern-tests.ts';

/**
 * What `node`, a pattern that may fail and doesn't bind, selects of `part`: a selection, `refused`
 * after a report, or undefined when it selects nothing, so it is taken as it is.
 */
export function selectionOf(
  scope: PatternScope,
  tests: PatternTests,
  node: Pattern | PatternPart,
  part: ValuePart,
): Selection | 'refused' | undefined {
  const { type } = part;
  if (type.kind === 'any' && node.kind === 'LiteralPattern') {
    return literalThroughAny(scope, node, { ...part, type });
  }
  if (type.kind === 'any') {
    return isDowncasting(scope, node, type)
      ? downcastSelection(tests, node, { ...part, type })
      : undefined;
  }
  const union = unionPart(part);
  if (union === undefined) {
    return namesOtherType(scope, node, type) ? ruledOutSelection(part) : undefined;
  }
  if (!selectsMember(scope, node, part)) {
    return undefined;
  }
  return memberTaken(scope, node, part, union) ?? 'refused';
}

/**
 * Whether `node` names a type, or a variant, that no value of `type` is, so the part's type rules
 * the pattern out (§3.11): `type` must be known where the pattern is checked, not only per
 * instantiation (types/known-literals.ts `isKnown`). A generic alias names no one type, which is
 * reported where the pattern stands, not ruled out.
 */
function namesOtherType(scope: PatternScope, node: Pattern | PatternPart, type: Type): boolean {
  const named = namedIn(node);
  const entity = named === undefined ? undefined : scope.entityOf(lastName(named.path));
  if (entity === undefined || !isKnown(type)) {
    return false;
  }
  switch (entity.kind) {
    case 'variant':
      return !(type.kind === 'nominal' && type.entity.declaration === entity.enum);
    case 'variants':
      return variantOwners(scope, [type], entity.name).length === 0;
    case 'type':
    case 'primitive': {
      const naming = patternTypeOf(scope, entity).kind;
      return (naming === 'type' || naming === 'generic') && !namesOwnType(scope, entity, type);
    }
    default:
      return false;
  }
}

/**
 * Whether `node`, against a part of the `any` type `type`, names a type to downcast to: a struct
 * pattern, or a name not naming `type` itself.
 */
function isDowncasting(
  scope: PatternScope,
  node: Pattern | PatternPart,
  type: AnyType,
): node is StructPattern | NamePattern {
  if (node.kind !== 'NamePattern') {
    return node.kind === 'StructPattern';
  }
  const entity = scope.entityOf(lastName(node.path));
  return entity === undefined || !namesOwnType(scope, entity, type);
}

/** The name a type or variant pattern names its type or variant by; undefined for another. */
function namedIn(node: Pattern | PatternPart): NamePattern | StructPattern['type'] {
  switch (node.kind) {
    case 'StructPattern':
      return node.type;
    case 'NamePattern':
      return node;
    default:
      return undefined;
  }
}

/**
 * A downcast, then the rest of the pattern against the value of the type it names; a guard for
 * exhaustiveness, since the types inside an `any` type are an open set.
 */
function downcastSelection(
  tests: PatternTests,
  node: StructPattern | NamePattern,
  part: ValuePart & { readonly type: AnyType },
): Selection | 'refused' {
  const downcast = tests.downcast(node, part);
  if (downcast === 'ruledOut') {
    return ruledOutSelection(part);
  }
  return downcast === undefined
    ? 'refused'
    : { ...downcast, decided: false, shapeOf: () => undefined };
}

/**
 * A literal against a part of the `any` type that took the literal whole (§2): the literal selected
 * through it as a union's member is (`literalMembers`), the value inside being the literal's own;
 * a guard for exhaustiveness, since the types inside are an open set. Undefined where the `any`
 * type holds no such value, so the literal is compared as written.
 */
function literalThroughAny(
  scope: PatternScope,
  node: LiteralPattern,
  part: ValuePart & { readonly type: AnyType },
): Selection | undefined {
  const literal = literalTypeOf(node.value);
  const [member] =
    literal === undefined ? [] : literalMembers([part.type], literal, scope.typeRules);
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
 * gives them, to tell apart the members instantiating one generic type (§3.11).
 */
export function refuseTypeArguments(
  scope: Pick<PatternScope, 'report'>,
  node: Pattern | PatternPart,
): void {
  const named = node.kind === 'StructPattern' ? node.type : node;
  if (named?.kind !== 'NamePattern' && named?.kind !== 'NamedType') {
    return;
  }
  const [first] = named.typeArguments;
  const last = named.typeArguments.at(-1);
  if (first !== undefined && last !== undefined) {
    scope.report(
      checkerDiagnostics.typeArgumentsOutsideUnion(
        spanAcross(first.span, last.span),
        lastName(named.path).text,
      ),
    );
  }
}
