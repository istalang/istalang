/**
 * Field defaults (§3.1): the fields of a struct or a variant, when one has a default, read as the
 * parameters of a function of their own, each with its type and default, so a field's default is
 * taken as a parameter's (§3.3): it sees the fields before it, a field without a written type takes
 * its default's, and a default reaching its own field is a cycle. Its parameters are the fields in
 * order, so a layout's field `i` is its parameter `i`. It is called by no name: a literal leaving
 * field `i` out calls its default entry for parameter `i`, given the fields before it, as a call
 * leaving a parameter out does.
 *
 * Each such function is made once from its declaration's own nodes and is checked and lowered as a
 * written one is, but where it differs it says whose fields it reads (`fieldsOwner`): its defaults
 * needn't trail, since a literal names its fields (declarations/functions/signatures.ts), and its
 * entries are named after the struct or variant, not a static function's owner type.
 */

import { memo } from '../../../structures/memo.ts';
import type { Parameter } from '../expressions/index.ts';
import type { Invalid } from '../node.ts';
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
 * holds, for a child node (../tree.ts).
 */
type FieldsOwner =
  | { readonly struct: DeclaredStruct }
  | { readonly enumeration: EnumDeclaration; readonly variant: Variant };

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

/**
 * The function whose parameters are the fields of a struct, or of an enum's `variant` (§3.1);
 * undefined when none of them has a default.
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
    owner.fields.some(hasDefault)
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
  const { span, name, type, defaultValue } = field;
  return { kind: 'Parameter', span, isRest: false, name, pattern: undefined, type, defaultValue };
}

function present<T>(value: T | undefined): readonly T[] {
  return value === undefined ? [] : [value];
}
