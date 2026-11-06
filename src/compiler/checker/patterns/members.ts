/**
 * The members of a union a pattern selects (§3.11): against a union, every pattern that could fail
 * to match tests which member the value is, then matches the rest of itself against that member's
 * value, as a downcast does on an `any` value (downcasts.ts). What a name, a literal or a pattern's
 * kind selects is types/pattern-types.ts's rule, which completion reads too; this module applies it
 * to a written pattern and reports what goes wrong.
 *
 * - A type pattern, or a literal selecting its own literal member or `None`, says all there is to
 *   match. Any other pattern takes one member's value apart, so it must select exactly one.
 * - A pattern selecting no member never matches, a case its union rules out (§3.11). One selecting
 *   several where it must name one is refused: a variant several member enums declare is qualified, a generic type several members
 *   instantiate is given its type arguments, written in full, since the member names them all
 *   (`case Box<Int>{value}`), and several shapes having the fields are named through their
 *   aliases (`case Point as p`). A type's name a member enum's variant shares is qualified too.
 * - What binds the selection has the members selected that earlier cases left (`leftOf`), through
 *   the alias the pattern names when that is all of them.
 */

import type { Entity } from '../../binder/entities.ts';
import type { Expression } from '../../syntax/expressions/index.ts';
import { signedNumberOf } from '../../syntax/expressions/numbers.ts';
import { isMissingName, lastName } from '../../syntax/node.ts';
import type { NamePattern, Pattern, PatternPart } from '../../syntax/patterns.ts';
import type { TypeNode } from '../../syntax/types.ts';
import { checkerDiagnostics } from '../diagnostics/index.ts';
import type { PatternTest } from '../surface/checked-pattern.ts';
import { sameType } from '../types/identity.ts';
import {
  instancesWith,
  kindMembers,
  literalMembers,
  membersNamed,
  membersOfType,
  patternTypeOf,
  variantOwners,
} from '../types/pattern-types.ts';
import { floatType, noneType } from '../types/primitives.ts';
import { typeOfEntity } from '../types/resolve-type.ts';
import type { Type, UnionType } from '../types/type.ts';
import { typeText } from '../types/type-text.ts';
import { baseOf } from '../types/union-members.ts';
import {
  hasMember,
  hasOneValue,
  membersOf,
  unionOfNormalized,
  writtenLiteral,
} from '../types/unions.ts';
import { anyShape } from './exhaustiveness.ts';
import type { PatternScope, ValuePart } from './parts.ts';
import { ruledOutSelection, type Selection } from './pattern-tests.ts';
import { memberShape } from './shapes.ts';

/**
 * The union a part's value is of, whose members a pattern selects among; undefined for a part of
 * no union. What earlier cases took (remaining.ts) narrows only what binds the part: a later case
 * still selects among all the members, and one selecting only those taken is unreachable.
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
  scope: PatternScope,
  node: Pattern | PatternPart,
  part: ValuePart,
  union: UnionType,
): Selection | undefined {
  const isTypePattern = node.kind === 'NamePattern' && namesType(scope, node);
  const selected = selectedMembers(scope, node, union, !isTypePattern);
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
      part: { type: asNamed(scope, node, left), path: part.path, narrowedFrom: union },
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
  scope: PatternScope,
  node: Pattern | PatternPart,
  part: ValuePart,
): boolean {
  switch (node.kind) {
    case 'LiteralPattern':
    case 'RangePattern':
    case 'TuplePattern':
    case 'ArrayPattern':
    case 'StructPattern':
      return true;
    case 'NamePattern': {
      const name = lastName(node.path);
      return !(isMissingName(name) || namesOwn(scope, node, part));
    }
    default:
      return false;
  }
}

/**
 * Whether a name pattern names `part`'s own type, a union, as an alias of it does; an alias of
 * another union, or of the part's union before earlier cases narrowed it, selects its members.
 */
function namesOwn(scope: PatternScope, node: NamePattern, part: ValuePart): boolean {
  const named = namedType(scope, node);
  return named?.kind === 'union' && sameType(named, part.type);
}

/** `type`, as the type `node` names where it is that type, so what binds it keeps its alias. */
function asNamed(scope: PatternScope, node: Pattern | PatternPart, type: Type): Type {
  const named = node.kind === 'NamePattern' ? namedType(scope, node) : undefined;
  return named !== undefined && sameType(named, type) ? named : type;
}

/** The one type a name pattern names, as patternTypeOf says; undefined when it names none. */
function namedType(scope: PatternScope, node: NamePattern): Type | undefined {
  const entity = scope.entityOf(lastName(node.path));
  const named = entity === undefined ? undefined : patternTypeOf(scope, entity);
  return named?.kind === 'type' ? named.type : undefined;
}

/** Whether a name pattern that refers names a type, rather than a variant or a constant. */
function namesType(scope: PatternScope, node: NamePattern): boolean {
  const entity = scope.entityOf(lastName(node.path));
  return (
    entity !== undefined &&
    entity.kind !== 'variant' &&
    entity.kind !== 'variants' &&
    entity.kind !== 'variable' &&
    patternTypeOf(scope, entity).kind !== 'none'
  );
}

/**
 * The members of `union` that `node`, a pattern that could fail, selects, none when the union
 * rules it out; undefined after reporting that it selects several where it must select one
 * (`single`).
 */
