/**
 * The members of a union a name written in a pattern selects (§3.11): a type, a variant or a
 * constant, as types/written/pattern-types.ts says, and with type arguments the instances they
 * give, a variant's those of its enum (`case Some<Int>(x)`). members.ts applies it to a pattern,
 * reporting what selects several members where it must select one.
 */

import type { Entity } from '../../../../binder/entities.ts';
import type { NamePattern } from '../../../../syntax/patterns.ts';
import { lastName } from '../../../../syntax/tree/node.ts';
import type { TypeNode } from '../../../../syntax/types/index.ts';
import { checkerDiagnostics } from '../../../diagnostics/index.ts';
import { sameType } from '../../../types/identity/identity.ts';
import type { Type, UnionType } from '../../../types/type/index.ts';
import { typeText } from '../../../types/type/type-text.ts';
import { baseOf } from '../../../types/unions/union-members.ts';
import {
  instancesNamed,
  membersNamed,
  membersOfType,
  type PatternType,
  patternTypeOf,
  variantOwners,
} from '../../../types/written/pattern-types.ts';
import { typeOfEntity } from '../../../types/written/resolve-type.ts';
import type { PatternScope } from './parts.ts';

/**
 * The members a pattern naming a type, variant or constant selects (types/written/pattern-types.ts
 * `membersNamed`), a constant those of its base, and with type arguments the instance they give;
 * undefined after a report, or for a name naming nothing, reported where it was written. A type's
 * name sharing a member enum's variant's (`case Shared` where the prelude declares the type) is
 * qualified instead (§3.11).
 */
export function namedMembers(
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
 * The instances among `named` that `written`'s type arguments give (`instancesNamed`), or among
 * `members` the type a generic alias stands for with them; undefined after reporting arguments
 * what it names doesn't take, or naming a type in error.
 */
function instanceNamed(
  scope: PatternScope,
  entity: Entity,
  written: WrittenName,
  { named, members }: { readonly named: readonly Type[]; readonly members: readonly Type[] },
): readonly Type[] | undefined {
  const pattern = patternTypeOf(scope, entity);
  const given = written.typeArguments.map((argument) => scope.resolveType(argument));
  if (
    pattern.kind === 'genericAlias' &&
    given.length === pattern.declaration.typeParameters.length
  ) {
    const type = typeOfEntity(scope, entity, () => given);
    return type === undefined || type.kind === 'error'
      ? undefined
      : membersOfType(scope, type, members);
  }
  if (given.some((type) => type.kind === 'error')) {
    return undefined;
  }
  const instances = instancesNamed(scope, entity, named, given);
  if (instances === undefined) {
    const { text } = lastName(written.path);
    const declared = typeParameterCount(pattern, named);
    scope.report(checkerDiagnostics.typeArgumentCount(written.span, text, declared, given.length));
  }
  return instances;
}

/**
 * How many type arguments what a pattern names takes, as a message says: its declaration's, or the
 * enum's owning a variant among `owners`.
 */
function typeParameterCount(pattern: PatternType, owners: readonly Type[]): number {
  if (pattern.kind === 'generic' || pattern.kind === 'genericAlias') {
    return pattern.declaration.typeParameters.length;
  }
  const [owner] = owners;
  return owner?.kind === 'nominal' ? owner.entity.declaration.typeParameters.length : 0;
}

/** A name a pattern writes, with the type arguments written after it. */
interface WrittenName {
  readonly path: NamePattern['path'];
  readonly typeArguments: readonly TypeNode[];
  readonly span: NamePattern['span'];
}
