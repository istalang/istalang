/**
 * Patterns' shapes over the checker's types (§3.11): the constructors each type is made of, the
 * shape a literal gives, and how a shape no case matches is written back as a pattern.
 *
 * - A union is made of its members (§3.11), each holding its value, and a literal member or `None`
 *   nothing beside its tag.
 * - An enum is made of its variants, `Bool` of `true` and `false`, and a tuple, a struct, `Unit`
 *   and a literal type of one constructor each, the literal's being its value; an array of its
 *   lengths (exhaustiveness.ts). A member parameter (§3.5) is made of what its union's members are
 *   made of, since each instantiation makes its value one member's, with no tag around it. Any other
 *   type (`Int`, `String`, a handle, a type parameter) has no finite set, so only a pattern taking
 *   anything covers it.
 * - `==` against a literal counts as a pattern, but only a literal of `Bool`, `Int`, `Float` or
 *   `String` has a shape of its own; any other literal acts as a guard.
 * - A witness is written as a pattern would be, with `_` for anything and `{…}` for fields no case
 *   looked into.
 */

import { unreachable } from '../../../structures/unreachable.ts';
import type { Expression } from '../../syntax/expressions/index.ts';
import { signedNumberOf } from '../../syntax/expressions/numbers.ts';
import type { Checker } from '../check.ts';
import type { CheckerContext } from '../context.ts';
import { unfolded } from '../types/computed-types.ts';
import { typeKeys } from '../types/identity/type-keys.ts';
import {
  type FieldMember,
  isMemberParameter,
  type LiteralValue,
  type Type,
  type UnionType,
} from '../types/type/index.ts';
import { isPrimitive } from '../types/type/primitives.ts';
import { typeText } from '../types/type-text.ts';
import { hasOneValue, membersOf } from '../types/unions/unions.ts';
import { arrayElement } from '../types/well-known.ts';
import type { ConstructorOf, Shape, Signature, WitnessShape } from './exhaustiveness.ts';

/**
 * What shapes read of the checker: a type's fields, variants, whether it is an `Array`, and the union
 * a member parameter stands for one member of.
 */
export type ShapeChecker = Pick<
  Checker,
  'fieldsOf' | 'variantsOf' | 'wellKnownType' | 'typeRules'
> &
  Pick<CheckerContext, 'fitting'>;

/** The key of the one constructor of a struct value, and of a tuple. */
export const structKey = 'struct';
export const tupleKey = 'tuple';

/** The constructors of the checker's types. */
export function signatureOf(checker: ShapeChecker): Signature<Type> {
  return (type) => {
    const items = arrayElement(checker, type);
    return items === undefined ? constructorsOf(checker, type) : { items };
  };
}

/**
 * The constructors of a type that is no array: its own kind's or its declaration's, or a member
 * parameter's members' together, each instantiation's value being one member's; undefined when
 * some member has no finite set.
 */
function constructorsOf(
  checker: ShapeChecker,
  type: Type,
): readonly ConstructorOf<Type>[] | undefined {
  if (type.kind === 'recursive') {
    // A recursive type is made of what it unfolds to (§3.17).
    return constructorsOf(checker, unfolded(type));
  }
  const union = isMemberParameter(type) ? checker.fitting.memberUnionOf(type) : undefined;
  if (union === undefined) {
    return ownConstructors(type) ?? declaredConstructors(checker, type);
  }
  const each = membersOf(union).map((member) =>
    arrayElement(checker, member) === undefined ? constructorsOf(checker, member) : undefined,
  );
  return each.every((constructors) => constructors !== undefined) ? each.flat() : undefined;
}

/**
 * The constructors a type's own kind makes it of: `Bool`'s two values, the one tuple of `Unit` or a
 * tuple type, a union's members, or a literal type's one value.
 */
