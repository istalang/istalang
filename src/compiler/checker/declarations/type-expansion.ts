/**
 * Generic types that would need endlessly many instantiations (§3.5): `struct W<T>` with a field of
 * type `W<(T,)>?` makes `W<int>`, `W<(int,)>` and so on without end.
 *
 * The expansion graph (types/expansion-edges.ts) takes its edges from fields here: each generic
 * struct or enum a field's type names, at any depth, gives that type's parameters arguments built
 * from the declaring type's own. A field making an expanding edge on a cycle is endless: it is
 * reported at its declaration, and the layout reads its type as the error type (layout.ts), so
 * every walk over types meets finitely many instantiations.
 *
 * Edges are found from fields as written, before any layout is made, so finding them never asks
 * for one. A declaration's edges follow only the generic types its fields reach.
 */

import { memo } from '../../../structures/memo.ts';
import {
  type DeclaredStruct,
  type EnumDeclaration,
  type Field,
  typeParametersOf,
} from '../../syntax/declarations.ts';
import { type ArgumentEdge, argumentEdges, endlessEdges } from '../types/expansion-edges.ts';
import type { FieldMember, ParameterKey } from '../types/type.ts';
import { nominalsIn } from '../types/type-parts.ts';

/** A declaration with fields of its own: a struct's, shared or not, or an enum's variants'. */
export type FieldedDeclaration = DeclaredStruct | EnumDeclaration;

interface FieldEdge extends ArgumentEdge {
  readonly declaration: FieldedDeclaration;
  readonly field: Field;
  /** The generic type the field names, whose own fields the graph follows next. */
  readonly reached: FieldedDeclaration;
}

export class TypeExpansion {
  readonly #writtenFieldsOf: (declaration: FieldedDeclaration) => readonly FieldMember[];
  readonly #edges = new Map<FieldedDeclaration, readonly FieldEdge[]>();
  readonly #endless = new Map<FieldedDeclaration, ReadonlySet<Field>>();

  /** `writtenFieldsOf` gives a declaration's fields, every variant's for an enum, as written. */
  constructor(writtenFieldsOf: (declaration: FieldedDeclaration) => readonly FieldMember[]) {
    this.#writtenFieldsOf = writtenFieldsOf;
  }

  /** The fields of `declaration` that make its instantiation endless. */
  endlessFieldsOf(declaration: FieldedDeclaration): ReadonlySet<Field> {
    return memo(this.#endless, declaration, () => {
      const endless = endlessEdges(this.#reachedFrom(declaration));
      return new Set(
        endless.filter((edge) => edge.declaration === declaration).map((edge) => edge.field),
      );
    });
  }

  /** The edges of `root`'s fields, and of every generic type those edges reach. */
  #reachedFrom(root: FieldedDeclaration): readonly FieldEdge[] {
    const visited = new Set<FieldedDeclaration>();
    const pending = [root];
    const edges: FieldEdge[] = [];
    for (let declaration = pending.pop(); declaration !== undefined; declaration = pending.pop()) {
      if (!visited.has(declaration)) {
        visited.add(declaration);
        const own = this.#edgesOf(declaration);
        edges.push(...own);
        pending.push(...own.map((edge) => edge.reached));
      }
    }
    return edges;
  }

  #edgesOf(declaration: FieldedDeclaration): readonly FieldEdge[] {
    return memo(this.#edges, declaration, () => {
      const own = new Set<ParameterKey>(typeParametersOf(declaration.typeParameters));
      return this.#writtenFieldsOf(declaration).flatMap(({ type, declared }) =>
        declared === undefined
          ? []
          : nominalsIn(type).flatMap(({ entity, arguments: typeArguments }) => {
              const reached = entity.declaration;
              if (reached.kind === 'ExternStructDeclaration') {
                return [];
              }
              return argumentEdges(own, reached.typeParameters, typeArguments).map((edge) => ({
                ...edge,
                declaration,
                field: declared.node,
                reached,
              }));
            }),
      );
    });
  }
}
