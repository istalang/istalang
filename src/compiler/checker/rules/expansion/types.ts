/**
 * Generic types that would need endlessly many instantiations (§3.5): `struct W<T>` with a field of
 * type `W<(T,)>?` makes `W<Int>`, `W<(Int,)>` and so on without end.
 *
 * The expansion graph (edges.ts) takes its edges from fields here: each generic struct or enum a
 * field's type names, at any depth, gives that type's parameters arguments built from the declaring
 * type's own. A field cut from the graph is reported where its declaration's layout is made, once,
 * and the layout reads its type as the error type (constructs/declarations/layout/index.ts), so
 * every walk over types meets finitely many instantiations.
 *
 * Fields are cut in two strata, so that whether a field is cut never depends on code that reads it:
 * - A field whose type is written is cut when it makes an expanding edge on a cycle of written
 *   fields: its type and its cut are known without checking any code, and a default may read it.
 * - A field typed by its default has its type once the default is checked, which may read written
 *   fields' layouts. With its edges added to what the first stratum leaves, it is cut when it lies
 *   on a cycle that grows, whichever field on the cycle expands: the cycle ends at it.
 */

import type { EntryTable } from '../../../../foundation/structures/entries/index.ts';
import {
  sameItems,
  sameMembers,
  sameProperties,
} from '../../../../foundation/structures/equality.ts';
import type { ModuleId } from '../../../program/program.ts';
import {
  type DeclaredField,
  type DeclaredStruct,
  type EnumDeclaration,
  type Field,
  typeParametersOf,
} from '../../../syntax/declarations/index.ts';
import type { CheckerContext, CheckerNote } from '../../contexts/context.ts';
import { checkerDiagnostics } from '../../diagnostics/index.ts';
import { nominalsIn } from '../../types/parts/type-parts.ts';
import type { ParameterKey, Type } from '../../types/type/index.ts';
import { type ArgumentEdge, argumentEdges, endlessEdgesFrom, growingEdgesFrom } from './edges.ts';

/** A declaration with fields of its own: a struct's, shared or not, or an enum's variants'. */
export type FieldedDeclaration = DeclaredStruct | EnumDeclaration;

interface FieldEdge extends ArgumentEdge {
  readonly declaration: FieldedDeclaration;
  readonly field: DeclaredField;
  /** The generic type the field names, whose own fields the graph follows next. */
  readonly reached: FieldedDeclaration;
}

type ExpansionSeams = Pick<CheckerContext, 'entries' | 'resolveType' | 'moduleOf' | 'report'>;

/** The type a field typed by its default takes from it, checking the default (layout/index.ts). */
type DefaultedType = (declaration: FieldedDeclaration, field: DeclaredField) => Type;

const sameEdges = sameItems<FieldEdge>(sameProperties);

export class TypeExpansion {
  readonly #checker: ExpansionSeams;
  readonly #defaultedType: DefaultedType;
  /** Each declaration's edges from the fields whose types are written. */
  readonly #writtenEdges: EntryTable<CheckerNote, FieldedDeclaration, readonly FieldEdge[]>;
  /** The written fields each declaration cuts: the first stratum. */
  readonly #endless: EntryTable<CheckerNote, FieldedDeclaration, ReadonlySet<DeclaredField>>;
  /**
   * Each declaration's edges from the fields typed by their defaults; none while a default being
   * checked reaches them again, which its parameters report (functions/parameters.ts).
   */
  readonly #defaultedEdges: EntryTable<CheckerNote, FieldedDeclaration, readonly FieldEdge[]>;
  /**
   * Whether a field typed by its default is cut: the second stratum. Each field walks from its own
   * edges, so whether it lies on a cycle reads no default but those on the cycles it may close.
   */
  readonly #cut: EntryTable<CheckerNote, DeclaredField, boolean, FieldedDeclaration>;

