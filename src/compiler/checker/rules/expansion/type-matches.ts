/**
 * Type `match` aliases whose reductions would never end (§3.5, §3.17): `type W<T> = match T:` with
 * `case _: W<Array<T>>` reduces `W<Int>` to `W<Array<Int>>`, and so on without end.
 *
 * The expansion graph (edges.ts) takes its edges from cases' types here, as it
 * takes a generic type's from its fields (types.ts): each use of a type `match` alias in a
 * case's type gives that alias's parameters arguments built from the declaring alias's own. An
 * argument is measured against the subject its case matched:
 * - an `infer` variable is a part of the subject, so it counts as the parameters the part of the
 *   subject it was bound in is built from (a tuple subject's element, or the whole subject);
 * - an argument rebuilding what the case's pattern matched (`Node<T>` from `case Node<infer T>`)
 *   is that subject again, so `Data<Node<T>>` is a finite recursion, not a bigger argument;
 * - a part of a parameter (`D[F]`, `D.Data`, `keyof D`) counts as the whole of it.
 * None of these is bigger than what it is taken from; anything built around one is. A case's type
 * resolves with the uses in it left unreduced (types/written/type-match.ts), so the graph is read without
 * reducing anything.
 *
 * The verdict is like any judged by the expansion graph: by the uses written, whichever case a
 * subject would pick, as a generic function calling itself is judged by its calls.
 */

import type { EntryTable } from '../../../../structures/entries/index.ts';
import { sameItems, sameProperties } from '../../../../structures/equality.ts';
import type { ModuleId } from '../../../program/program.ts';
import {
  type AliasDeclaration,
  type TypeParameter,
  typeParametersOf,
} from '../../../syntax/declarations.ts';
import type { CheckerContext, CheckerNote } from '../../context.ts';
import { checkerDiagnostics } from '../../diagnostics/index.ts';
import { sameType } from '../../types/identity/identity.ts';
import { typeChildren } from '../../types/parts/type-children.ts';
import { parametersIn } from '../../types/parts/type-parts.ts';
import type { ParameterKey, Type } from '../../types/type/index.ts';
import type {
  CasePatternForm,
  InferVariable,
  TypeMatchQueries,
} from '../../types/written/type-match.ts';
import { type ArgumentEdge, endlessEdgesFrom } from './edges.ts';

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
  return form.cases.flatMap(({ node, pattern, variables }) => {
    const reading = caseReading(own, form.subject, pattern, variables);
    return usesIn(matches.caseTypeOf(alias, node)).flatMap((use) => {
      const reached = use.declaration;
      const parameters = typeParametersOf(matches.typeMatchOf(reached)?.parameters ?? []);
      return parameters.flatMap((to, index) => {
        const argument = use.arguments[index];
        return argument === undefined
          ? []
          : partsOf(argument, reading, true).map(({ from, whole }) => ({
              from,
              to,
              expanding: !whole,
              declaration: alias,
              reached,
            }));
      });
    });
  });
}

/** What a case's pattern matched of the subject: the parts it rebuilds, and its variables' sources. */
interface CaseReading {
  readonly own: ReadonlySet<ParameterKey>;
  /** Each type the pattern matched, the whole of it or a tuple subject's element, with that subject. */
  readonly rebuilt: readonly Matched[];
  /** The declaring alias's parameters the part of the subject an `infer` variable was bound in is built from. */
  readonly sources: ReadonlyMap<ParameterKey, readonly TypeParameter[]>;
}

interface Matched {
  readonly pattern: Type;
  readonly subject: Type;
}

/** A type parameter an argument is built from, and whether the argument is no bigger than it. */
interface ArgumentPart {
  readonly from: TypeParameter;
  readonly whole: boolean;
}

function caseReading(
  own: ReadonlySet<ParameterKey>,
  subject: Type,
  pattern: CasePatternForm,
  variables: readonly InferVariable[],
): CaseReading {
  const rebuilt = pattern.kind === 'type' ? matchedParts(pattern.type, subject) : [];
  const ownIn = (type: Type) =>
    parametersIn(type).filter((each): each is TypeParameter => own.has(each));
  const sources = new Map<ParameterKey, readonly TypeParameter[]>(
    variables.map(({ parameter }) => {
      const innermost = rebuilt.findLast((each) => parametersIn(each.pattern).includes(parameter));
      return [parameter, ownIn(innermost?.subject ?? subject)];
    }),
  );
  return { own, rebuilt, sources };
}

/** `pattern` matched against `subject`, then, for a tuple subject, each element against its own. */
function matchedParts(pattern: Type, subject: Type): readonly Matched[] {
  const elements =
    pattern.kind === 'tuple' &&
    subject.kind === 'tuple' &&
    pattern.elements.length === subject.elements.length
      ? pattern.elements.flatMap((element, index) =>
          matchedParts(element, subject.elements[index] ?? element),
        )
      : [];
  return [{ pattern, subject }, ...elements];
}

/**
 * The declaring alias's parameters `argument` is built from, measured against the subject (the
 * banner): `whole` while nothing is built around the part read so far.
 */
function partsOf(argument: Type, reading: CaseReading, whole: boolean): readonly ArgumentPart[] {
  const matched = reading.rebuilt.find((each) => sameType(each.pattern, argument));
  if (matched !== undefined && matched.subject !== argument) {
    return partsOf(matched.subject, reading, whole);
  }
  switch (argument.kind) {
    case 'parameter': {
      const { declaration } = argument;
      const from = reading.own.has(declaration)
        ? [declaration as TypeParameter]
        : (reading.sources.get(declaration) ?? []);
      return from.map((each) => ({ from: each, whole }));
    }
    case 'field':
    case 'associated':
    case 'keys':
      return partsOf(argument.of, reading, whole);
    default:
      return typeChildren(argument).flatMap((child) => partsOf(child, reading, false));
  }
}

/** The uses of type `match` aliases `type` is or is built from, outermost first. */
function usesIn(type: Type): readonly Extract<Type, { readonly kind: 'match' }>[] {
  const inner = typeChildren(type).flatMap(usesIn);
  return type.kind === 'match' ? [type, ...inner] : inner;
}
