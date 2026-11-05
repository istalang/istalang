/**
 * What a pattern selects of a value before taking it apart (§3.10, §3.11): against an `any` value,
 * the type a downcast names (downcasts.ts); against a union's, the members it matches (members.ts).
 * Either is a test, then the rest of the pattern against the value it selected, so the walk takes
 * both alike (walk.ts).
 *
 * - A name that binds selects nothing, nor does a name naming the part's own type, which matches
 *   every value of it: an `any` type's, or a union's through its alias.
 * - A literal against an `any` type that took it whole selects it as a union's member is, as a
 *   downcast does its type.
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
import { literalMembers, namesOwnType } from '../types/named-types.ts';
import type { AnyType } from '../types/type.ts';
import { literalTypeOf, memberTaken, selectsMember, unionPart } from './members.ts';
import type { PatternScope, ValuePart } from './parts.ts';
import type { PatternTests, Selection } from './pattern-tests.ts';

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
  if (union === undefined || !selectsMember(scope, node, part)) {
    return undefined;
  }
  return memberTaken(scope, node, part, union) ?? 'refused';
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
