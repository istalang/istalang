/**
 * Struct keys (§3.1, §3.5, §3.9): `keyof S`, the type of the field a key names, `S[K]`, and mapped
 * struct types, each reduced once what it is built from is known (types/type-rules.ts). One home,
 * so `keyof`, mapped types, field loops, struct comprehensions, rest patterns and `s[k]` read keys
 * alike.
 *
 * - A struct type is a struct declaration's, not shared or extern, or a shape (§3.5). Its keys are
 *   its fields' names as String literals, in the name order every struct's fields are in (§3.1).
 * - A struct type not known yet, a type parameter with a struct constraint or a type computed from
 *   one, has the literals its constraints name beside one opaque type for every other key (a
 *   `KeysType`), so a written key fits `keyof S` as a union member does, and the keys a field
 *   loop's other pass, a rest or a mapped entry leaves are the same type with more names left out.
 * - A key is one literal, a union of them, a member type parameter of keys (one key per
 *   instantiation), or the opaque other keys. Several keys name the union of their fields' types;
 *   a key not known yet names an opaque field, meeting what every field it may name meets.
 * - A mapped struct type's keys are its parameter's union less the names its braces give fields
 *   (`mappedKeys`), so its value is checked once for those keys, never for a field written beside
 *   it. Once they are String literals, it is the shape of its named fields and one field per key.
 * - A field loop's body is checked once per key a literal names and once for the keys not known
 *   yet (`fieldPassesOver`), as a mapped type's value is.
 */

import { compareOrdered } from '../../../language/order.ts';
import type { TypeParameter } from '../../syntax/declarations.ts';
import type { Expression } from '../../syntax/expressions/index.ts';
import { unparenthesized } from '../../syntax/expressions/readings.ts';
import type { Pattern } from '../../syntax/patterns.ts';
import { parentOf } from '../../syntax/tree.ts';
import type { StructType } from '../../syntax/types.ts';
import type { BodyContext } from '../body-context.ts';
import type { CheckerContext } from '../context.ts';
import { aliasedAs } from '../types/alias-uses.ts';
import { isOpaque, type MappedParts } from '../types/computed-types.ts';
import { typeKeys } from '../types/identity/type-keys.ts';
import { errorType, isPrimitive, neverType } from '../types/primitives.ts';
import { substitute } from '../types/substitution.ts';
import {
  isMemberParameter,
  type ParameterKey,
  type StructValueType,
  shapeType,
  type Type,
} from '../types/type.ts';
import { literalType, membersOf, unionOf } from '../types/unions/unions.ts';
import { keysOwner } from '../types/written/key-types.ts';
import { entryRules, structConstraintsOn } from './known-constraints.ts';

/** Whether `type` is a struct type (§3.5): a struct declaration's, not shared or extern, or a shape. */
export function isStructType(type: Type): type is StructValueType {
  return (
    type.kind === 'anonymous' ||
    (type.kind === 'nominal' && type.entity.declaration.kind === 'StructDeclaration')
  );
}

/** The names a struct type's fields have as keys, a String literal's value; undefined for others. */
export function keyName(key: Type): string | undefined {
  return key.kind === 'literal' && typeof key.value === 'string' ? key.value : undefined;
}

/**
 * The keys of `of` but those `without` names (the module's banner): a known struct type's literals,
 * `Never` for none; one not known yet's named literals beside its opaque other keys; a mapped
 * struct type's named fields' beside its own keys. The error type for any other type.
 */
export function keysOf(checker: CheckerContext, of: Type, without: readonly string[]): Type {
  const rules = checker.typeRules;
  const left = (name: string) => !without.includes(name);
  if (of.kind === 'error') {
    return of;
  }
  if (isStructType(of)) {
    const fields = (checker.fieldsOf(of) ?? []).filter((field) => left(field.name));
    const keys = unionOf(
      fields.map((field) => literalType(field.name)),
      rules,
    );
    return without.length === 0 ? aliasedAs(keys, { kind: 'keys', of }) : keys;
  }
  if (of.kind === 'mapped') {
    const named = of.named.filter((field) => left(field.name));
    return unionOf(
      [...named.map((field) => literalType(field.name)), withoutKeys(checker, of.keys, without)],
      rules,
    );
  }
  const models = isOpaque(of) ? structConstraintsOn(checker, of) : [];
  if (models.length === 0) {
    return errorType;
  }
  const named = [...new Set(models.flatMap((model) => model.named.map((entry) => entry.name)))];
  const others: Type = { kind: 'keys', of, without: inNameOrder([...named, ...without]) };
  return unionOf([...inNameOrder(named.filter(left)).map(literalType), others], rules);
}

/** `names` each once, in the name order keys are in (§3.1). */
function inNameOrder(names: readonly string[]): readonly string[] {
  return [...new Set(names)].sort(compareOrdered);
}