function selectedMembers(
  scope: PatternScope,
  node: Pattern | PatternPart,
  union: UnionType,
  single: boolean,
): readonly Type[] | undefined {
  const members = candidates(scope, node, union);
  if (members === undefined) {
    return undefined;
  }
  const text = typeText(union);
  if (single && members.length > 1) {
    const texts = members.map(typeText);
    scope.report(checkerDiagnostics.severalMembers(node.span, text, texts, telling(node, texts)));
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

/** The members `node` may select, as its kind says; undefined for a name naming nothing. */
function candidates(
  scope: PatternScope,
  node: Pattern | PatternPart,
  union: UnionType,
): readonly Type[] | undefined {
  const { members } = union;
  switch (node.kind) {
    case 'LiteralPattern':
      return literalSelected(scope, members, node.value);
    case 'RangePattern': {
      const bound = node.start ?? node.end;
      return bound === undefined ? [] : literalSelected(scope, members, bound.value);
    }
    case 'TuplePattern':
      return kindMembers(scope, { kind: 'tuple', count: node.elements.length }, members);
    case 'ArrayPattern':
      return kindMembers(scope, { kind: 'array' }, members);
    case 'NamePattern':
      return namedMembers(scope, node, union);
    case 'StructPattern': {
      if (node.type !== undefined) {
        return namedMembers(scope, node.type, union);
      }
      const fields = node.fields.flatMap((item) =>
        item.kind === 'Invalid' ? [] : [item.field.text],
      );
      return kindMembers(scope, { kind: 'shape', fields }, members);
    }
    default:
      return members;
  }
}

/** The members a literal pattern's value selects (types/pattern-types.ts `literalMembers`). */
function literalSelected(
  scope: PatternScope,
  members: readonly Type[],
  value: Expression,
): readonly Type[] {
  const type = literalTypeOf(value);
  return type === undefined ? [] : literalMembers(members, type, scope.typeRules);
}

/** The type a literal pattern's value has as a literal type, `None` for `none`, `Float` for a float. */
export function literalTypeOf(value: Expression): Type | undefined {
  if (value.kind === 'NoneLiteral') {
    return noneType;
  }
  return writtenLiteral(value) ?? (signedNumberOf(value) === undefined ? undefined : floatType);
}

/** A name a pattern writes, with the type arguments written after it. */
interface WrittenName {
  readonly path: NamePattern['path'];
  readonly typeArguments: readonly TypeNode[];
  readonly span: NamePattern['span'];
}

/**
 * The members a pattern naming a type, variant or constant selects (types/pattern-types.ts
 * `membersNamed`), a constant those of its base, and with type arguments the instance they give;
 * undefined after a report, or for a name naming nothing, reported where it was written. A type's
 * name sharing a member enum's variant's (`case Shared` where the prelude declares the type) is
 * qualified instead (§3.11).
 */
function namedMembers(
  scope: PatternScope,
  written: WrittenName,
  union: UnionType,
): readonly Type[] | undefined {
  const name = lastName(written.path);
  const entity = scope.entityOf(name);
  if (entity === undefined) {
    return undefined;
  }
  const { members } = union;
  if (entity.kind === 'variable') {
    const type = scope.constantType(name);
    return type === undefined ? [] : members.filter((member) => sameType(member, baseOf(type)));
  }
  const named = membersNamed(scope, entity, members);
  const owners = entity.kind === 'type' ? variantOwners(scope, members, name.text) : [];
  if (named.length === 0 && owners.length > 0) {
    const texts = owners.map(typeText);
    const qualified = `qualify it, as in '${texts[0]}.${name.text}'`;
    scope.report(
      checkerDiagnostics.severalMembers(written.span, typeText(union), texts, qualified),
    );
    return undefined;
  }
  return written.typeArguments.length === 0
    ? named
    : instanceNamed(scope, entity, written, { named, members });
}

/**
 * The instance of the generic type `entity` names that `written`'s type arguments give, among
 * `named`, or among `members` the type a generic alias stands for with them; undefined after
 * reporting arguments the type doesn't take, or naming a type in error.
 */
function instanceNamed(
  scope: PatternScope,
  entity: Entity,
  written: WrittenName,
  { named, members }: { readonly named: readonly Type[]; readonly members: readonly Type[] },
): readonly Type[] | undefined {
  const pattern = patternTypeOf(scope, entity);
  const declared =
    pattern.kind === 'generic' || pattern.kind === 'genericAlias'
      ? pattern.declaration.typeParameters.length
      : 0;
  const { typeArguments } = written;
  if (pattern.kind === 'genericAlias' && typeArguments.length === declared) {
    const given = typeArguments.map((argument) => scope.resolveType(argument));
    const type = typeOfEntity(scope, entity, () => given);
    return type === undefined || type.kind === 'error'
      ? undefined
      : membersOfType(scope, type, members);
  }
  if (pattern.kind !== 'generic' || typeArguments.length !== declared) {
    const { text } = lastName(written.path);
    scope.report(
      checkerDiagnostics.typeArgumentCount(written.span, text, declared, typeArguments.length),
    );
    return undefined;
  }
  const given = typeArguments.map((argument) => scope.resolveType(argument));
  return given.some((type) => type.kind === 'error')
    ? undefined
    : instancesWith(named, pattern.declaration, given);
}
