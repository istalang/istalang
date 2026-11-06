/**
 * Type aliases (§3.17) and associated types (§3.1), which are aliases too: each one's type,
 * resolved once in its module, its declaration's own parameters left open for each use to
 * substitute. One reaching itself where it would have to be known first, directly or through
 * others, is reported at each member of the cycle, which then stands for the error type.
 *
 * One naming itself only inside types built from others is recursive (alias-recursion.ts): it
 * stands for the recursive type its group closes to, its parameters given for themselves
 * (recursive-bodies.ts), which a use substitutes as any alias's.
 *
 * One whose body is a type `match` stands for its own unreduced use, its parameters given for
 * themselves: a use reduces it (types/written/type-match.ts `aliasInstance`), so it may refer to
 * itself. Its subject and patterns resolve together, each case's type apart
 * (types/written/type-match.ts).
 */

import type { EntryTable } from '../../../../../structures/entries/index.ts';
import type { ModuleId } from '../../../../program/program.ts';
import {
  type AliasBody,
  type AliasDeclaration,
  type AssociatedType,
  type TypeAliasDeclaration,
  type TypeParameters,
  typeParametersOf,
} from '../../../../syntax/declarations/index.ts';
import { parentOf } from '../../../../syntax/tree.ts';
import type { TypeCase, TypeMatch } from '../../../../syntax/types/index.ts';
import { inferTypesIn } from '../../../../syntax/types/type-matches.ts';
import type { CheckerContext, CheckerNote } from '../../../contexts/context.ts';
import { checkerDiagnostics } from '../../../diagnostics/index.ts';
import { matchCase } from '../../../resolution/type-matches/type-match-patterns.ts';
import { TypeMatchExpansion } from '../../../rules/expansion/type-matches.ts';
import type { MatchType } from '../../../types/computed-types.ts';
import { sameTypeSpelled } from '../../../types/parts/type-parts.ts';
import { resolveConstraintSet } from '../../../types/traits/struct-constraints.ts';
import { isNominalEntity, type Type } from '../../../types/type/index.ts';
import { errorType } from '../../../types/type/primitives.ts';
import { parameterType } from '../../../types/written/resolve-type.ts';
import {
  type CaseForm,
  type CasePatternForm,
  matchUse,
  type TypeMatchForm,
  type TypeMatchQueries,
} from '../../../types/written/type-match.ts';
import { AliasRecursions } from './alias-recursion.ts';
import { RecursiveBodies } from './recursive-bodies.ts';

export class Aliases implements TypeMatchQueries {
  readonly #checker: CheckerContext;
  readonly #moduleOf: (alias: AliasDeclaration) => ModuleId;
  readonly #types: EntryTable<CheckerNote, AliasDeclaration, Type>;
  readonly #matches: EntryTable<CheckerNote, AliasDeclaration, TypeMatchForm | undefined>;
  readonly #caseTypes: EntryTable<CheckerNote, TypeCase, Type, ModuleId>;
  readonly #expansion: TypeMatchExpansion;
  readonly #recursions: AliasRecursions;
  readonly #recursiveBodies: RecursiveBodies;

