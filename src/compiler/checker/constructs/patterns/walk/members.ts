/**
 * The members of a union a pattern selects (§3.11): against a union, every pattern that could fail
 * to match tests which member the value is, then matches the rest of itself against that member's
 * value, as a downcast does on an `any` value (walk/kinds/downcasts.ts). What a name, a literal or
 * a pattern's kind selects is types/written/pattern-types.ts's rule, which completion reads too;
 * this module applies it to a written pattern and reports what goes wrong.
 *
 * - A type pattern, or a literal selecting its own literal member or `None`, says all there is to
 *   match. Any other pattern takes one member's value apart, so it must select exactly one.
 * - A pattern selecting no member never matches, a case its union rules out (§3.11). One selecting
 *   several where it must name one is refused: a variant several member enums declare is qualified,
 *   a generic type several members instantiate, or a variant of one, is given its type arguments,
 *   written in full, since the member names them all (`case Box<Int>{value}`,
 *   `case Ok<Int, String>(v)`, named-members.ts), and several shapes having the fields are named
 *   through their aliases (`case Point as p`). A type's name a member enum's variant shares is
 *   qualified too.
 * - What binds the selection has the members selected that earlier cases left (`leftOf`), through
 *   the alias the pattern names when that is all of them.
 */

import type { Expression } from '../../../../syntax/expressions/index.ts';
import { signedNumberOf } from '../../../../syntax/expressions/literals/numbers.ts';
import {
  type NamePattern,
  type Pattern,
  type PatternPart,
  patternHead,
} from '../../../../syntax/patterns.ts';
import { isMissingName, lastName } from '../../../../syntax/tree/node.ts';
import type { BodyContext } from '../../../contexts/body-context.ts';
import { checkerDiagnostics } from '../../../diagnostics/index.ts';
import type { PatternTest } from '../../../surface/checked-pattern.ts';
import { sameType } from '../../../types/identity/identity.ts';
import type { Type, UnionType } from '../../../types/type/index.ts';
import { membersOf } from '../../../types/type/index.ts';
import { floatType, noneType } from '../../../types/type/primitives.ts';
import { typeText } from '../../../types/type/type-text.ts';
import {
  hasMember,
  hasOneValue,
  unionOfNormalized,
  writtenLiteral,
} from '../../../types/unions/unions.ts';
import {
  kindMembers,
  literalMembers,
  patternTypeOf,
} from '../../../types/written/pattern-types.ts';
import { anyShape } from '../exhaustiveness/exhaustiveness.ts';
import { memberShape } from '../exhaustiveness/shapes.ts';
import { namedMembers } from './named-members.ts';
import type { ValuePart } from './parts.ts';
import { ruledOutSelection, type Selection } from './pattern-tests.ts';

/**
 * The union a part's value is of, whose members a pattern selects among; undefined for a part of no
 * union. What earlier cases took (exhaustiveness/remaining.ts) narrows only what binds the part: a
 * later case still selects among all the members, and one selecting only those taken is
 * unreachable.
 */
export function unionPart(part: ValuePart): UnionType | undefined {
  const from = part.narrowedFrom;
  if (from?.kind === 'union') {
    return from;
  }
  return from === undefined && part.type.kind === 'union' ? part.type : undefined;
}

/**
 * The member `node` selects of `part`, a part of `union`; undefined after a report. A type
 * pattern, or a literal selecting its own literal member or `None`, says all there is to match; a
 * type pattern naming a literals' base selects every such member, and binds their union, as far
 * as earlier cases left them.
 */
