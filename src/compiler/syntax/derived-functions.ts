/**
 * Function declarations derived from the fields of a struct or a variant, which every phase reads
 * as it reads a written one, so they need no rule of their own where they are checked or lowered.
 * Each is made once from its declaration's own nodes, and is known as derived
 * (`isFieldsFunction`).
 *
 * The fields of a struct or a variant, when one has a default (§3.1), read as the parameters of a
 * function of their own, each with its type and default, so a field's default is taken as a
 * parameter's (§3.3): it sees the fields before it, a field without a written type takes its
 * default's, and a default reaching its own field is a cycle. Its parameters are the fields in
 * order, so a layout's field `i` is its parameter `i`. It is called by no name: a literal leaving
 * field `i` out calls its entry of arity `i`, which gives that field's value from the fields
 * before it.
 */

import { memo } from '../../structures/memo.ts';
import type {
  Declaration,
  DeclaredField,
  EnumDeclaration,
  FunctionDeclaration,
  StructDeclaration,
  Variant,
} from './declarations.ts';
import type { Parameter } from './expressions.ts';
import type { Invalid } from './node.ts';

/** A declaration whose fields may have defaults: a struct, or one variant of an enum. */
type FieldsOwner = StructDeclaration | Variant;

const fieldsFunctions = new WeakMap<FieldsOwner, FunctionDeclaration | undefined>();

const derived = new WeakSet<FunctionDeclaration>();

/** Every function `item` derives: those a struct's or its variants' fields read as. */
export function derivedFunctionsOf(item: Declaration): readonly FunctionDeclaration[] {
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
  return derived.has(declaration);
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
    const hasDefault = owner.fields.some(
      (field) => field.kind === 'FieldDeclaration' && field.defaultValue !== undefined,
    );
    if (!hasDefault) {
      return;
    }
    const fields: FunctionDeclaration = {
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
      body: undefined,
    };
    derived.add(fields);
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
