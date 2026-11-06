/**
 * Generic types that would need endlessly many instantiations (§3.5): `struct W<T>` with a field of
 * type `W<(T,)>?` makes `W<Int>`, `W<(Int,)>` and so on without end.
 *
 * The expansion graph (edges.ts) takes its edges from fields here: each generic
 * struct or enum a field's type names, at any depth, gives that type's parameters arguments built
 * from the declaring type's own. A field making an expanding edge on a cycle is endless: it is
 * reported where its declaration's layout is made, once, and the layout reads its type as the
 * error type (declarations/layout/index.ts), so every walk over types meets finitely many
 * instantiations.
 *
 * Edges come from fields' written types alone, which resolve without checking any code. A field
 * typed by its default has a type only once the default is checked, which may itself need the
 * layout being made, so it adds no edge.
 */

import type { EntryTable } from '../../../../structures/entries/index.ts';
import { sameItems, sameMembers, sameProperties } from '../../../../structures/equality.ts';
import {
  type DeclaredField,
  type DeclaredStruct,
  type EnumDeclaration,
  typeParametersOf,
} from '../../../syntax/declarations/index.ts';
import type { CheckerContext, CheckerNote } from '../../contexts/context.ts';
import { checkerDiagnostics } from '../../diagnostics/index.ts';
import { nominalsIn } from '../../types/parts/type-parts.ts';
import type { ParameterKey } from '../../types/type/index.ts';
import { type ArgumentEdge, argumentEdges, endlessEdgesFrom } from './edges.ts';

/** A declaration with fields of its own: a struct's, shared or not, or an enum's variants'. */
export type FieldedDeclaration = DeclaredStruct | EnumDeclaration;

interface FieldEdge extends ArgumentEdge {
  readonly declaration: FieldedDeclaration;
  readonly field: DeclaredField;
  /** The generic type the field names, whose own fields the graph follows next. */
  readonly reached: FieldedDeclaration;
}

type ExpansionSeams = Pick<CheckerContext, 'entries' | 'resolveType' | 'moduleOf' | 'report'>;

export class TypeExpansion {
  readonly #checker: ExpansionSeams;
  readonly #edges: EntryTable<CheckerNote, FieldedDeclaration, readonly FieldEdge[]>;
  readonly #endless: EntryTable<CheckerNote, FieldedDeclaration, ReadonlySet<DeclaredField>>;

  constructor(checker: ExpansionSeams) {
    this.#checker = checker;
    this.#edges = checker.entries.table({
      name: 'field edges',
      compute: (declaration) => this.#fieldEdges(declaration),
      equal: sameItems(sameProperties),
    });
    this.#endless = checker.entries.table({
      name: 'endless fields',
      compute: (declaration) => this.#endlessFields(declaration),
      equal: sameMembers,
    });
  }

  /** The fields of `declaration` that make its instantiation endless, reported once. */
  endlessFieldsOf(declaration: FieldedDeclaration): ReadonlySet<DeclaredField> {
    return this.#endless.get(declaration);
  }

  #endlessFields(declaration: FieldedDeclaration): ReadonlySet<DeclaredField> {
    const endless = new Set(
      endlessEdgesFrom(
        [declaration],
        (each) => this.#edges.get(each),
        (edge) => edge.reached,
      )
        .filter((edge) => edge.declaration === declaration)
        .map((edge) => edge.field),
    );
    const module = this.#checker.moduleOf(declaration);
    for (const field of endless) {
      this.#checker.report(
        module,
        checkerDiagnostics.expandingType(field.name.span, declaration.name.text, field.name.text),
      );
    }
    return endless;
  }

  #fieldEdges(declaration: FieldedDeclaration): readonly FieldEdge[] {
    const own = new Set<ParameterKey>(typeParametersOf(declaration.typeParameters));
    const module = this.#checker.moduleOf(declaration);
    return writtenFieldsOf(declaration).flatMap((field) =>
      field.type === undefined
        ? []
        : nominalsIn(this.#checker.resolveType(module, field.type)).flatMap(
            ({ entity, arguments: typeArguments }) => {
              const reached = entity.declaration;
              if (reached.kind === 'ExternStructDeclaration') {
                return [];
              }
              return argumentEdges(own, reached.typeParameters, typeArguments).map((edge) => ({
                ...edge,
                declaration,
                field,
                reached,
              }));
            },
          ),
    );
  }
}

/** The fields `declaration` declares: a struct's, or every variant's of an enum. */
function writtenFieldsOf(declaration: FieldedDeclaration): readonly DeclaredField[] {
  const fields =
    declaration.kind === 'EnumDeclaration'
      ? declaration.variants.flatMap((variant) =>
          variant.kind === 'Variant' ? variant.fields : [],
        )
      : declaration.fields;
  return fields.filter((field) => field.kind === 'DeclaredField');
}