  /** `moduleOf` answers the module writing each alias, where its type resolves. */
  constructor(checker: CheckerContext, moduleOf: (alias: AliasDeclaration) => ModuleId) {
    this.#checker = checker;
    this.#moduleOf = moduleOf;
    this.#types = checker.entries.table({
      name: 'aliased types',
      compute: (alias) => this.#aliasedType(alias),
      equal: sameTypeSpelled,
      cyclic: {
        standIn: () => errorType,
        reportMember: (member) =>
          checker.report(
            moduleOf(member),
            checkerDiagnostics.aliasCycle(member.name.span, member.name.text),
          ),
      },
    });
    this.#matches = checker.entries.table({
      name: 'type matches',
      compute: (alias) => this.#typeMatch(alias),
    });
    this.#caseTypes = checker.entries.table({
      name: 'type match cases',
      compute: (node, module) => checker.resolveType(module, node.type),
      equal: sameTypeSpelled,
      cyclic: { standIn: () => errorType },
    });
    this.#expansion = new TypeMatchExpansion(checker, this, moduleOf);
    this.#recursions = new AliasRecursions(checker, moduleOf);
    this.#recursiveBodies = new RecursiveBodies(checker, moduleOf, this.#recursions);
  }

  isEndless(alias: AliasDeclaration): boolean {
    return this.#expansion.isEndless(alias);
  }

  aliasedType(alias: AliasDeclaration): Type {
    return this.#types.get(alias);
  }

  /** The subject and cases of `alias`'s type `match` (§3.17); undefined when its body is a type. */
  typeMatchOf(alias: AliasDeclaration): TypeMatchForm | undefined {
    return this.#matches.get(alias);
  }

  /** The type the case `node` of `alias`'s type `match` gives, its variables open. */
  caseTypeOf(alias: AliasDeclaration, node: TypeCase): Type {
    return this.#caseTypes.get(node, this.#moduleOf(alias));
  }

  #aliasedType(alias: AliasDeclaration): Type {
    const body: AliasBody = alias.type;
    if (alias.kind === 'TypeAliasDeclaration') {
      switch (this.#recursions.recursionOf(alias)) {
        case 'recursive':
          return this.#recursiveBodies.closed(alias);
        case 'irregular':
          return errorType;
        default:
          break;
      }
    }
    if (body.kind !== 'TypeMatch') {
      return this.#checker.resolveType(this.#moduleOf(alias), body);
    }
    return this.useOf(alias, typeParametersOf(this.#parametersOf(alias)).map(parameterType));
  }

  #typeMatch(alias: AliasDeclaration): TypeMatchForm | undefined {
    const body: AliasBody = alias.type;
    return body.kind === 'TypeMatch' ? this.#formOf(alias, body) : undefined;
  }

  #formOf(alias: AliasDeclaration, body: TypeMatch): TypeMatchForm {
    const checker = this.#checker;
    const module = this.#moduleOf(alias);
    const parameters = this.#parametersOf(alias);
    const subject = checker.resolveType(module, body.subject);
    const subjectParameter =
      subject.kind === 'parameter' && subject.declaration.kind === 'TypeParameter'
        ? typeParametersOf(parameters).find((each) => each === subject.declaration)
        : undefined;
    const cases = body.cases.flatMap((node): CaseForm[] => {
      if (node.kind !== 'TypeCase') {
        return [];
      }
      const variables = inferTypesIn(node.pattern).map(({ parameter }) => ({
        parameter,
        constraints: resolveConstraintSet(checker, module, parameter.constraints),
      }));
      return [{ node, pattern: this.#patternOf(module, node), variables }];
    });
    return { parameters, subject, subjectParameter, cases };
  }

  #patternOf(module: ModuleId, { pattern }: TypeCase): CasePatternForm {
    switch (pattern.kind) {
      case 'WildcardPattern':
        return { kind: 'any' };
      case 'StructConstraint': {
        const [constraint] = resolveConstraintSet(this.#checker, module, [pattern]).structs;
        return constraint === undefined
          ? { kind: 'type', type: errorType }
          : { kind: 'struct', constraint };
      }
      default:
        return { kind: 'type', type: this.#checker.resolveType(module, pattern) };
    }
  }

  useOf(alias: AliasDeclaration, typeArguments: readonly Type[]): MatchType {
    if (alias.kind === 'TypeAliasDeclaration') {
      return matchUse(alias, typeArguments);
    }
    const owner = this.#ownerOf(alias);
    const name = owner !== undefined && 'name' in owner ? owner.name?.text : undefined;
    const entity =
      name === undefined
        ? undefined
        : this.#checker.bindings.topLevelNamed(this.#moduleOf(alias), name);
    return matchUse(
      alias,
      typeArguments,
      entity?.kind === 'type' && isNominalEntity(entity) ? entity : undefined,
    );
  }

  /**
   * The arguments `alias` is given where it names `type` (§3.17): what its own parameters bind
   * when its type, them open, is matched against `type` as a case's pattern is, unfolding recursive
   * types alike; undefined when it names no such type.
   */
  argumentsFor(alias: TypeAliasDeclaration, type: Type): readonly Type[] | undefined {
    const parameters = typeParametersOf(alias.typeParameters);
    const { outcome, bound } = matchCase(
      this.#checker,
      { kind: 'type', type: this.aliasedType(alias) },
      parameters.map((parameter) => ({ parameter, constraints: { traits: [], structs: [] } })),
      type,
    );
    const typeArguments = parameters.flatMap((parameter) => bound.get(parameter) ?? []);
    return outcome === 'match' && typeArguments.length === parameters.length
      ? typeArguments
      : undefined;
  }

  /** What a use of `alias` gives arguments for: its own parameters, or its declaration's. */
  #parametersOf(alias: AliasDeclaration): TypeParameters {
    if (alias.kind === 'TypeAliasDeclaration') {
      return alias.typeParameters;
    }
    const owner = this.#ownerOf(alias);
    return owner !== undefined && 'typeParameters' in owner ? owner.typeParameters : [];
  }

  /** The declaration an associated type is a part of. */
  #ownerOf(alias: AssociatedType) {
    return parentOf(this.#checker.inputs.treeOf(this.#moduleOf(alias)), alias);
  }
}
