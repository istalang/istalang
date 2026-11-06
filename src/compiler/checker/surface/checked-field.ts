/**
 * How a field read reaches its field, as the checker finds it and lowering emits it (§3.1, §3.10):
 * lowering reads the record and never looks a field up by name again. A read through a type
 * parameter's constraint can't be resolved by the generic body checked once; each instantiation
 * resolves it into one of the others (wiring/body/facts/instantiation.ts), by the reads here.
 *
 * A field is read by its name, `s.name`, or by a key, `s[k]` (§3.9): a key that is one name once
 * known reads as the name does, and several keys read the field the key's value names when the
 * program runs.
 */

import { unreachable } from '../../../foundation/structures/unreachable.ts';
import type { TraitDeclaration } from '../../syntax/declarations/index.ts';
import type { Index, MemberAccess } from '../../syntax/expressions/index.ts';
import type { FieldDeclaration } from '../../syntax/types/index.ts';
import type { Checker } from '../check.ts';
import { isOpaque } from '../types/type/computed-types.ts';
import type { AnyType, FieldMember, Type } from '../types/type/index.ts';

/** A field a trait requires (§3.10): the trait, and its field's declaration. */
export interface RequiredField {
  readonly trait: TraitDeclaration;
  readonly field: FieldDeclaration;
}

/**
 * How a read reaches its field: by its position in the struct the value is, in its fields' order;
 * through the entry reading it from whichever member an `any` value holds; or, on a value of a
 * type known only per instantiation (a type parameter, or a type computed from one), as a trait
 * of its constraints requires it, which an `any` value may stand for, or as a struct constraint
 * names it, which only a struct meets (§3.5).
 */
export type FieldRead =
  | { readonly kind: 'position'; readonly index: number }
  | { readonly kind: 'dispatch'; readonly on: AnyType; readonly required: RequiredField }
  | { readonly kind: 'required'; readonly on: Type; readonly required: RequiredField }
  | { readonly kind: 'named'; readonly on: Type; readonly name: string }
  | { readonly kind: 'keyed'; readonly on: Type; readonly key: Type };

/** What reads a field: `s.name`, or `s[k]` with a key of `s`'s type (§3.9). */
export type FieldReading = MemberAccess | Index;

/**
 * How a read by a key of the type `key` reaches its field on a value of `type`: as its name does,
 * when the key is one name; by the key's value, when it may be several or isn't known yet.
 */
export function keyedFieldRead(
  checker: Pick<Checker, 'fieldsOf'>,
  type: Type,
  key: Type,
): FieldRead {
  return key.kind === 'literal' && typeof key.value === 'string'
    ? namedFieldRead(checker, type, key.value)
    : { kind: 'keyed', on: type, key };
}

/** How a read of `required`'s field reaches it on a value of `type`, which meets the trait. */
export function requiredFieldRead(
  checker: Pick<Checker, 'fieldsOf'>,
  type: Type,
  required: RequiredField,
): FieldRead {
  if (type.kind === 'any') {
    return { kind: 'dispatch', on: type, required };
  }
  return isOpaque(type)
    ? { kind: 'required', on: type, required }
    : namedFieldRead(checker, type, required.field.name.text);
}

/**
 * How a read of the field `name` reaches it on a value of `type`, which has it: by name on a type
 * known only per instantiation, by position on a struct.
 */
export function namedFieldRead(
  checker: Pick<Checker, 'fieldsOf'>,
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
  checker: Pick<Checker, 'fieldsOf'>,
  type: Type,
  name: string,
): FoundField | undefined {
  const fields = checker.fieldsOf(type) ?? [];
  const index = fields.findIndex((candidate) => candidate.name === name);
  const field = fields[index];
  return field === undefined ? undefined : { member: field, read: { kind: 'position', index } };
}
