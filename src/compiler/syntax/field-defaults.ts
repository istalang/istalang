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
 * written one is, but where it differs (`isFieldsFunction`): its defaults needn't trail, since a
 * literal names its fields (declarations/signatures.ts).
 */

import { memo } from '../../structures/memo.ts';
import {
  type Declaration,
  type DeclaredField,
  declaredFunctions,
  type EnumDeclaration,
  type FunctionDeclaration,
  hasDefault,
  type Module,
  type StructDeclaration,
  type Variant,
} from './declarations.ts';
import type { Parameter } from './expressions/index.ts';
import type { Invalid } from './node.ts';

/** A declaration whose fields may have defaults: a struct, or one variant of an enum. */
type FieldsOwner = StructDeclaration | Variant;

const fieldsFunctions = new WeakMap<FieldsOwner, FunctionDeclaration | undefined>();

const made = new WeakSet<FunctionDeclaration>();

/** The functions `module` runs code in: its top-level `fn`s, then those its fields read as. */
export function functionsOf(module: Module): readonly FunctionDeclaration[] {
  return [...declaredFunctions(module), ...module.items.flatMap(fieldsFunctionsOf)];
}

/** The functions the fields of `item` read as: a struct's, or each of an enum's variants'. */
export function fieldsFunctionsOf(item: Declaration | Invalid): readonly FunctionDeclaration[] {
  switch (item.kind) {
    case 'StructDeclaration':
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
export function isFieldsFunction(declaration: FunctionDeclaration): boolean {
  return made.has(declaration);
}

/**
 * The function whose parameters are the fields of a struct, or of an enum's `variant` (§3.1);
 * undefined when none of them has a default.
 */
export function fieldsFunctionOf(declaration: StructDeclaration): FunctionDeclaration | undefined;
export function fieldsFunctionOf(
  declaration: EnumDeclaration,
  variant: Variant,
): FunctionDeclaration | undefined;
export function fieldsFunctionOf(
  declaration: StructDeclaration | EnumDeclaration,
  variant?: Variant,
): FunctionDeclaration | undefined {
  const owner = declaration.kind === 'StructDeclaration' ? declaration : variant;
  if (owner === undefined) {
    return undefined;
  }
  return memo(fieldsFunctions, owner, () => {
    if (!owner.fields.some(hasDefault)) {
      return;
    }
    const fields: FunctionDeclaration = {
      kind: 'FunctionDeclaration',
      span: owner.span,
      annotations: [],
      isExtern: false,
      isAsync: false,
      owner: declaration.kind === 'EnumDeclaration' ? declaration.name : undefined,
      name: owner.name,
      typeParameters: declaration.typeParameters,
      parameters: owner.fields.map(fieldParameter),
      returnType: undefined,
      body: undefined,
    };
    made.add(fields);
    return fields;
  });
}

/** The parameter a field reads as. */
function fieldParameter(field: DeclaredField | Invalid): Parameter | Invalid {
  if (field.kind === 'Invalid') {
    return field;
  }
  const { span, name, type, defaultValue } = field;
  return { kind: 'Parameter', span, isRest: false, name, type, defaultValue };
}

function present<T>(value: T | undefined): readonly T[] {
  return value === undefined ? [] : [value];
}
