/**
 * The layout of declared types (§5.2, §5.3, §5.4): a struct's fields, an enum's variants and the
 * value behind a shared struct. An anonymous struct carries its own fields (types/type/index.ts),
 * so its layout is read off the type.
 *
 * A shared struct's fields are its value's, behind the handle that is the struct's value: they are
 * no fields of the struct type itself, so `x.f` and patterns never see them, and `*x` reads them as
 * the shape of those fields (§5.4), the same type as any shape of them.
 *
 * - As declared (`declaredFieldsOf`): field types resolved in the declaring module, in declaration
 *   order, which only evaluation follows: a literal's sources and the defaults, each seeing the
 *   fields before it. Each field is typed alone: a written type needs no default checked, so a
 *   default reading a field by name (`fieldNamed`) reaches that field only, and closes no cycle
 *   through the others. A field that would make the type's instantiation endless reads as the
 *   error type (rules/expansion/types.ts), cut as a layout is read, never inside its entry: the
 *   cut's walk may check a default reading this layout, which then finds it closed.
 * - As laid out (`fieldsOf`): in name order, as every struct's fields are, nominal or shape (§5.2
 *   "Field order", `inFieldOrder`), so positions, the Definition's entry, patterns, codecs and a
 *   struct's conversion into its shape all follow one order.
 * - As instantiated: substituted for a nominal type's arguments, derived on demand from the
 *   declared layout and never stored per instantiation (types/type/index.ts).
 *
 * ProgramChecker composes this unit and answers the layout queries through it.
 */

import type { EntryTable } from '../../../../../foundation/structures/entries/index.ts';
import { sameItems } from '../../../../../foundation/structures/equality.ts';
import { memo } from '../../../../../foundation/structures/memo.ts';
import { fieldsFunctionOf } from '../../../../syntax/declarations/field-defaults.ts';
import type {
  DeclaredField,
  DeclaredStruct,
  EnumDeclaration,
  FunctionDeclaration,
  Variant,
} from '../../../../syntax/declarations/index.ts';
import type { Invalid } from '../../../../syntax/tree/node.ts';
import type { LaidOutField, VariantMember } from '../../../check.ts';
import type { CheckerContext, CheckerNote } from '../../../contexts/context.ts';
import { type FieldedDeclaration, TypeExpansion } from '../../../rules/expansion/types.ts';
import {
  type Substitution,
  substitute,
  substitutionFor,
} from '../../../types/parts/substitution.ts';
import { sameTypeSpelled } from '../../../types/parts/type-parts.ts';
import { unfolded } from '../../../types/type/computed-types.ts';
import { inFieldOrder } from '../../../types/type/field-order.ts';
import {
  type AnonymousStructType,
  type FieldMember,
  type NominalType,
  shapeType,
  type Type,
} from '../../../types/type/index.ts';
import { errorType } from '../../../types/type/primitives.ts';
import type { TypeRules } from '../../../types/type/type-rules.ts';
import { declaredField, validFields } from '../../../types/written/declared-fields.ts';

/** Whether two fields are named, typed and declared alike. */
function sameField(first: FieldMember, second: FieldMember): boolean {
  return (
    first.name === second.name &&
    sameTypeSpelled(first.type, second.type) &&
    (first.declared === second.declared ||
      (first.declared !== undefined &&
        second.declared !== undefined &&
        first.declared.node === second.declared.node &&
        first.declared.module === second.declared.module &&
        sameTypeSpelled(first.declared.type, second.declared.type)))
  );
}

/** Whether two lists of fields name, type and declare their fields alike, in order. */
const sameFields = sameItems<FieldMember>(sameField);

export class Layouts {
  readonly #checker: CheckerContext;
  readonly #fields: EntryTable<CheckerNote, DeclaredStruct, readonly FieldMember[]>;
  readonly #variants: EntryTable<CheckerNote, EnumDeclaration, readonly VariantMember[]>;
  /**
   * Each field typed alone, before the expansion rule may cut it: a written type resolved, or the
   * type its default gives. Reached again while its default is checked, it reads as the error
   * type; the cycle is reported at the defaults (functions/parameters.ts).
   */
  readonly #typed: EntryTable<CheckerNote, DeclaredField, FieldMember, FieldedDeclaration>;
  readonly #expansion: TypeExpansion;
  /** Each struct's declared fields in name order, keyed by the declared list they sort. */
  readonly #laidOut = new WeakMap<readonly FieldMember[], readonly FieldMember[]>();

