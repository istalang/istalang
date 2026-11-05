/**
 * Type `match` aliases whose reductions would never end (§3.5, §3.17): `type W<T> = match T:` with
 * `case _: W<Array<T>>` reduces `W<Int>` to `W<Array<Int>>`, and so on without end.
 *
 * The expansion graph (types/expansion-edges.ts) takes its edges from cases' types here, as it
 * takes a generic type's from its fields (type-expansion.ts): each use of a type `match` alias in a
 * case's type gives that alias's parameters arguments built from the declaring alias's own. An
 * `infer` variable stands for a part of the subject, so it counts as each parameter the subject is
 * built from, and a part of a parameter (`D[F]`, `D.Data`, `keyof D`) counts as the whole of it:
 * neither is bigger than what it is taken from. A case's type resolves with the uses in it left
 * unreduced (types/type-match.ts), so the graph is read without reducing anything.
 *
 * The verdict is like any judged by the expansion graph: by the uses written, whichever case a
 * subject would pick, as a generic function calling itself is judged by its calls.
 */

import type { EntryTable } from '../../../structures/entries/index.ts';
import { sameItems, sameProperties } from '../../../structures/equality.ts';
import type { ModuleId } from '../../program/program.ts';
import {
  type AliasDeclaration,
  type TypeParameter,
  typeParametersOf,
} from '../../syntax/declarations.ts';
import type { CheckerContext, CheckerNote } from '../context.ts';
import { checkerDiagnostics } from '../diagnostics/index.ts';
import { type ArgumentEdge, endlessEdgesFrom } from '../types/expansion-edges.ts';
import type { ParameterKey, Type } from '../types/type.ts';
import type { TypeMatchQueries } from '../types/type-match.ts';
import { parametersIn, typeChildren } from '../types/type-parts.ts';

interface ReductionEdge extends ArgumentEdge {
  readonly declaration: AliasDeclaration;
  /** The type `match` alias the use reduces next, whose own cases the graph follows. */
  readonly reached: AliasDeclaration;
}

type ExpansionSeams = Pick<CheckerContext, 'entries' | 'report'>;

export class TypeMatchExpansion {
  readonly #edges: EntryTable<CheckerNote, AliasDeclaration, readonly ReductionEdge[]>;
  readonly #endless: EntryTable<CheckerNote, AliasDeclaration, boolean>;

  constructor(
    checker: ExpansionSeams,
    matches: Pick<TypeMatchQueries, 'typeMatchOf' | 'caseTypeOf'>,
    moduleOf: (alias: AliasDeclaration) => ModuleId,
  ) {
    this.#edges = checker.entries.table({
      name: 'type match edges',
      compute: (alias) => reductionEdges(matches, alias),
      equal: sameItems(sameProperties),
    });
    this.#endless = checker.entries.table({
      name: 'endless type matches',
      // A case's type may reduce a use of the alias its graph is being read from, which takes the
      // alias as ending; a use never ending is still cut short (resolution/type-matches.ts).
      cyclic: { standIn: () => false },
      compute: (alias) => {
        const endless = endlessEdgesFrom(
          [alias],
          (each) => this.#edges.get(each),
          (edge) => edge.reached,
        ).some((edge) => edge.declaration === alias);
        if (endless) {
          checker.report(
            moduleOf(alias),
            checkerDiagnostics.endlessTypeMatch(alias.name.span, alias.name.text),
          );
        }
        return endless;
      },
    });
  }

  /** Whether `alias`'s reductions never end, reported once at it. */
  isEndless(alias: AliasDeclaration): boolean {
    return this.#endless.get(alias);
  }
}

/** The edges the uses in `alias`'s cases' types make (the banner). */
function reductionEdges(
  matches: Pick<TypeMatchQueries, 'typeMatchOf' | 'caseTypeOf'>,
  alias: AliasDeclaration,
): readonly ReductionEdge[] {
  const form = matches.typeMatchOf(alias);
  if (form === undefined) {
    return [];
  }
  const own = new Set<ParameterKey>(typeParametersOf(form.parameters));
  const subjectParts = parametersIn(form.subject).filter((each): each is TypeParameter =>
    own.has(each),
  );
  return form.cases.flatMap(({ node, variables }) => {
    const sources = new Map<ParameterKey, readonly TypeParameter[]>(
      variables.map(({ parameter }) => [parameter, subjectParts]),
    );
    return usesIn(matches.caseTypeOf(alias, node)).flatMap((use) => {
      const reached = use.declaration;
      const parameters = typeParametersOf(matches.typeMatchOf(reached)?.parameters ?? []);
      return parameters.flatMap((to, index) => {
        const argument = use.arguments[index];
        return argument === undefined
          ? []
          : parametersIn(argument).flatMap((part) =>
              (own.has(part) ? [part as TypeParameter] : (sources.get(part) ?? [])).map((from) => ({
                from,
                to,
                expanding: !isWholeOf(argument, part),
                declaration: alias,
                reached,
              })),
            );
      });
    });
  });
}

/** The uses of type `match` aliases `type` is or is built from, outermost first. */
function usesIn(type: Type): readonly Extract<Type, { readonly kind: 'match' }>[] {
  const inner = typeChildren(type).flatMap(usesIn);
  return type.kind === 'match' ? [type, ...inner] : inner;
}

/** Whether `argument` is the parameter `part` itself, or a part of it no bigger (the banner). */
function isWholeOf(argument: Type, part: ParameterKey): boolean {
  switch (argument.kind) {
    case 'parameter':
      return argument.declaration === part;
    case 'field':
    case 'associated':
    case 'keys':
      return isWholeOf(argument.of, part);
    default:
      return false;
  }
}
