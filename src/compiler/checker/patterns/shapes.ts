/**
 * Patterns' shapes over the checker's types (§3.11): the constructors each type is made of, the
 * shape a literal gives, and how a shape no case matches is written back as a pattern.
 *
 * - An enum is made of its variants, `bool` of `true` and `false`, and a tuple, a struct and
 *   `unit` of one constructor each; an array of its lengths (exhaustiveness.ts). Any other type
 *   (`int`, `string`, a handle, a type parameter) has no finite set, so only a pattern taking
 *   anything covers it.
 * - `==` against a literal counts as a pattern, but only a literal of `bool`, `int`, `float` or
 *   `string` has a shape of its own; any other literal acts as a guard.
 * - A witness is written as a pattern would be, with `_` for anything and `{…}` for fields no case
 *   looked into.
 */

import { wellKnown } from '../../../language/well-known.ts';
import { unreachable } from '../../../structures/unreachable.ts';
import type { Expression } from '../../syntax/expressions/index.ts';
import type { Checker } from '../check.ts';
import { type FieldMember, isPrimitive, type Type } from '../types/type.ts';
import { typeText } from '../types/type-text.ts';
import { wellKnownArguments } from '../types/well-known.ts';
import type { ConstructorOf, Shape, Signature, WitnessShape } from './exhaustiveness.ts';

/** What shapes read of the checker: a type's fields, variants, and whether it is an `Array`. */
type ShapeChecker = Pick<Checker, 'fieldsOf' | 'variantsOf' | 'wellKnownType'>;

/** The key of the one constructor of a struct value, and of a tuple. */
export const structKey = 'struct';
export const tupleKey = 'tuple';

/** The constructors of the checker's types. */
export function signatureOf(checker: ShapeChecker): Signature<Type> {
  return (type) => {
    const [items] = wellKnownArguments(checker, wellKnown.array, type) ?? [];
    if (items !== undefined) {
      return { items };
    }
    if (isPrimitive(type, 'bool')) {
      return [
        { key: 'true', arguments: [] },
        { key: 'false', arguments: [] },
      ];
    }
    if (isPrimitive(type, 'unit')) {
      return [{ key: tupleKey, arguments: [] }];
    }
    if (type.kind === 'tuple') {
      return [{ key: tupleKey, arguments: type.elements }];
    }
    const variants = type.kind === 'nominal' ? checker.variantsOf(type) : undefined;
    if (variants !== undefined) {
      return variants.map(
        (variant): ConstructorOf<Type> => ({
          key: variant.name,
          arguments: typesOf(variant.fields),
        }),
      );
    }
    const fields = checker.fieldsOf(type);
    return fields === undefined ? undefined : [{ key: structKey, arguments: typesOf(fields) }];
  };
}

/** A constructor taking no arguments: a variant without fields, or a literal, by its key. */
export function nullaryShape(key: string): Shape {
  return { kind: 'constructor', key, arguments: [] };
}

/** The shape a literal gives, undefined for one that acts as a guard; its key is its value. */
export function literalShape(node: Expression): Shape | undefined {
  const key = literalKey(node);
  return key === undefined ? undefined : nullaryShape(key);
}

function literalKey(node: Expression): string | undefined {
  switch (node.kind) {
    case 'BooleanLiteral':
      return String(node.value);
    case 'IntegerLiteral':
    case 'FloatLiteral':
      return `${node.kind}:${node.value}`;
    case 'StringLiteral':
      return `${node.kind}:${node.value}`;
    case 'Unary': {
      const operand = node.operator === '-' ? literalKey(node.operand) : undefined;
      return operand === undefined ? undefined : `-${operand}`;
    }
    default:
      return undefined;
  }
}

/** A shape of a value of `type` written as the pattern that would match it. */
export function witnessText(checker: ShapeChecker, shape: WitnessShape, type: Type): string {
  if (shape.kind === 'any') {
    return '_';
  }
  const signed = signatureOf(checker)(type);
  if (signed !== undefined && 'items' in signed) {
    const orMore = typeof shape.key !== 'string' && shape.key.orMore;
    const items = shape.arguments.map((argument) => witnessText(checker, argument, signed.items));
    return `[${[...items, ...(orMore ? ['..._'] : [])].join(', ')}]`;
  }
  if (typeof shape.key !== 'string') {
    unreachable('An array length constructor was produced for a non-array type.');
  }
  const { key } = shape;
  const made = signed?.find((option) => option.key === key);
  const parts = shape.arguments.map((argument, index) =>
    witnessText(checker, argument, made?.arguments[index] ?? type),
  );
  if (key === tupleKey) {
    return `(${parts.join(', ')})`;
  }
  const fields = fieldsOfConstructor(checker, type, key);
  const name = key === structKey ? typeText(type) : key;
  const looked = fields.flatMap((field, index) =>
    parts[index] === '_' ? [] : [`${field.name} is ${parts[index]}`],
  );
  if (fields.length === 0) {
    return name;
  }
  return looked.length === 0 ? `${name}{…}` : `${name}{${looked.join(', ')}}`;
}

function fieldsOfConstructor(
  checker: ShapeChecker,
  type: Type,
  key: string,
): readonly FieldMember[] {
  const variants = type.kind === 'nominal' ? checker.variantsOf(type) : undefined;
  return (
    variants?.find((variant) => variant.name === key)?.fields ??
    (key === structKey ? (checker.fieldsOf(type) ?? []) : [])
  );
}

function typesOf(fields: readonly FieldMember[]): readonly Type[] {
  return fields.map((field) => field.type);
}
