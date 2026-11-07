/**
 * The members of a union a name written in a pattern selects (§3.11): a type, a variant or a
 * constant, as types/written/pattern-types.ts says, and with type arguments the instances they
 * give. members.ts applies it to a pattern, reporting what selects several members where it must
 * select one.
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
  instancesWith,
  membersNamed,
  membersOfType,
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

/** A name a pattern writes, with the type arguments written after it. */
interface WrittenName {
  readonly path: NamePattern['path'];
  readonly typeArguments: readonly TypeNode[];
  readonly span: NamePattern['span'];
}