export function memberTaken(
  context: BodyContext,
  node: Pattern | PatternPart,
  part: ValuePart,
  union: UnionType,
): Selection | undefined {
  const isTypePattern = node.kind === 'NamePattern' && namesType(context, node);
  const selected = selectedMembers(context, node, union, !isTypePattern);
  if (selected === undefined) {
    return undefined;
  }
  if (selected.length === 0) {
    return ruledOutSelection(part);
  }
  const test: PatternTest = { kind: 'member', path: part.path, union, members: selected };
  const [only] = selected;
  if (only === undefined || selected.length > 1) {
    const alternatives = selected.map((member) => memberShape(member, anyShape));
    const left = leftOf(part, selected);
    return {
      test,
      part: { type: asNamed(context, node, left), path: part.path, narrowedFrom: union },
      decided: true,
      shapeOf: () => ({ kind: 'or', alternatives }),
    };
  }
  return {
    test,
    part: hasOneValue(only)
      ? { type: only, path: part.path, narrowedFrom: union }
      : { type: only, path: [...part.path, { kind: 'member', union, member: only }] },
    decided: isTypePattern || hasOneValue(only),
    shapeOf: (inside) => (inside === undefined ? undefined : memberShape(only, inside)),
  };
}

/**
 * What a name bound to `selected` members of `part`'s union has: those earlier cases left, the
 * part's own type when that is all of them; all `selected` when earlier cases took every one.
 * Alternatives may select one member twice, so the members are the union's own, each once.
 */
export function leftOf(part: ValuePart, selected: readonly Type[]): Type {
  const selecting = (members: readonly Type[]) =>
    members.filter((member) => selected.some((each) => hasMember(each, member)));
  const own = membersOf(part.type);
  const left = selecting(own);
  if (left.length === own.length) {
    return part.type;
  }
  const union = unionPart(part) ?? part.type;
  return unionOfNormalized(left.length > 0 ? left : selecting(membersOf(union)));
}

/**
 * Whether `node`, a pattern that may fail and doesn't bind, selects a member of `part`'s union: any
 * but a name naming the part's own type, which matches every value of it.
 */
export function selectsMember(
  context: BodyContext,
  node: Pattern | PatternPart,
  part: ValuePart,
): boolean {
  switch (node.kind) {
    case 'LiteralPattern':
    case 'RangePattern':
    case 'TuplePattern':
    case 'ArrayPattern':
    case 'StructPattern':
    case 'VariantCallPattern':
      return true;
    case 'NamePattern': {
      const name = lastName(node.path);
      return !(isMissingName(name) || namesOwn(context, node, part));
    }
    default:
      return false;
  }
}

/**
 * Whether a name pattern names `part`'s own type, a union, as an alias of it does; an alias of
 * another union, or of the part's union before earlier cases narrowed it, selects its members.
 */
function namesOwn(context: BodyContext, node: NamePattern, part: ValuePart): boolean {
  const named = namedType(context, node);
  return named?.kind === 'union' && sameType(named, part.type);
}

/** `type`, as the type `node` names where it is that type, so what binds it keeps its alias. */
function asNamed(context: BodyContext, node: Pattern | PatternPart, type: Type): Type {
  const named = node.kind === 'NamePattern' ? namedType(context, node) : undefined;
  return named !== undefined && sameType(named, type) ? named : type;
}

/** The one type a name pattern names, as patternTypeOf says; undefined when it names none. */
function namedType(context: BodyContext, node: NamePattern): Type | undefined {
  const entity = context.entityOf(lastName(node.path));
  const named = entity === undefined ? undefined : patternTypeOf(context.checker, entity);
  return named?.kind === 'type' ? named.type : undefined;
}

/** Whether a name pattern that refers names a type, rather than a variant or a constant. */
function namesType(context: BodyContext, node: NamePattern): boolean {
  const entity = context.entityOf(lastName(node.path));
  return (
    entity !== undefined &&
    entity.kind !== 'variant' &&
    entity.kind !== 'variants' &&
    entity.kind !== 'variable' &&
    patternTypeOf(context.checker, entity).kind !== 'none'
  );
}

/**
 * The members of `union` that `node`, a pattern that could fail, selects, none when the union
 * rules it out; undefined after reporting that it selects several where it must select one
 * (`single`).
 */
