/**
 * How a field read reaches its field, as the checker finds it and lowering emits it (§5.2, §8.2):
 * lowering reads the record and never looks a field up by name again. A read through a type
 * parameter's constraint can't be resolved by the generic body checked once; each instantiation
 * resolves it into one of the others (wiring/body/facts/instantiation.ts), by the reads here.
 *
 * A field is read by its name, `s.name`, or by a key, `s[k]` (§10.2): a key that is one name once
 * known reads as the name does, and several keys read the field the key's value names when the
 * program runs.
 */

import { unreachable } from '../../../foundation/structures/unreachable.ts';
import type { Index, MemberAccess } from '../../syntax/expressions/index.ts';
import type { FieldDeclaration } from '../../syntax/types/index.ts';
import type { Checker } from '../check.ts';
import { isOpaque } from '../types/type/computed-types.ts';
import type { Constraint, FieldMember, Type } from '../types/type/index.ts';
import type { ResolvedCall } from './resolved-call.ts';

/**
 * A field a trait requires (§8.2): the constraint requiring it, its trait with the arguments the
 * read's type meets it at, and its field's declaration.
 */
export interface RequiredField {
  readonly constraint: Constraint;
  readonly field: FieldDeclaration;
}

/**
 * How a read reaches its field: by its position in the struct `on` the value is, in its fields'
 * order, which lowering reads, the field's `name` naming it for what reads the field itself; as
 * a trait requires it of a value of `on`, an `any` type or a type known only per instantiation (a
 * type parameter, or a type computed from one), whose own type meets it with a field it stores or
 * a getter (§8.2), which lowering decides once it knows the type; or, on a type known only per
 * instantiation, as a struct constraint names it, which only a struct meets (§8.1).
 */
export type FieldRead =
  | { readonly kind: 'position'; readonly on: Type; readonly name: string; readonly index: number }
  | { readonly kind: 'required'; readonly on: Type; readonly required: RequiredField }
  | { readonly kind: 'named'; readonly on: Type; readonly name: string }
  | { readonly kind: 'keyed'; readonly on: Type; readonly key: Type };

/** What reads a field: `s.name`, or `s[k]` with a key of `s`'s type (§10.2). */
export type FieldReading = MemberAccess | Index;

/**
 * How a read by a key of the type `key` reaches its field on a value of `type`: as its name does,
 * when the key is one name; by the key's value, when it may be several or isn't known yet.
 */
export function keyedFieldRead(
  checker: Pick<Checker, 'fieldNamed'>,
  type: Type,
  key: Type,
): FieldRead {
  return key.kind === 'literal' && typeof key.value === 'string'
    ? namedFieldRead(checker, type, key.value)
    : { kind: 'keyed', on: type, key };
}

/**
 * The getter among `witnesses`, those a type meets a constraint with, that meets `field`, which
 * the constraint's trait requires and the type stores none of: they follow the functions', each
 * named as the field it meets (§8.2).
 */
export function fieldGetterAmong(
  witnesses: readonly ResolvedCall[],
  field: FieldDeclaration,
): ResolvedCall | undefined {
  return witnesses.find(
    (call) => call.function.isGetter && call.function.name.text === field.name.text,
  );
}

/**
 * How a read of the field `name` reaches it on a value of `type`, which has it: by name on a type
 * known only per instantiation, by position on a struct.
 */
export function namedFieldRead(
  checker: Pick<Checker, 'fieldNamed'>,
  type: Type,
  name: string,
): FieldRead {
  if (isOpaque(type)) {
    return { kind: 'named', on: type, name };
  }
  const found = structFieldOf(checker, type, name);
  if (found === undefined) {
    unreachable(`A type with a field '${name}' its constraints name has none.`);
  }
  return found.read;
}

/** A field a read finds, as the type read has it, and how the read reaches it. */
export interface FoundField {
  readonly member: FieldMember;
  readonly read: FieldRead;
}

/** The field `name` of `type` when it is a struct, declared or anonymous; else undefined. */
export function structFieldOf(
  checker: Pick<Checker, 'fieldNamed'>,
  type: Type,
  name: string,
): FoundField | undefined {
  const found = checker.fieldNamed(type, name);
  return found === undefined
    ? undefined
    : { member: found.member, read: { kind: 'position', on: type, name, index: found.index } };
}
