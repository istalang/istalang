/**
 * The layout of declared types (§3.1, §3.11, §3.18): a struct's fields, an enum's variants and
 * what a handle's cell holds. An anonymous struct carries its own fields (types/type.ts), so its
 * layout is read off the type.
 *
 * - As declared: field types resolved in the declaring module, once per declaration.
 * - As instantiated: substituted for a nominal type's arguments, derived on demand from the
 *   declared layout and never stored per instantiation (types/type.ts).
 *
 * ProgramChecker composes this unit and answers the layout queries through it.
 */

import { memo } from '../../../structures/memo.ts';
import type { EnumDeclaration, StructDeclaration } from '../../syntax/declarations.ts';
import { fieldsFunctionOf } from '../../syntax/derived-functions.ts';
import type { VariantMember } from '../check.ts';
import type { CheckerContext } from '../context.ts';
import { declaredFields } from '../types/resolve-type.ts';
import {
  errorType,
  type FieldMember,
  type NominalType,
  type Substitution,
  substitute,
  type Type,
} from '../types/type.ts';

export class Layouts {
  readonly #checker: CheckerContext;
  readonly #fields = new Map<StructDeclaration, readonly FieldMember[]>();
  readonly #variants = new Map<EnumDeclaration, readonly VariantMember[]>();

  constructor(checker: CheckerContext) {
    this.#checker = checker;
  }

  /**
   * The fields of a struct type, nominal or anonymous, substituted for its type arguments;
   * undefined for another type.
   */
  fieldsOf(type: Type): readonly FieldMember[] | undefined {
    if (type.kind === 'anonymous') {
      return type.fields;
    }
    if (type.kind !== 'nominal') {
      return undefined;
    }
    const { declaration } = type.entity;
    return declaration.kind === 'StructDeclaration'
      ? instantiated(this.declaredFieldsOf(declaration), substitutionOf(type))
      : undefined;
  }

  /** What a handle's cell holds, substituted for its type arguments; undefined for another type. */
  stateOf(type: NominalType): Type | undefined {
    const { declaration } = type.entity;
    if (declaration.kind !== 'HandleDeclaration') {
      return undefined;
    }
    const checker = this.#checker;
    const state = checker.resolveType(checker.moduleOf(declaration), declaration.state);
    return substitute(state, substitutionOf(type));
  }

  /** The variants of an enum type, substituted for its type arguments; undefined for another type. */
  variantsOf(type: NominalType): readonly VariantMember[] | undefined {
    const { declaration } = type.entity;
    if (declaration.kind !== 'EnumDeclaration') {
      return undefined;
    }
    const substitution = substitutionOf(type);
    return this.declaredVariantsOf(declaration).map((variant) => ({
      name: variant.name,
      fields: instantiated(variant.fields, substitution),
    }));
  }

  declaredFieldsOf(declaration: StructDeclaration): readonly FieldMember[] {
    return memo(this.#fields, declaration, () =>
      declaredFields(
        this.#checker,
        this.#checker.moduleOf(declaration),
        declaration.fields,
        fieldsFunctionOf(declaration),
      ),
    );
  }

  declaredVariantsOf(declaration: EnumDeclaration): readonly VariantMember[] {
    return memo(this.#variants, declaration, () =>
      declaration.variants.flatMap((variant) =>
        variant.kind === 'Variant'
          ? [
              {
                name: variant.name.text,
                fields: declaredFields(
                  this.#checker,
                  this.#checker.moduleOf(declaration),
                  variant.fields,
                  fieldsFunctionOf(declaration, variant),
                ),
              },
            ]
          : [],
      ),
    );
  }
}

/** The type arguments of `type`, by the type parameters of its declaration. */
function substitutionOf(type: NominalType): Substitution {
  const parameters = type.entity.declaration.typeParameters.filter(
    (parameter) => parameter.kind === 'TypeParameter',
  );
  return new Map(
    parameters.map((parameter, index) => [parameter, type.arguments[index] ?? errorType]),
  );
}

function instantiated(
  fields: readonly FieldMember[],
  substitution: Substitution,
): readonly FieldMember[] {
  return fields.map((field) => ({ ...field, type: substitute(field.type, substitution) }));
}