/**
 * `keys` without those `names` names: a literal left out, and every opaque other keys' leaving the
 * names out too. A member parameter can't leave one out, so it stays.
 */
function withoutKeys(checker: CheckerContext, keys: Type, names: readonly string[]): Type {
  if (names.length === 0) {
    return keys;
  }
  const left = membersOf(keys).flatMap((member): Type[] => {
    const name = keyName(member);
    if (name !== undefined) {
      return names.includes(name) ? [] : [member];
    }
    return member.kind === 'keys'
      ? [checker.typeRules.keysOf(member.of, [...member.without, ...names])]
      : [member];
  });
  return unionOf(left, checker.typeRules);
}

/**
 * The keys of a mapped entry (§3.1): its parameter's `union`, less every name the braces `holding`
 * it give a field of their own.
 */
function mappedKeys(checker: CheckerContext, holding: StructType, union: Type): Type {
  const named = holding.fields.flatMap((field) =>
    field.kind === 'FieldDeclaration' ? [field.name.text] : [],
  );
  return withoutKeys(checker, union, named);
}

/**
 * The union the member parameter `parameter` stands for one member of, resolved where it is
 * declared (§3.5); a mapped entry's less the names its braces give fields (`mappedKeys`).
 * Undefined for any other parameter; the error type where it names a member parameter, one type
 * with no members to choose from (`namesMemberParameter`), so nothing follows it round a cycle.
 */
export function memberUnionOf(checker: CheckerContext, parameter: TypeParameter): Type | undefined {
  if (parameter.memberOf === undefined) {
    return undefined;
  }
  if (namesMemberParameter(checker, parameter)) {
    return errorType;
  }
  const module = checker.moduleOf(parameter);
  const union = checker.resolveType(module, parameter.memberOf);
  const tree = checker.inputs.treeOf(module);
  const entry = parentOf(tree, parameter);
  const holding = entry?.kind === 'MappedField' ? parentOf(tree, entry) : undefined;
  return holding?.kind === 'StructType' ? mappedKeys(checker, holding, union) : union;
}

/**
 * Whether the member parameter `parameter` is written of another member parameter (`S in S`,
 * `A in B, B in A`, `T in S`), which stands for one type already: a mistake (§3.5).
 */
export function namesMemberParameter(checker: CheckerContext, parameter: TypeParameter): boolean {
  return (
    parameter.memberOf !== undefined &&
    isMemberParameter(checker.resolveType(checker.moduleOf(parameter), parameter.memberOf))
  );
}

/**
 * Whether every key `key` may be is one of `keys`: a literal among them, other keys leaving out at
 * least what one of them does, a member parameter whose every member is, and `Never`, none.
 */
export function isKeyWithin(checker: CheckerContext, key: Type, keys: Type): boolean {
  const among = membersOf(keys);
  return membersOf(key).every((member) => {
    if (member.kind === 'error' || isPrimitive(member, 'Never')) {
      return true;
    }
    if (member.kind === 'keys') {
      return among.some(
        (each) =>
          each.kind === 'keys' &&
          typeKeys.typeKey(each.of) === typeKeys.typeKey(member.of) &&
          each.without.every((name) => member.without.includes(name)),
      );
    }
    if (member.kind === 'parameter') {
      const union = checker.fitting.memberUnionOf(member);
      return (
        among.some((each) => typeKeys.typeKey(each) === typeKeys.typeKey(member)) ||
        (union !== undefined && isKeyWithin(checker, union, keys))
      );
    }
    return among.some((each) => typeKeys.typeKey(each) === typeKeys.typeKey(member));
  });
}

/**
 * The type of the field `key` names in `of` (§3.1): a known struct's field's, the union of their
 * types for several keys, `Never` for none. A key not known yet names an opaque field of its own,
 * and so does one a struct constraint names without an exact type. The error type when `of` has no
 * keys, or `key` is no key of `of`.
 */
export function fieldTypeOf(checker: CheckerContext, of: Type, key: Type): Type {
  if (of.kind === 'error' || key.kind === 'error') {
    return errorType;
  }
  if (key.kind === 'union') {
    const types = key.members.map((member) => fieldTypeOf(checker, of, member));
    return types.some((type) => type.kind === 'error')
      ? errorType
      : unionOf(types, checker.typeRules);
  }
  if (isPrimitive(key, 'Never')) {
    return neverType;
  }
  const name = keyName(key);
  if (name !== undefined) {
    return namedFieldType(checker, of, name);
  }
  const keys = keysOf(checker, of, []);
  if (keys.kind === 'error' || !isKeyWithin(checker, key, keys)) {
    return errorType;
  }
  if (of.kind === 'mapped' && key.kind === 'parameter' && isKeyWithin(checker, key, of.keys)) {
    return mappedFieldType(checker, of, key);
  }
  return opaqueFieldType(checker, of, key) ?? { kind: 'field', of, key };
}

