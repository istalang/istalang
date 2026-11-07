/**
 * Field defaults (§3.1) and variant constructors (§3.11): the fields of a struct with a default, or
 * of a variant with any, read as the parameters of a function of their own, each with its type and
 * default, so a field is held to a parameter's rules (§3.3): a default sees the fields before it, a
 * field without a written type takes its default's, a default reaching its own field is a cycle,
 * and a rest is last, an array, with no default. Its parameters are the fields in order, so a
 * layout's field `i` is its parameter `i`, and it gives the value its fields make. A literal leaving
 * field `i` out calls its default entry for parameter `i`, given the fields before it, as a call
 * leaving a parameter out does.
 *
 * A variant's is also its constructor, `fn E.V<P…>(fields) -> E<P…>`: calling the variant calls it,
 * binding arguments as any call's (§3.3), so it exists for every variant with fields, while a
 * struct's exists only to hold its defaults: a struct is never called.
 *
 * Each such function is made once from its declaration's own nodes and is checked and lowered as a
 * written one is, but where it differs it says whose fields it reads (`fieldsOwner`): a struct's
 * defaults needn't trail, since only a literal gives its fields, by name, while a variant's do, as
 * a call gives them in order (§3.11, constructs/declarations/functions/signatures.ts); its result
 * is its owner's type, never written; and its entries are named after the struct or variant, not a
 * static function's owner type.
 */

import { staticName } from '../../../foundation/language/static-names.ts';
import { memo } from '../../../foundation/structures/memo.ts';
import type { Parameter } from '../expressions/index.ts';
import type { Invalid } from '../tree/node.ts';
import {
  type Declaration,
  type DeclaredField,
  type DeclaredStruct,
  declaredFunctions,
  type EnumDeclaration,
  type FunctionDeclaration,
  hasDefault,
  type Module,
  type Variant,
} from './index.ts';

/**
 * Whose fields a fields function's parameters are: a struct's, or one variant's of an enum. It is
 * plain data with no `kind`, so a walk over the function's fields never takes it, or the owner it
 * holds, for a child node (../tree/index.ts).
 */
type FieldsOwner = { readonly struct: DeclaredStruct } | ConstructedVariant;

/** The variant a constructor builds: its enum, and which of its variants. */
export interface ConstructedVariant {
  readonly enumeration: EnumDeclaration;
  readonly variant: Variant;
}

/** The function a declaration's fields read as: made from them, never written. */
export interface FieldsFunction extends FunctionDeclaration {
  readonly fieldsOwner: FieldsOwner;
}

const fieldsFunctions = new WeakMap<DeclaredStruct | Variant, FieldsFunction | undefined>();

/** The functions `module` runs code in: its top-level `fn`s, then those its fields read as. */
export function functionsOf(module: Pick<Module, 'items'>): readonly FunctionDeclaration[] {
  return [...declaredFunctions(module), ...module.items.flatMap(fieldsFunctionsOf)];
}

/** The functions the fields of `item` read as: a struct's, or each of an enum's variants'. */
export function fieldsFunctionsOf(item: Declaration | Invalid): readonly FunctionDeclaration[] {
  switch (item.kind) {
    case 'StructDeclaration':
    case 'SharedStructDeclaration':
      return present(fieldsFunctionOf(item));
    case 'EnumDeclaration':
      return item.variants.flatMap((variant) =>
        variant.kind === 'Variant' ? present(fieldsFunctionOf(item, variant)) : [],
      );
    default:
      return [];
  }
}

/** Whether `declaration` is the function a declaration's fields read as, not a written one. */
export function isFieldsFunction(declaration: FunctionDeclaration): declaration is FieldsFunction {
  return 'fieldsOwner' in declaration;
}

/** The variant `declaration` builds, when it is a variant's constructor; undefined otherwise. */
export function constructedVariant(
  declaration: FunctionDeclaration,
): ConstructedVariant | undefined {
  return isFieldsFunction(declaration) && 'variant' in declaration.fieldsOwner
    ? declaration.fieldsOwner
    : undefined;
}

/**
 * Whether calls give `declaration`'s parameters in order, so its defaults trail (§3.3): any
 * function's but a struct's fields', which only a literal gives, by name.
 */
export function takesArgumentsInOrder(declaration: FunctionDeclaration): boolean {
  return !(isFieldsFunction(declaration) && 'struct' in declaration.fieldsOwner);
}

/**
 * The function whose parameters are the fields of a struct, or of an enum's `variant` (§3.1): a
 * struct's when one of its fields has a default, a variant's, its constructor, when it has fields.
 */
export function fieldsFunctionOf(declaration: DeclaredStruct): FieldsFunction | undefined;
export function fieldsFunctionOf(
  declaration: EnumDeclaration,
  variant: Variant,
): FieldsFunction | undefined;
export function fieldsFunctionOf(
  declaration: DeclaredStruct | EnumDeclaration,
  variant?: Variant,
): FieldsFunction | undefined {
  const fieldsOwner = fieldsOwnerOf(declaration, variant);
  if (fieldsOwner === undefined) {
    return undefined;
  }
  const owner = 'struct' in fieldsOwner ? fieldsOwner.struct : fieldsOwner.variant;
  return memo(fieldsFunctions, owner, () =>
    ('variant' in fieldsOwner ? owner.fields.length > 0 : owner.fields.some(hasDefault))
      ? {
          kind: 'FunctionDeclaration',
          span: owner.span,
          annotations: [],
          isExtern: false,
          isAsync: false,
          owner: undefined,
          name: owner.name,
          typeParameters: declaration.typeParameters,
          parameters: owner.fields.map(fieldParameter),
          returnType: undefined,
          fieldsOwner,
        }
      : undefined,
  );
}

function fieldsOwnerOf(
  declaration: DeclaredStruct | EnumDeclaration,
  variant: Variant | undefined,
): FieldsOwner | undefined {
  if (declaration.kind !== 'EnumDeclaration') {
    return { struct: declaration };
  }
  return variant === undefined ? undefined : { enumeration: declaration, variant };
}

/** The parameter a field reads as. */
function fieldParameter(field: DeclaredField | Invalid): Parameter | Invalid {
  if (field.kind === 'Invalid') {
    return field;
  }
  const { span, isRest, name, type, defaultValue } = field;
  return { kind: 'Parameter', span, isRest, name, pattern: undefined, type, defaultValue };
}

function present<T>(value: T | undefined): readonly T[] {
  return value === undefined ? [] : [value];
}

/**
 * A function's name as declared, with its owner type for a static function (`Slot.create`); a
 * fields function's is its struct's or variant's, the variant's with its enum (`Shape.Circle`).
 */
export function declaredFunctionName(declaration: FunctionDeclaration): string {
  if (isFieldsFunction(declaration)) {
    const { fieldsOwner } = declaration;
    return 'struct' in fieldsOwner
      ? fieldsOwner.struct.name.text
      : staticName(fieldsOwner.enumeration.name.text, fieldsOwner.variant.name.text);
  }
  const { owner, name } = declaration;
  return owner === undefined ? name.text : staticName(owner.text, name.text);
}
