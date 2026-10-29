/**
 * How a field read reaches its field, as the checker finds it and lowering emits it (§3.1, §3.10):
 * lowering reads the record and never looks a field up by name again. A read through a type
 * parameter's constraint can't be resolved by the generic body checked once; each instantiation
 * resolves it into one of the others (types/instantiation.ts), by the one rule here.
 */

import { unreachable } from '../../structures/unreachable.ts';
import type { TraitDeclaration } from '../syntax/declarations.ts';
import type { FieldDeclaration } from '../syntax/types.ts';
import type { Checker } from './check.ts';
import type { AnyType, FieldMember, Type, TypeParameterType } from './types/type.ts';

/** A field a trait requires (§3.10): the trait, and its field's declaration. */
export interface RequiredField {
  readonly trait: TraitDeclaration;
  readonly field: FieldDeclaration;
}

/**
 * How a read reaches its field: by its position in the struct the value is, in declaration order;
 * through the entry reading it from whichever member an `any` value holds; or, on a type
 * parameter's value, as a trait of its constraints requires it.
 */
export type FieldRead =
  | { readonly kind: 'position'; readonly index: number }
  | { readonly kind: 'dispatch'; readonly on: AnyType; readonly required: RequiredField }
  | { readonly kind: 'required'; readonly on: TypeParameterType; readonly required: RequiredField };

/** How a read of `required`'s field reaches it on a value of `type`, which meets the trait. */
export function requiredFieldRead(
  checker: Pick<Checker, 'fieldsOf'>,
  type: Type,
  required: RequiredField,
): FieldRead {
  if (type.kind === 'any') {
    return { kind: 'dispatch', on: type, required };
  }
  if (type.kind === 'parameter') {
    return { kind: 'required', on: type, required };
  }
  const name = required.field.name.text;
  const found = structFieldOf(checker, type, name);
  if (found === undefined) {
    unreachable(`A type meeting a trait has no field '${name}' it requires.`);
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
