/**
 * The layout of declared types (§3.1, §3.11, §3.18): a struct's fields, an enum's variants and
 * the value behind a shared struct. An anonymous struct carries its own fields (types/type.ts), so
 * its layout is read off the type.
 *
 * A shared struct's fields are its value's, behind the handle that is the struct's value: they are
 * no fields of the struct type itself, so `x.f` and patterns never see them, and `*x` reads them as
 * an anonymous struct of its own, the one value type of that declaration.
 *
 * - As declared: field types resolved in the declaring module, once per declaration; a field that
 *   would make the type's instantiation endless reads as the error type (type-expansion.ts).
 * - As instantiated: substituted for a nominal type's arguments, derived on demand from the
 *   declared layout and never stored per instantiation (types/type.ts).
 *
 * ProgramChecker composes this unit and answers the layout queries through it.
 */

import { memo } from '../../../structures/memo.ts';
import type { DeclaredStruct, EnumDeclaration, Field } from '../../syntax/declarations.ts';
import { fieldsFunctionOf } from '../../syntax/field-defaults.ts';
import type { VariantMember } from '../check.ts';
import type { CheckerContext } from '../context.ts';
import { declaredFields } from '../types/resolve-type.ts';
import { type Substitution, substitute, substitutionFor } from '../types/substitution.ts';
import {
  type AnonymousStructType,
  errorType,
  type FieldMember,
  type NominalType,
  type Type,
} from '../types/type.ts';
import { type FieldedDeclaration, TypeExpansion } from './type-expansion.ts';

export class Layouts {
  readonly #checker: CheckerContext;
  readonly #fields = new Map<DeclaredStruct, readonly FieldMember[]>();
  readonly #variants = new Map<EnumDeclaration, readonly VariantMember[]>();
  readonly #expansion: TypeExpansion;

  constructor(checker: CheckerContext) {
    this.#checker = checker;
    this.#expansion = new TypeExpansion(checker);
  }

  /**
   * The fields of a struct type, nominal or anonymous, substituted for its type arguments;
   * undefined for another type, a shared struct included.
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

  /**
   * The value behind a shared struct, `*x`, substituted for its type arguments; undefined for
   * another type.
   */
  sharedValueOf(type: Type): AnonymousStructType | undefined {
    if (type.kind !== 'nominal') {
      return undefined;
    }
    const { declaration } = type.entity;
    if (declaration.kind !== 'SharedStructDeclaration') {
      return undefined;
    }
    const fields = instantiated(this.declaredFieldsOf(declaration), substitutionOf(type));
    return { kind: 'anonymous', origin: declaration, arguments: type.arguments, fields };
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

  declaredFieldsOf(declaration: DeclaredStruct): readonly FieldMember[] {
    return memo(this.#fields, declaration, () =>
      this.#ended(
        declaration,
        declaredFields(
          this.#checker,
          this.#checker.moduleOf(declaration),
          declaration.fields,
          fieldsFunctionOf(declaration),
        ),
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
                fields: this.#ended(
                  declaration,
                  declaredFields(
                    this.#checker,
                    this.#checker.moduleOf(declaration),
                    variant.fields,
                    fieldsFunctionOf(declaration, variant),
                  ),
                ),
              },
            ]
          : [],
      ),
    );
  }

  /** `fields` of `declaration`, each that would make its instantiation endless read as an error. */
  #ended(declaration: FieldedDeclaration, fields: readonly FieldMember[]): readonly FieldMember[] {
    const endless: ReadonlySet<Field> = this.#expansion.endlessFieldsOf(declaration);
    return fields.map((field) =>
      field.declared !== undefined && endless.has(field.declared.node)
        ? { ...field, type: errorType }
        : field,
    );
  }
}

/** The type arguments of `type`, by the type parameters of its declaration. */
function substitutionOf(type: NominalType): Substitution {
  return substitutionFor(type.entity.declaration.typeParameters, type.arguments);
}

function instantiated(
  fields: readonly FieldMember[],
  substitution: Substitution,
): readonly FieldMember[] {
  return fields.map((field) => ({ ...field, type: substitute(field.type, substitution) }));
}