function selectedMembers(
  context: BodyContext,
  node: Pattern | PatternPart,
  union: UnionType,
  single: boolean,
): readonly Type[] | undefined {
  const members = candidates(context, node, union);
  if (members === undefined) {
    return undefined;
  }
  const text = typeText(union);
  if (single && members.length > 1) {
    const texts = members.map(typeText);
    const how = variantTelling(context, node, members) ?? telling(node, texts);
    context.report(checkerDiagnostics.severalMembers(node.span, text, texts, how));
    return undefined;
  }
  return members;
}

/**
 * How a pattern matching the members `texts` names one: a variant qualified by its enum, a shape
 * through its alias, any other member by its type.
 */
function telling(node: Pattern | PatternPart, texts: readonly string[]): string {
  const [first = 'T'] = texts;
  switch (node.kind) {
    case 'NamePattern':
      return `qualify it, as in '${first}.${lastName(node.path).text}'`;
    case 'StructPattern':
      return node.type === undefined
        ? "name the member through its alias, as in 'case Point as p'"
        : `give its type arguments, as in 'case ${first}{…}'`;
    default:
      return `name the one it takes apart, as in 'case ${first} as x'`;
  }
}

/**
 * How a call pattern names one of the enum `members` declaring its variant: qualified by its enum
 * among several enums, else with the type arguments of one instance; undefined for any other
 * pattern.
 */
function variantTelling(
  context: BodyContext,
  node: Pattern | PatternPart,
  members: readonly Type[],
): string | undefined {
  if (node.kind !== 'VariantCallPattern') {
    return undefined;
  }
  const name = patternHead(node)?.path;
  const variant = name === undefined ? undefined : lastName(name);
  const entity = variant === undefined ? undefined : context.entityOf(variant);
  const [first] = members;
  if ((entity?.kind !== 'variant' && entity?.kind !== 'variants') || first?.kind !== 'nominal') {
    return undefined;
  }
  const { declaration } = first.entity;
  return members.every(
    (member) => member.kind === 'nominal' && member.entity.declaration === declaration,
  )
    ? `give its type arguments, as in 'case ${variant?.text}<${first.arguments.map(typeText).join(', ')}>(…)'`
    : `qualify it, as in 'case ${declaration.name.text}.${variant?.text}(…)'`;
}

/** The members `node` may select, as its kind says; undefined for a name naming nothing. */
function candidates(
  context: BodyContext,
  node: Pattern | PatternPart,
  union: UnionType,
): readonly Type[] | undefined {
  const { members } = union;
  switch (node.kind) {
    case 'LiteralPattern':
      return literalSelected(context, members, node.value);
    case 'RangePattern': {
      const bound = node.start ?? node.end;
      return bound === undefined ? [] : literalSelected(context, members, bound.value);
    }
    case 'TuplePattern':
      return kindMembers(context.checker, { kind: 'tuple', count: node.elements.length }, members);
    case 'ArrayPattern':
      return kindMembers(context.checker, { kind: 'array' }, members);
    case 'NamePattern':
      return namedMembers(context, node, union);
    case 'VariantCallPattern':
      return namedMembers(context, node.callee, union);
    case 'StructPattern': {
      if (node.type !== undefined) {
        return namedMembers(context, node.type, union);
      }
      const fields = node.fields.flatMap((item) =>
        item.kind === 'Invalid' ? [] : [item.field.text],
      );
      return kindMembers(context.checker, { kind: 'shape', fields }, members);
    }
    default:
      return members;
  }
}

/**
 * The members a literal pattern's value selects (types/written/pattern-types.ts `literalMembers`).
 */
function literalSelected(
  context: BodyContext,
  members: readonly Type[],
  value: Expression,
): readonly Type[] {
  const type = literalTypeOf(value);
  return type === undefined ? [] : literalMembers(members, type, context.checker.typeRules);
}

/**
 * The type a literal pattern's value has as a literal type, `None` for `none`, `Float` for a float.
 */
export function literalTypeOf(value: Expression): Type | undefined {
  if (value.kind === 'NoneLiteral') {
    return noneType;
  }
  return writtenLiteral(value) ?? (signedNumberOf(value) === undefined ? undefined : floatType);
}
