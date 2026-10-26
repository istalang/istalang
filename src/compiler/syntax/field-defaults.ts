/**
 * Field defaults (§3.1): the fields of a struct's or a variant's declaration that has a default
 * read as the parameters of a function of their own (`fieldsFunctionOf`), each with its type and
 * default, so every phase takes a field's default as it takes a parameter's (§3.3): a default sees
 * the fields before it, a field without a written type takes its default's, and a default that
 * reaches its own fields is a cycle, reported once. The function is called by no name: a literal
 * leaving field `i` out calls its entry of arity `i`, which gives that field's value from the
 * fields before it, as a defaults entry would give its parameter's.
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

const functions = new WeakMap<FieldsOwner, FunctionDeclaration | undefined>();

const owners = new WeakSet<FunctionDeclaration>();

/**
 * The function whose parameters are the fields of a struct, or of an enum's `variant`; undefined
 * when none of them has a default.
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
  return memo(functions, owner, () => {
    const hasDefault = owner.fields.some(
      (field) => field.kind === 'FieldDeclaration' && field.defaultValue !== undefined,
    );
    if (!hasDefault) {
      return;
    }
    const declared: FunctionDeclaration = {
      kind: 'FunctionDeclaration',
      span: owner.span,
      annotations: [],
      isExtern: false,
      isAsync: false,
      owner: undefined,
      name: owner.name,
      typeParameters: declaration.typeParameters,
      parameters: owner.fields.map(parameterOf),
      returnType: undefined,
      body: undefined,
    };
    owners.add(declared);
    return declared;
  });
}

/** The functions the fields of `item`, a struct or the variants of an enum, read as. */
export function fieldsFunctionsIn(item: Declaration): readonly FunctionDeclaration[] {
  switch (item.kind) {
    case 'StructDeclaration': {
      const declared = fieldsFunctionOf(item);
      return declared === undefined ? [] : [declared];
    }
    case 'EnumDeclaration':
      return item.variants.flatMap((variant) => {
        const declared = variant.kind === 'Variant' ? fieldsFunctionOf(item, variant) : undefined;
        return declared === undefined ? [] : [declared];
      });
    default:
      return [];
  }
}

/** Whether `declaration` is the function a declaration's fields with defaults read as. */
export function isFieldsFunction(declaration: FunctionDeclaration): boolean {
  return owners.has(declaration);
}

function parameterOf(field: DeclaredField | Invalid): Parameter | Invalid {
  if (field.kind === 'Invalid') {
    return field;
  }
  const { span, name, type, defaultValue } = field;
  return { kind: 'Parameter', span, isRest: false, name, type, defaultValue };
}
