/**
 * Type aliases (§3.17) and associated types (§3.1), which are aliases too: each one's type,
 * resolved once in its module, its declaration's own parameters left open for each use to
 * substitute. One reaching itself, directly or through others, is reported at each member of the
 * cycle, which then stands for the error type.
 *
 * One whose body is a type `match` stands for its own unreduced use, its parameters given for
 * themselves: a use reduces it (types/type-match.ts `aliasInstance`), so it may refer to itself.
 * Its subject and patterns resolve together, each case's type apart (types/type-match.ts).
 */

import type { EntryTable } from '../../../structures/entries/index.ts';
import type { ModuleId } from '../../program/program.ts';
import {
  type AliasBody,
  type AliasDeclaration,
  type TypeParameters,
  typeParametersOf,
} from '../../syntax/declarations.ts';
import { parentOf } from '../../syntax/tree.ts';
import { inferTypesIn } from '../../syntax/type-matches.ts';
import type { TypeCase, TypeMatch } from '../../syntax/types.ts';
import type { CheckerContext, CheckerNote } from '../context.ts';
import { checkerDiagnostics } from '../diagnostics/index.ts';
import { resolveConstraintSet } from '../traits/struct-constraints.ts';
import { parameterType } from '../types/resolve-type.ts';
import { errorType, type Type } from '../types/type.ts';
import {
  type CaseForm,
  type CasePatternForm,
  matchUse,
  type TypeMatchForm,
  type TypeMatchQueries,
} from '../types/type-match.ts';
import { sameTypeSpelled } from '../types/type-parts.ts';
import { TypeMatchExpansion } from './type-match-expansion.ts';

export class Aliases implements TypeMatchQueries {
  readonly #checker: CheckerContext;
  readonly #moduleOf: (alias: AliasDeclaration) => ModuleId;
  readonly #types: EntryTable<CheckerNote, AliasDeclaration, Type>;
  readonly #matches: EntryTable<CheckerNote, AliasDeclaration, TypeMatchForm | undefined>;
  readonly #caseTypes: EntryTable<CheckerNote, TypeCase, Type, ModuleId>;
  readonly #expansion: TypeMatchExpansion;

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
    if (body.kind !== 'TypeMatch') {
      return this.#checker.resolveType(this.#moduleOf(alias), body);
    }
    return matchUse(alias, typeParametersOf(this.#parametersOf(alias)).map(parameterType));
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

  /** What a use of `alias` gives arguments for: its own parameters, or its declaration's. */
  #parametersOf(alias: AliasDeclaration): TypeParameters {
    if (alias.kind === 'TypeAliasDeclaration') {
      return alias.typeParameters;
    }
    const tree = this.#checker.inputs.treeOf(this.#moduleOf(alias));
    const owner = parentOf(tree, alias);
    return owner !== undefined && 'typeParameters' in owner ? owner.typeParameters : [];
  }
}
