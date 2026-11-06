/**
 * The types recursive aliases close to (§3.17): each alias's group (alias-recursion.ts) closes
 * together, so mutually recursive aliases are one graph (types/recursive-types.ts).
 *
 * - A body is resolved for closing apart from the checker's own resolution of its nodes, each use
 *   of a group alias standing as a placeholder, a type parameter keyed by that alias, which nothing
 *   else ever holds (types/resolve-type.ts `resolveClosing`). Resolving it as written would need
 *   the alias closed first. Its nodes resolve again as written, with each use the closed type, which
 *   is what everything else reads; that resolution reports, and notes the constraint checks.
 * - Regularity (5128) makes every use inside the group pass its referring alias's own parameters,
 *   in order, so each body is written in the closing alias's parameters by renaming them, and a
 *   placeholder needs no arguments.
 * - Each alias of a group closes the group on its own, its own body first, so what it closes to
 *   depends on its group alone, whichever alias was asked first.
 * - A group closing to the error type none of its bodies holds is a cycle no guard breaks once its
 *   aliases and type `match`es are expanded: reported as one (5106), so no error type is left
 *   unexplained (alias-recursion.ts decides guards from what aliases do with their arguments, so
 *   this is what it can't see).
 */

import type { EntryTable } from '../../../structures/entries/index.ts';
import type { ModuleId } from '../../program/program.ts';
import { type TypeAliasDeclaration, typeParametersOf } from '../../syntax/declarations.ts';
import type { CheckerContext, CheckerNote } from '../context.ts';
import { checkerDiagnostics } from '../diagnostics/index.ts';
import { closeRecursive } from '../types/recursive-types.ts';
import { parameterType, resolveClosing } from '../types/resolve-type.ts';
import { substitute, substitutionFor } from '../types/substitution.ts';
import { errorType, type Type } from '../types/type.ts';
import { mentionsError, sameTypeSpelled } from '../types/type-parts.ts';
import type { AliasRecursions } from './alias-recursion.ts';

export class RecursiveBodies {
  readonly #checker: CheckerContext;
  readonly #moduleOf: (alias: TypeAliasDeclaration) => ModuleId;
  readonly #recursions: AliasRecursions;
  /** Each alias's body resolved for closing, its group's uses placeholders. */
  readonly #bodies: EntryTable<CheckerNote, TypeAliasDeclaration, Type>;

  constructor(
    checker: CheckerContext,
    moduleOf: (alias: TypeAliasDeclaration) => ModuleId,
    recursions: AliasRecursions,
  ) {
    this.#checker = checker;
    this.#moduleOf = moduleOf;
    this.#recursions = recursions;
    this.#bodies = checker.entries.table({
      name: 'recursive alias bodies',
      compute: (alias) => this.#bodyOf(alias),
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
  }

  /** The type the recursive `alias` closes to, its own parameters open (the banner). */
  closed(alias: TypeAliasDeclaration): Type {
    const group = this.#recursions.groupOf(alias);
    const parameters = typeParametersOf(alias.typeParameters).map(parameterType);
    const rules = this.#checker.typeRules;
    const bodies = group.map((member) =>
      member === alias
        ? this.#bodies.get(member)
        : substitute(
            this.#bodies.get(member),
            substitutionFor(member.typeParameters, parameters),
            rules,
          ),
    );
    const indexes = new Map(group.map((member, index) => [member, index] as const));
    const [closed = errorType] = closeRecursive({
      bodies,
      placeholderOf: (type) =>
        type.kind === 'parameter' && type.declaration.kind === 'TypeAliasDeclaration'
          ? indexes.get(type.declaration)
          : undefined,
      labels: group.map((member) => ({
        kind: 'alias',
        declaration: member,
        arguments: parameters,
      })),
      rules,
    });
    if (mentionsError(closed) && !bodies.some(mentionsError)) {
      // A cycle no guard breaks once its aliases and type `match`es are expanded names no type.
      this.#checker.report(
        this.#moduleOf(alias),
        checkerDiagnostics.aliasCycle(alias.name.span, alias.name.text),
      );
      return errorType;
    }
    return closed;
  }

  #bodyOf(alias: TypeAliasDeclaration): Type {
    const body = alias.type;
    if (body.kind === 'TypeMatch') {
      return errorType;
    }
    const module = this.#moduleOf(alias);
    const group = new Set(this.#recursions.groupOf(alias));
    return resolveClosing(this.#checker, module, body, {
      aliases: group,
      writesUse: (node) => this.#recursions.writesReference(module, node, group),
    });
  }
}