  constructor(checker: ExpansionSeams, defaultedType: DefaultedType) {
    this.#checker = checker;
    this.#defaultedType = defaultedType;
    this.#writtenEdges = checker.entries.table({
      name: 'field edges',
      compute: (declaration) =>
        this.#edgesOf(declaration, writtenFieldsOf(declaration), (field, module) =>
          field.type === undefined ? undefined : checker.resolveType(module, field.type),
        ),
      equal: sameEdges,
    });
    this.#endless = checker.entries.table({
      name: 'endless fields',
      compute: (declaration) =>
        this.#reported(
          declaration,
          endlessEdgesFrom([declaration], (each) => this.#writtenEdges.get(each), reachedBy),
        ),
      equal: sameMembers,
    });
    this.#defaultedEdges = checker.entries.table({
      name: 'defaulted field edges',
      compute: (declaration) =>
        this.#edgesOf(declaration, defaultedFieldsOf(declaration), (field) =>
          this.#defaultedType(declaration, field),
        ),
      equal: sameEdges,
      cyclic: { standIn: () => [] },
    });
    this.#cut = checker.entries.table({
      name: 'cut defaulted field',
      compute: (field, declaration) => this.#cutField(declaration, field),
      cyclic: { standIn: () => false },
    });
  }

  /** Whether `field` of `declaration` is cut from the graph, which reports it once. */
  isEndless(declaration: FieldedDeclaration, field: Field): boolean {
    if (field.kind !== 'DeclaredField') {
      return false;
    }
    return field.type === undefined
      ? this.#cut.get(field, declaration)
      : this.#endless.get(declaration).has(field);
  }

  /** Whether `field`, typed by its default, lies on a cycle that grows; reported once if so. */
  #cutField(declaration: FieldedDeclaration, field: DeclaredField): boolean {
    const own = this.#edgesOf(declaration, [field], () => this.#defaultedType(declaration, field));
    const edgesOf = (node: FieldedDeclaration | DeclaredField) =>
      node.kind === 'DeclaredField' ? own : this.#strataEdges(node);
    const cut = growingEdgesFrom([field], edgesOf, reachedBy).some((edge) => edge.field === field);
    if (cut) {
      this.#reported(declaration, own);
    }
    return cut;
  }

  /** The edges the second stratum reads: what the first leaves, and the defaulted fields'. */
  #strataEdges(declaration: FieldedDeclaration): readonly FieldEdge[] {
    const endless = this.#endless.get(declaration);
    return [
      ...this.#writtenEdges.get(declaration).filter(({ field }) => !endless.has(field)),
      ...this.#defaultedEdges.get(declaration),
    ];
  }

  /** The fields of `declaration` among `edges`, each reported. */
  #reported(
    declaration: FieldedDeclaration,
    edges: readonly FieldEdge[],
  ): ReadonlySet<DeclaredField> {
    const fields = new Set(
      edges.filter((edge) => edge.declaration === declaration).map((edge) => edge.field),
    );
    const module = this.#checker.moduleOf(declaration);
    for (const field of fields) {
      this.#checker.report(
        module,
        checkerDiagnostics.expandingType(field.name.span, declaration.name.text, field.name.text),
      );
    }
    return fields;
  }

  /** The edges `fields` of `declaration` make, each typed by `typeOf`. */
  #edgesOf(
    declaration: FieldedDeclaration,
    fields: readonly DeclaredField[],
    typeOf: (field: DeclaredField, module: ModuleId) => Type | undefined,
  ): readonly FieldEdge[] {
    const own = new Set<ParameterKey>(typeParametersOf(declaration.typeParameters));
    const module = this.#checker.moduleOf(declaration);
    return fields.flatMap((field) => {
      const type = typeOf(field, module);
      return type === undefined
        ? []
        : nominalsIn(type).flatMap(({ entity, arguments: typeArguments }) => {
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
          });
    });
  }
}

function reachedBy(edge: FieldEdge): FieldedDeclaration {
  return edge.reached;
}

/** The fields `declaration` declares: a struct's, or every variant's of an enum. */
function declaredFieldsOf(declaration: FieldedDeclaration): readonly DeclaredField[] {
  const fields =
    declaration.kind === 'EnumDeclaration'
      ? declaration.variants.flatMap((variant) =>
          variant.kind === 'Variant' ? variant.fields : [],
        )
      : declaration.fields;
  return fields.filter((field) => field.kind === 'DeclaredField');
}

function writtenFieldsOf(declaration: FieldedDeclaration): readonly DeclaredField[] {
  return declaredFieldsOf(declaration).filter((field) => field.type !== undefined);
}

function defaultedFieldsOf(declaration: FieldedDeclaration): readonly DeclaredField[] {
  return declaredFieldsOf(declaration).filter((field) => field.type === undefined);
}