  constructor(checker: CheckerContext) {
    this.#checker = checker;
    // A layout reached again while its fields' defaults are checked, as when a default builds the
    // struct it belongs to, stands for its fields with those its defaults type read as the error
    // type; the cycle is reported at the defaults (functions/parameters.ts).
    this.#fields = checker.entries.table({
      name: 'declared fields',
      compute: (declaration) => this.#typedFields(declaration, declaration.fields, 'typed'),
      equal: sameFields,
      cyclic: {
        standIn: (declaration) => this.#typedFields(declaration, declaration.fields, 'standing'),
      },
    });
    this.#variants = checker.entries.table({
      name: 'declared variants',
      compute: (declaration) => this.#variantsOf(declaration, 'typed'),
      equal: sameItems(
        (first, second) => first.name === second.name && sameFields(first.fields, second.fields),
      ),
      cyclic: { standIn: (declaration) => this.#variantsOf(declaration, 'standing') },
    });
    this.#typed = checker.entries.table({
      name: 'declared field',
      compute: (field, declaration) => this.#typedAlone(declaration, field, 'typed'),
      equal: sameField,
      cyclic: { standIn: (field, declaration) => this.#typedAlone(declaration, field, 'standing') },
    });
    this.#expansion = new TypeExpansion(checker, this.#typed);
  }

  /**
   * The fields of a struct type, nominal or anonymous, in name order, substituted for its type
   * arguments; undefined for another type, a shared struct included.
   */
  fieldsOf(type: Type): readonly FieldMember[] | undefined {
    if (type.kind === 'anonymous') {
      return type.fields;
    }
    if (type.kind === 'recursive') {
      return this.fieldsOf(unfolded(type));
    }
    if (type.kind !== 'nominal') {
      return undefined;
    }
    const { declaration } = type.entity;
    if (declaration.kind !== 'StructDeclaration') {
      return undefined;
    }
    const typed = this.#fields.get(declaration);
    const laidOut = memo(this.#laidOut, typed, () => inFieldOrder(typed));
    return this.#instantiated(declaration, laidOut, substitutionOf(type));
  }

  /**
   * The field `name` of a struct type, as `fieldsOf` gives it, and its position. Only that field is
   * typed, so a default reading a field whose type is written, or typed already, reaches no other.
   */
  fieldNamed(type: Type, name: string): LaidOutField | undefined {
    if (type.kind === 'recursive') {
      return this.fieldNamed(unfolded(type), name);
    }
    if (type.kind === 'anonymous') {
      return positioned(type.fields, name, (field) => field);
    }
    if (type.kind !== 'nominal' || type.entity.declaration.kind !== 'StructDeclaration') {
      return undefined;
    }
    const { declaration } = type.entity;
    const named = validFields(declaration.fields).map((field) => ({
      name: field.name.text,
      field,
    }));
    return positioned(named, name, ({ field }) =>
      substitutedField(
        this.#cut(declaration, this.#typed.get(field, declaration)),
        substitutionOf(type),
        this.#checker.typeRules,
      ),
    );
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
    const fields = this.#instantiated(
      declaration,
      this.#fields.get(declaration),
      substitutionOf(type),
    );
    return shapeType(declaration, fields);
  }

  /**
   * The shape a value of `type`, a nominal struct, converts into (§5.2): its fields, substituted
   * for its type arguments, as a shape written at its declaration; undefined for another type, or
   * a struct with an annotated field, whose shape would drop what the annotation says.
   */
  nominalShapeOf(type: Type): AnonymousStructType | undefined {
    if (type.kind !== 'nominal' || type.entity.declaration.kind !== 'StructDeclaration') {
      return undefined;
    }
    const fields = this.fieldsOf(type) ?? [];
    const annotated = fields.some((field) => (field.declared?.node.annotations?.length ?? 0) > 0);
    return annotated ? undefined : shapeType(type.entity.declaration, fields);
  }

  /**
   * The variants of an enum type, substituted for its type arguments; undefined for another type.
   */
  variantsOf(type: NominalType): readonly VariantMember[] | undefined {
    const { declaration } = type.entity;
    if (declaration.kind !== 'EnumDeclaration') {
      return undefined;
    }
    const substitution = substitutionOf(type);
    return this.#variants.get(declaration).map((variant) => ({
      name: variant.name,
      fields: this.#instantiated(declaration, variant.fields, substitution),
    }));
  }

  /** A struct's fields as declared, in declaration order, the order evaluation follows. */
  declaredFieldsOf(declaration: DeclaredStruct): readonly FieldMember[] {
    return this.#fields.get(declaration).map((member) => this.#cut(declaration, member));
  }

  declaredVariantsOf(declaration: EnumDeclaration): readonly VariantMember[] {
    return this.#variants.get(declaration).map((variant) => ({
      name: variant.name,
      fields: variant.fields.map((member) => this.#cut(declaration, member)),
    }));
  }

  /** `declaration`'s variants, each with its fields, as `#typedFields` types them. */
  #variantsOf(declaration: EnumDeclaration, typing: Typing): readonly VariantMember[] {
    return declaration.variants.flatMap((variant) =>
      variant.kind === 'Variant'
        ? [
            {
              name: variant.name.text,
              fields: this.#typedFields(declaration, variant.fields, typing),
            },
          ]
        : [],
    );
  }

  /**
   * `fields` of `declaration`, as declared, each typed alone. Standing for a layout reached again,
   * a field its default types reads as an error, so no default is checked.
   */
  #typedFields(
    declaration: FieldedDeclaration,
    fields: readonly (DeclaredField | Invalid)[],
    typing: Typing,
  ): readonly FieldMember[] {
    return validFields(fields).map((field) =>
      typing === 'standing' && field.type === undefined
        ? this.#typedAlone(declaration, field, typing)
        : this.#typed.get(field, declaration),
    );
  }

  /** `fields` of `declaration`, each cut or not (`#cut`), substituted by `substitution`. */
  #instantiated(
    declaration: FieldedDeclaration,
    fields: readonly FieldMember[],
    substitution: Substitution,
  ): readonly FieldMember[] {
    return fields.map((member) =>
      substitutedField(this.#cut(declaration, member), substitution, this.#checker.typeRules),
    );
  }

  /** `member` of `declaration`, as the error type if it would make the instantiation endless. */
  #cut(declaration: FieldedDeclaration, member: FieldMember): FieldMember {
    const field = member.declared?.node;
    const endless = field !== undefined && this.#expansion.isEndless(declaration, field);
    return endless ? { ...member, type: errorType } : member;
  }

  /**
   * `field` of `declaration`, typed as declared, before the expansion rule may cut it; standing, a
   * field its default types reads as an error.
   */
  #typedAlone(declaration: FieldedDeclaration, field: DeclaredField, typing: Typing): FieldMember {
    const { fields, defaults } = fieldsHolding(declaration, field);
    const module = this.#checker.moduleOf(declaration);
    const index = validFields(fields).indexOf(field);
    return declaredField(
      this.#checker,
      module,
      { field, index },
      { defaults: typing === 'typed' ? defaults : undefined },
    );
  }
}

