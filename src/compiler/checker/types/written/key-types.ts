/**
 * Key types and anonymous struct types as written (§3.1): `keyof S`, `S[K]`, and a `{…}` type, a
 * mapped one among them. Each builds through the program's rules (../type/type-rules.ts), which
 * reduce it once what it is built from is known, so a written type and a substituted one are one
 * type; here, what only writing it can get wrong is reported.
 *
 * - A shape's field takes no annotation (§3.16), which is reported here, where nothing else
 *   declares it, without computing its value: that could reach the very type being resolved.
 * - A mapped entry's keys are its parameter's union less the names the braces give fields
 *   (checker `memberUnionOf`), each a String literal naming a field, or the keys of a struct not
 *   known yet; one entry at most. Its value is resolved once, its parameter standing for every key.
 */

import { followsConvention, isUnnamed } from '../../../../language/naming.ts';
import type { ModuleId } from '../../../program/program.ts';
import type { AnchoredSpan } from '../../../syntax/positions.ts';
import { isKeyword } from '../../../syntax/tokens.ts';
import type {
  IndexedType,
  MappedField,
  StructType,
  TypeNode,
} from '../../../syntax/types/index.ts';
import type { CheckerContext } from '../../contexts/context.ts';
import { checkerDiagnostics } from '../../diagnostics/index.ts';
import type { Fitting } from '../fitting/fit.ts';
import { type Substitution, substitute } from '../parts/substitution.ts';
import { type ParameterKey, shapeType, type Type } from '../type/index.ts';
import { errorType } from '../type/primitives.ts';
import { typeText } from '../type/type-text.ts';
import { membersOf } from '../unions/unions.ts';
import { declaredFields } from './declared-fields.ts';

/** Where a type is written: the checker resolving it, and its module. */
interface Written {
  readonly checker: CheckerContext;
  readonly module: ModuleId;
}

/** `keyof S` (§3.1): the union of `S`'s keys; the error type, reported, for no struct type. */
export function keysWritten({ checker, module }: Written, node: TypeNode, owner: Type): Type {
  const keys = checker.typeRules.keysOf(owner, []);
  if (keys.kind === 'error' && owner.kind !== 'error') {
    checker.report(module, checkerDiagnostics.noStructKeys(node.span, typeText(owner)));
  }
  return keys;
}

/**
 * `S[K]` (§3.1): the type of the field `K` names, or the union of those it may name; the error
 * type, reported, when `S` has no keys or `K` isn't one of them.
 */
export function fieldWritten(written: Written, node: IndexedType, owner: Type, key: Type): Type {
  const { checker, module } = written;
  const keys = keysWritten(written, node.owner, owner);
  const type = checker.typeRules.fieldType(owner, key);
  if (type.kind === 'error' && keys.kind !== 'error' && key.kind !== 'error') {
    checker.report(
      module,
      checkerDiagnostics.notKeyOf(node.key.span, typeText(key), typeText(owner)),
    );
  }
  return type;
}

/**
 * A `{…}` type (§3.1): a shape, or a mapped struct type when one of its entries maps keys; each
 * type it writes resolved by `resolve`.
 */
export function structWritten(
  written: Written,
  node: StructType,
  resolve: (node: TypeNode) => Type,
): Type {
  const { checker, module } = written;
  for (const field of node.fields) {
    for (const annotation of field.annotations ?? []) {
      checker.report(module, checkerDiagnostics.shapeFieldAnnotation(annotation.span));
    }
  }
  const named = declaredFields(
    checker,
    module,
    node.fields.filter((field) => field.kind !== 'MappedField'),
    { resolve },
  );
  const [entry, ...more] = node.fields.filter((field) => field.kind === 'MappedField');
  if (entry === undefined) {
    return shapeType(node, named);
  }
  for (const extra of more) {
    checker.report(module, checkerDiagnostics.severalMappedEntries(extra.span));
  }
  const keys = mappedKeysWritten(written, entry);
  if (keys.kind === 'error') {
    return keys;
  }
  const { parameter } = entry;
  const ranging = new Map<ParameterKey, Type>([
    [parameter, { kind: 'parameter', declaration: parameter, within: keys }],
  ]);
  const value = substitute(resolve(entry.type), ranging, checker.typeRules);
  return checker.typeRules.mappedType({ origin: node, named, parameter, keys, value });
}

/** A mapped entry's keys, each reported that names no field; the error type after a report. */
function mappedKeysWritten({ checker, module }: Written, entry: MappedField): Type {
  const keys = checker.memberUnionOf(entry.parameter) ?? errorType;
  if (keys.kind === 'error') {
    return keys;
  }
  const at: AnchoredSpan = entry.parameter.memberOf?.span ?? entry.parameter.span;
  const names = membersOf(keys).flatMap((key) =>
    key.kind === 'literal' && typeof key.value === 'string' ? [key.value] : [],
  );
  if (!membersOf(keys).every((key) => isKey(checker, key))) {
    checker.report(module, checkerDiagnostics.mappedKeysNotNames(at, typeText(keys)));
    return errorType;
  }
  const misnamed = names.find((name) => !isFieldName(name));
  if (misnamed !== undefined) {
    checker.report(module, checkerDiagnostics.mappedFieldName(at, misnamed));
    return errorType;
  }
  return keys;
}

/**
 * Whether `key` may stand among a mapped entry's keys: a String literal, `Never`, a struct's other
 * keys not known yet, or a member parameter, which stands for one of its union's.
 */
function isKey(checker: CheckerContext, key: Type): boolean {
  switch (key.kind) {
    case 'literal':
      return typeof key.value === 'string';
    case 'keys':
      return true;
    case 'primitive':
      return key.name === 'Never';
    case 'parameter':
      return checker.fitting.memberUnionOf(key) !== undefined;
    default:
      return false;
  }
}

/** Whether `name` can name a field, as a key a mapped entry makes one of (§2, §3.1). */
function isFieldName(name: string): boolean {
  return !(isUnnamed(name) || isKeyword(name)) && followsConvention(name, 'value');
}

/**
 * The struct `type` is a key of: one whose keys it is, `keyof S` reduced (spelled so) or not yet,
 * or a member parameter within them, its member union read through `fitting`; else undefined. A
 * String literal checked as such a type names that struct's field (lookup/key-denotations.ts).
 */
export function keysOwner(
  fitting: Pick<Fitting, 'memberUnionOf'>,
  type: Type | undefined,
): Type | undefined {
  if (type?.alias?.kind === 'keys') {
    return type.alias.of;
  }
  if (type?.kind === 'keys') {
    return type.of;
  }
  const union = type?.kind === 'parameter' ? fitting.memberUnionOf(type) : undefined;
  return union === undefined ? undefined : keysOwner(fitting, union);
}

/**
 * The struct a value given where `declared` stands is a key of, the instantiation giving
 * `substitution`: a member parameter's union, or the declared type itself, read through it, so a
 * literal given for `K in keyof S` names a field of the struct `S` becomes.
 */
export function givenKeysOwner(
  fitting: Fitting,
  declared: Type,
  substitution: Substitution,
): Type | undefined {
  const union = declared.kind === 'parameter' ? fitting.memberUnionOf(declared) : declared;
  return union === undefined
    ? undefined
    : keysOwner(fitting, substitute(union, substitution, fitting));
}
