/**
 * Patterns' shapes over the checker's types (§3.11): the constructors each type is made of, the
 * shape a literal gives, and how a shape no case matches is written back as a pattern.
 *
 * - An enum is made of its variants, `bool` of `true` and `false`, and a tuple, a struct and
 *   `unit` of one constructor each. Any other type (`int`, `string`, a handle, a type parameter)
 *   has no finite set, so only a pattern taking anything covers it.
 * - `==` against a literal counts as a pattern, but only a literal of `bool`, `int`, `float` or
 *   `string` has a shape of its own; any other literal acts as a guard.
 * - A witness is written as a pattern would be, with `_` for anything and `{…}` for fields no case
 *   looked into.
 */

import type { Expression } from '../../syntax/expressions/index.ts';
import type { Checker } from '../check.ts';
import { type FieldMember, isPrimitive, type Type } from '../types/type.ts';
import { typeText } from '../types/type-text.ts';
import type { ConstructorOf, Shape, Signature } from './exhaustiveness.ts';

/** The key of the one constructor of a struct value, and of a tuple. */
export const structKey = 'struct';
export const tupleKey = 'tuple';

/** The constructors of the checker's types. */
export function signatureOf(checker: Pick<Checker, 'fieldsOf' | 'variantsOf'>): Signature<Type> {
  return (type) => {
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
export function witnessText(
  checker: Pick<Checker, 'fieldsOf' | 'variantsOf'>,
  shape: Shape,
  type: Type,
): string {
  if (shape.kind === 'any') {
    return '_';
  }
  const made = signatureOf(checker)(type)?.find(({ key }) => key === shape.key);
  const parts = shape.arguments.map((argument, index) =>
    witnessText(checker, argument, made?.arguments[index] ?? type),
  );
  if (shape.key === tupleKey) {
    return `(${parts.join(', ')})`;
  }
  const fields = fieldsOfConstructor(checker, type, shape.key);
  const name = shape.key === structKey ? typeText(type) : shape.key;
  const looked = fields.flatMap((field, index) =>
    parts[index] === '_' ? [] : [`${field.name} is ${parts[index]}`],
  );
  if (fields.length === 0) {
    return name;
  }
  return looked.length === 0 ? `${name}{…}` : `${name}{${looked.join(', ')}}`;
}

function fieldsOfConstructor(
  checker: Pick<Checker, 'fieldsOf' | 'variantsOf'>,
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