function ownConstructors(type: Type): readonly ConstructorOf<Type>[] | undefined {
  if (isPrimitive(type, 'Bool')) {
    return [
      { key: 'true', arguments: [] },
      { key: 'false', arguments: [] },
    ];
  }
  if (isPrimitive(type, 'Unit')) {
    return [{ key: tupleKey, arguments: [] }];
  }
  switch (type.kind) {
    case 'tuple':
      return [{ key: tupleKey, arguments: type.elements }];
    case 'union':
      return type.members.map((member) => ({
        key: memberKey(member),
        arguments: hasOneValue(member) ? [] : [member],
      }));
    case 'literal':
      return [{ key: literalValueKey(type.value), arguments: [] }];
    default:
      return undefined;
  }
}

/** The constructors a declaration makes a type of: an enum's variants, or a struct's one. */
function declaredConstructors(
  checker: ShapeChecker,
  type: Type,
): readonly ConstructorOf<Type>[] | undefined {
  const variants = type.kind === 'nominal' ? checker.variantsOf(type) : undefined;
  if (variants !== undefined) {
    return variants.map((variant) => ({ key: variant.name, arguments: typesOf(variant.fields) }));
  }
  const fields = checker.fieldsOf(type);
  return fields === undefined ? undefined : [{ key: structKey, arguments: typesOf(fields) }];
}

/** The key of a union's member among its constructors. */
function memberKey(member: Type): string {
  return `member:${typeKeys.typeKey(member)}`;
}

/** The shape of a value of a union's `member`, the member's own value taking `inside`. */
export function memberShape(member: Type, inside: Shape): Shape {
  return {
    kind: 'constructor',
    key: memberKey(member),
    arguments: hasOneValue(member) ? [] : [inside],
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
    case 'StringLiteral':
      return literalValueKey(node.value);
    default: {
      const number = signedNumberOf(node);
      if (number === undefined) {
        return undefined;
      }
      return number.kind === 'IntegerLiteral'
        ? literalValueKey(number.value)
        : `${number.kind}:${number.value}`;
    }
  }
}

/** The key of a literal's value, which a literal type's one constructor has too. */
function literalValueKey(value: LiteralValue): string {
  switch (typeof value) {
    case 'boolean':
      return String(value);
    case 'string':
      return `StringLiteral:${value}`;
    default:
      return `IntegerLiteral:${value}`;
  }
}

/** A shape of a value of `type` written as the pattern that would match it. */
export function witnessText(checker: ShapeChecker, shape: WitnessShape, type: Type): string {
  if (shape.kind === 'any') {
    return '_';
  }
  const signed = signatureOf(checker)(type);
  if (signed !== undefined && 'items' in signed) {
    return arrayWitness(checker, shape, signed.items);
  }
  if (typeof shape.key !== 'string') {
    unreachable('An array length constructor was produced for a non-array type.');
  }
  const { key } = shape;
  if (type.kind === 'union') {
    return memberWitness(checker, shape, type);
  }
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

/** An array's shape, of `items`, as its pattern: `[_, _]`, or `[_, ..._]` for that many or more. */
function arrayWitness(
  checker: ShapeChecker,
  shape: Exclude<WitnessShape, { kind: 'any' }>,
  items: Type,
): string {
  const orMore = typeof shape.key !== 'string' && shape.key.orMore;
  const written = shape.arguments.map((argument) => witnessText(checker, argument, items));
  return `[${[...written, ...(orMore ? ['..._'] : [])].join(', ')}]`;
}

/** A union's member as a pattern: what it holds, or the member's type when it holds anything. */
function memberWitness(
  checker: ShapeChecker,
  shape: Exclude<WitnessShape, { kind: 'any' }>,
  union: UnionType,
): string {
  const member = union.members.find((each) => memberKey(each) === shape.key) ?? union;
  const [inside] = shape.arguments;
  const text = inside === undefined ? '_' : witnessText(checker, inside, member);
  return text === '_' ? typeText(member) : text;
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