/** The type of the field `name` names in `of`, as `fieldTypeOf` says. */
function namedFieldType(checker: CheckerContext, of: Type, name: string): Type {
  if (isStructType(of)) {
    return checker.fieldsOf(of)?.find((field) => field.name === name)?.type ?? errorType;
  }
  if (of.kind === 'mapped') {
    const field = of.named.find((each) => each.name === name);
    if (field !== undefined) {
      return field.type;
    }
    return isKeyWithin(checker, literalType(name), of.keys)
      ? mappedFieldType(checker, of, literalType(name))
      : errorType;
  }
  return (isOpaque(of) && opaqueFieldType(checker, of, literalType(name))) || errorType;
}

/**
 * The type of the field `key` names in `of`, a struct not known yet: the exact type its struct
 * constraints give it, else the opaque field meeting what they ask; undefined when they ask
 * nothing of it, so it may not be there.
 */
function opaqueFieldType(checker: CheckerContext, of: Type, key: Type): Type | undefined {
  const opaque: Type = { kind: 'field', of, key };
  const rules = entryRules(checker, opaque);
  const exact = rules.find((rule) => rule.kind === 'type');
  if (exact !== undefined) {
    return exact.type;
  }
  return rules.length === 0 ? undefined : opaque;
}

/**
 * The value a mapped struct type gives the field `key` names: its value, for that key, `outer`
 * replaced in it in the same pass.
 */
function mappedFieldType(
  checker: CheckerContext,
  of: MappedParts,
  key: Type,
  outer: ReadonlyMap<ParameterKey, Type> = new Map(),
): Type {
  return substitute(of.value, new Map([...outer, [of.parameter, key]]), checker.typeRules);
}

/**
 * The mapped struct type `parts` builds (§3.1), its value read through `outer` too: once every key
 * is a String literal, the shape of its named fields and one per key, of its value for that key;
 * else the opaque mapped type. A key and what it keys into are replaced in one pass, so the field
 * a key names is never asked of a struct while the key still ranges over another's keys. Keys
 * that aren't names were reported where the type was written, so they leave the error type.
 */
export function mappedTypeOf(
  checker: CheckerContext,
  parts: MappedParts,
  outer: ReadonlyMap<ParameterKey, Type> = new Map(),
): Type {
  const keys = membersOf(parts.keys);
  if (keys.some((key) => key.kind === 'error')) {
    return errorType;
  }
  if (!keys.every((key) => keyName(key) !== undefined || isPrimitive(key, 'Never'))) {
    const value = substitute(parts.value, outer, checker.typeRules);
    return { kind: 'mapped', ...parts, value };
  }
  const mapped = keys.flatMap((key) => {
    const name = keyName(key);
    return name === undefined ? [] : [{ name, type: mappedFieldType(checker, parts, key, outer) }];
  });
  return shapeType(parts.origin, [...parts.named, ...mapped]);
}

/**
 * The struct the value of `value` is a key of, as checked: its type a struct's keys, or a member
 * parameter within them, or a field loop's key, a name of the struct it runs over (§4); else
 * undefined. A String literal compared with it is a key of that struct too (§3.1).
 */
export function keyOwnerOfValue(
  context: Pick<BodyContext, 'checker' | 'entityOf' | 'typeOf'>,
  value: Expression,
): Type | undefined {
  const bare = unparenthesized(value);
  const entity = bare.kind === 'Identifier' ? context.entityOf(bare) : undefined;
  if (entity?.kind === 'variable' && entity.owner.kind === 'FieldHeader') {
    const { key, subject } = entity.owner;
    const inKey =
      key.span.segment === entity.name.span.segment &&
      key.span.from <= entity.name.span.from &&
      entity.name.span.to <= key.span.to;
    return inKey ? context.typeOf(subject) : undefined;
  }
  return keysOwner(context.checker.fitting, context.typeOf(value));
}

/**
 * Records each String literal `pattern` compares the whole subject with, through `|` and `as`, as
 * a key of the struct `owner` (§3.1).
 */
export function recordPatternKeys(
  context: Pick<BodyContext, 'recordKey'>,
  pattern: Pattern,
  owner: Type | undefined,
): void {
  if (owner === undefined) {
    return;
  }
  switch (pattern.kind) {
    case 'LiteralPattern':
      context.recordKey(pattern.value, owner);
      return;
    case 'OrPattern':
      for (const alternative of pattern.alternatives) {
        recordPatternKeys(context, alternative, owner);
      }
      return;
    case 'AsPattern':
      recordPatternKeys(context, pattern.pattern, owner);
      return;
    default:
      return;
  }
}
