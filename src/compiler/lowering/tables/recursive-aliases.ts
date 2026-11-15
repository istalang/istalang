/**
 * Which alias the type table names a type holding recursion by (§3.17, docs/arch/definition.md,
 * "Recursive types"), decided by the type's key alone, never by the alias, associated type or graph
 * label it was written or reached through, nor by which a table meets first: equal types are one
 * entry, and a union orders its variants by its members' spellings (type-table.ts), so a spelling
 * one representation of a type gives and another doesn't would tag one value two ways.
 *
 * - The preferred alias: of the program's recursive aliases naming the type, a generic one given
 *   the arguments it names it with, a std module's first, then by module name, then by name.
 * - Where none names it, a type reaching itself through types no alias names is a cycle only its
 *   structure can spell (names.ts); any other is spelled by its parts, each named again.
 */

import { compareOrdered } from '../../../foundation/language/order.ts';
import { memo } from '../../../foundation/structures/memo.ts';
import type { Checker } from '../../checker/check.ts';
import { substitute, substitutionFor } from '../../checker/types/parts/substitution.ts';
import { holdsRecursion, typeChildren } from '../../checker/types/parts/type-children.ts';
import type { DeclaredAliasUse } from '../../checker/types/type/alias-uses.ts';
import { unfolded } from '../../checker/types/type/computed-types.ts';
import type { Type } from '../../checker/types/type/index.ts';
import { isStdModule } from '../../program/program.ts';
import type { TypeAliasDeclaration } from '../../syntax/declarations/index.ts';

/** The alias the type table names `type`, holding recursion, by; undefined where none names it. */
export function preferredAlias(checker: Checker, type: Type): DeclaredAliasUse | undefined {
  const byKey = memo(preferredByProgram, checker, () => new Map());
  const key = checker.typeKeys.typeKey(type);
  return memo(byKey, key, (): DeclaredAliasUse | undefined => {
    for (const declaration of recursiveAliases(checker)) {
      const typeArguments = checker.aliasArgumentsFor(declaration, type);
      const named =
        typeArguments === undefined
          ? undefined
          : substitute(
              checker.aliasedType(declaration),
              substitutionFor(declaration.typeParameters, typeArguments),
              checker.typeRules,
            );
      if (typeArguments !== undefined && named && checker.typeKeys.typeKey(named) === key) {
        return { kind: 'alias', declaration, arguments: typeArguments };
      }
    }
    return undefined;
  });
}

/** Each program's preferred alias of each key of a type holding recursion (`preferredAlias`). */
const preferredByProgram = new WeakMap<Checker, Map<string, DeclaredAliasUse | undefined>>();

/**
 * Whether `type`, holding recursion and named by no alias, reaches itself again through types no
 * alias names: a cycle no alias breaks, which only its structure can spell (the banner).
 */
export function reachesItselfUnnamed(checker: Checker, type: Type): boolean {
  const key = checker.typeKeys.typeKey(type);
  const passed = new Set<string>();
  const partsHolding = (each: Type) => typeChildren(unfolded(each)).filter(holdsRecursion);
  const pending = partsHolding(type);
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    const nextKey = checker.typeKeys.typeKey(next);
    if (nextKey === key) {
      return true;
    }
    if (!passed.has(nextKey) && preferredAlias(checker, next) === undefined) {
      passed.add(nextKey);
      pending.push(...partsHolding(next));
    }
  }
  return false;
}

/** Each program's recursive aliases, in the order `preferredAlias` prefers them. */
const recursiveAliasesByProgram = new WeakMap<Checker, readonly TypeAliasDeclaration[]>();

function recursiveAliases(checker: Checker): readonly TypeAliasDeclaration[] {
  return memo(recursiveAliasesByProgram, checker, () => {
    const { program } = checker;
    const ranked = [...program.modules].flatMap(([module, loaded]) =>
      loaded.tree.root.items.flatMap((item) =>
        item.kind === 'TypeAliasDeclaration' && checker.aliasedType(item).kind === 'recursive'
          ? [{ item, std: isStdModule(program, module), module: loaded.name }]
          : [],
      ),
    );
    ranked.sort(
      (first, second) =>
        Number(second.std) - Number(first.std) ||
        compareOrdered(first.module, second.module) ||
        compareOrdered(first.item.name.text, second.item.name.text),
    );
    return ranked.map(({ item }) => item);
  });
}