/**
 * How a layout types its fields: as declared, or standing for a layout reached again while its
 * defaults are checked.
 */
type Typing = 'typed' | 'standing';

/** The fields of `declaration` holding `field`, a struct's or a variant's, and their defaults. */
function fieldsHolding(
  declaration: FieldedDeclaration,
  field: DeclaredField,
): {
  readonly fields: readonly (DeclaredField | Invalid)[];
  readonly defaults: FunctionDeclaration | undefined;
} {
  if (declaration.kind !== 'EnumDeclaration') {
    return { fields: declaration.fields, defaults: fieldsFunctionOf(declaration) };
  }
  const variant = declaration.variants.find(
    (each): each is Variant => each.kind === 'Variant' && each.fields.includes(field),
  );
  return {
    fields: variant?.fields ?? [],
    defaults: variant === undefined ? undefined : fieldsFunctionOf(declaration, variant),
  };
}

/** The member `name` names among `named`, in field order, made by `member`, and its position. */
function positioned<Named extends { readonly name: string }>(
  named: readonly Named[],
  name: string,
  member: (found: Named) => FieldMember,
): LaidOutField | undefined {
  const laidOut = inFieldOrder(named);
  const index = laidOut.findIndex((each) => each.name === name);
  const found = laidOut[index];
  return found === undefined ? undefined : { member: member(found), index };
}

/** The type arguments of `type`, by the type parameters of its declaration. */
function substitutionOf(type: NominalType): Substitution {
  return substitutionFor(type.entity.declaration.typeParameters, type.arguments);
}

function substitutedField(
  field: FieldMember,
  substitution: Substitution,
  rules: TypeRules,
): FieldMember {
  return { ...field, type: substitute(field.type, substitution, rules) };
}
