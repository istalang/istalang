/**
 * Finite values (§3.1): no value may hold another value of its own type by value, directly or
 * through other structs, tuples and anonymous structs, since every value must end. Inside a union,
 * such as an optional, or a collection, a value may be absent, so the chain ends there; so does an
 * enum, an extern type, a shared struct (a handle, §3.18) or a type not known yet.
 *
 * The same rule holds a struct declaration's values and a recursive type's (§3.17), whatever it
 * unfolds to: a struct declaration is reached by its declaration, whatever its arguments, and a
 * recursive type by its type key, which what it unfolds to shares, so one holding itself through
 * what it unfolds to is found either way. Its guard is a set of what was reached, not `TypeCycle`: a generic struct's
 * arguments may grow along its fields (`A<T>` holding `A<Array<T>>`), so the walk must end at a
 * declaration whatever its arguments, where a guard keyed by whole types would never repeat.
 */

import type { StructDeclaration } from '../../syntax/declarations.ts';
import { type RecursiveType, unfolded } from './computed-types.ts';
import type { FieldMember, Type } from './type.ts';
import { typeKeys } from './type-keys.ts';
import type { TypeRules } from './type-rules.ts';

/** What a value must never hold by value: a struct declaration's values, or a recursive type's. */
export type SelfHolding = StructDeclaration | RecursiveType;

/** How a struct type's fields are read: a declared struct's, and what a recursive type unfolds to. */
export interface StructFieldReader {
  readonly fieldsOf: (type: Type) => readonly FieldMember[] | undefined;
  readonly unfold: (type: RecursiveType) => Type;
}

/** The reader of `checker`'s struct types. */
export function fieldReaderOf(checker: {
  readonly fieldsOf: StructFieldReader['fieldsOf'];
  readonly typeRules: TypeRules;
}): StructFieldReader {
  return {
    fieldsOf: (type) => checker.fieldsOf(type),
    unfold: (type) => unfolded(type),
  };
}

/** Whether a value of `type` holds a value of `target` by value, at any depth. */
export function holdsItself(reader: StructFieldReader, type: Type, target: SelfHolding): boolean {
  return holds(reader, type, target, new Set());
}

/** The first of `fields` whose type makes a value of `target` hold another; undefined for none. */
export function selfHoldingField(
  reader: StructFieldReader,
  fields: readonly FieldMember[],
  target: SelfHolding,
): FieldMember | undefined {
  return fields.find((field) => holds(reader, field.type, target, new Set()));
}

/** Whether a value of `type` holds a value of `target` by value, at any depth. */
function holds(
  reader: StructFieldReader,
  type: Type,
  target: SelfHolding,
  seen: Set<StructDeclaration | string>,
): boolean {
  switch (type.kind) {
    case 'tuple':
      return type.elements.some((element) => holds(reader, element, target, seen));
    case 'anonymous':
      return isTargetUse(type, target) || fieldsHold(reader, type.fields, target, seen);
    case 'recursive': {
      if (isTargetUse(type, target)) {
        return true;
      }
      const key = typeKeys.typeKey(type);
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return holds(reader, reader.unfold(type), target, seen);
    }
    case 'nominal': {
      const { declaration } = type.entity;
      if (declaration === target) {
        return true;
      }
      if (declaration.kind !== 'StructDeclaration' || seen.has(declaration)) {
        return false;
      }
      seen.add(declaration);
      return fieldsHold(reader, reader.fieldsOf(type) ?? [], target, seen);
    }
    case 'primitive':
    case 'literal':
    case 'union':
    case 'function':
    case 'parameter':
    case 'associated':
    case 'field':
    case 'keys':
    case 'mapped':
    case 'match':
    case 'any':
    case 'error':
      return false;
    default: {
      const unhandled: never = type;
      return unhandled;
    }
  }
}

function fieldsHold(
  reader: StructFieldReader,
  fields: readonly FieldMember[],
  target: SelfHolding,
  seen: Set<StructDeclaration | string>,
): boolean {
  return fields.some((field) => holds(reader, field.type, target, seen));
}

/** Whether `type` is the recursive type `target`, or what it unfolds to, by their one key. */
function isTargetUse(type: Type, target: SelfHolding): boolean {
  return target.kind === 'recursive' && typeKeys.typeKey(type) === typeKeys.typeKey(target);
}
