/**
 * The names a Definition gives what it lowers: qualified by the declaring module's canonical name
 * (`LocatedModule.name`), so traces and messages depend neither on where a module's file lives nor
 * on where the toolchain runs (docs/arch/definition.md, "Types and locations").
 *
 * - Names are labels for traces, identifying nothing: a declared type's entry is named by its
 *   declaration, with its type arguments beside it, and a function instance's name spells its type
 *   arguments by their table keys (instances.ts); definition.md, "Names", has the rule.
 * - A type's table key is its key (types/identity/type-keys.ts) with each identity spelled by its
 *   qualified name in place of a number, from the same structural walk: canonical, injective over
 *   keys, and a function of the type alone, never of an alias it was written through or of what
 *   else the program declares (§3.17), so it is persisted. A union orders its variants by their
 *   members' table keys and names each by one, and an entry a declaration doesn't name is named by
 *   its own (type-table.ts).
 * - Extern keys spell types their own way, stored (extern-keys.ts).
 * - Whether a type names only the std's declarations is read off the same walk, so a type spelled
 *   alike in two programs over one std is one type in both (std-lowering.ts).
 */

import { qualifiedName } from '../../../foundation/language/well-known/index.ts';
import { memo } from '../../../foundation/structures/memo.ts';
import { unreachable } from '../../../foundation/structures/unreachable.ts';
import type { Checker } from '../../checker/check.ts';
import type { IdentitySpelling } from '../../checker/types/identity/type-keys.ts';
import type { NominalDeclaration, Type } from '../../checker/types/type/index.ts';
import { type ModuleId, programModule } from '../../program/program.ts';
import { declaredFunctionName } from '../../syntax/declarations/field-defaults.ts';
import type {
  ContextConstantDeclaration,
  ExternConstantDeclaration,
  FunctionDeclaration,
  TraitDeclaration,
  TypeAliasDeclaration,
} from '../../syntax/declarations/index.ts';
import { targetNames } from '../../syntax/patterns.ts';
import type { VariableDeclaration } from '../../syntax/statements/index.ts';

/**
 * A declaration lowering names: a function, a type, a top-level constant, an extern one or a
 * context one.
 */
type NamedDeclaration =
  | FunctionDeclaration
  | NominalDeclaration
  | TraitDeclaration
  | TypeAliasDeclaration
  | VariableDeclaration
  | ExternConstantDeclaration
  | ContextConstantDeclaration;

/**
 * A declaration's name, qualified by its module's canonical name: `time.delay`, `prelude.Optional`;
 * a top-level constant's is its first name's.
 */
export function qualifiedNameOf(checker: Checker, declaration: NamedDeclaration): string {
  return qualifiedName(declaredNameOf(checker, declaration));
}

/** A declaration's name and its module's canonical name, which `qualifiedNameOf` joins. */
export function declaredNameOf(
  checker: Checker,
  declaration: NamedDeclaration,
): { readonly module: string; readonly name: string } {
  return { module: moduleName(checker, checker.moduleOf(declaration)), name: nameOf(declaration) };
}

/** The canonical name a module's declarations are qualified with. */
function moduleName(checker: Checker, module: ModuleId): string {
  return programModule(checker.program, module).name;
}

function nameOf(declaration: NamedDeclaration): string {
  switch (declaration.kind) {
    case 'FunctionDeclaration':
      return declaredFunctionName(declaration);
    case 'VariableDeclaration':
      return declaration.targets.flatMap(targetNames)[0]?.text ?? '_';
    default:
      return declaration.name.text;
  }
}

/** `type`'s table key (the banner), computed once per key of each program. */
export function tableKey(checker: Checker, type: Type): string {
  const byKey = memo(tableKeysByProgram, checker, () => new Map<string, string>());
  return memo(byKey, checker.typeKeys.typeKey(type), () =>
    checker.typeKeys.keyWith(type, qualifiedIdentities(checker), (part) => tableKey(checker, part)),
  );
}

/** Each program's table key of each type key. */
const tableKeysByProgram = new WeakMap<Checker, Map<string, string>>();

/** Identities spelled by their declarations' qualified names, as table keys spell them. */
function qualifiedIdentities(checker: Checker): IdentitySpelling {
  return memo(qualifiedByProgram, checker, () => ({
    entity: (entity) => qualifiedNameOf(checker, entity.declaration),
    trait: (trait) => qualifiedNameOf(checker, trait),
    parameter: (type) =>
      type.declaration.kind === 'TraitDeclaration'
        ? `'${qualifiedNameOf(checker, type.declaration)}`
        : unreachable("A type parameter other than a constraint's `Self` reached lowering."),
    unreduced: (type) => unreachable(`A ${type.kind} type reached lowering.`),
  }));
}

const qualifiedByProgram = new WeakMap<Checker, IdentitySpelling>();

/**
 * Whether `type` names only declarations the std's modules make, and no `any` type, whose variants
 * are a program's own: then its table key means one type in every program over the same std.
 */
export function namesOnlyStd(checker: Checker, type: Type): boolean {
  const byKey = memo(onlyStdByProgram, checker, () => new Map<string, boolean>());
  return memo(byKey, checker.typeKeys.typeKey(type), () => {
    let onlyStd = true;
    const qualified = qualifiedIdentities(checker);
    const spelling: IdentitySpelling = {
      ...qualified,
      entity: (entity) => {
        onlyStd &&= checker.isStd(checker.moduleOf(entity.declaration));
        return qualified.entity(entity);
      },
      trait: (trait) => {
        onlyStd = false;
        return qualified.trait(trait);
      },
    };
    checker.typeKeys.keyWith(type, spelling, (part) => {
      onlyStd &&= namesOnlyStd(checker, part);
      return tableKey(checker, part);
    });
    return onlyStd;
  });
}

const onlyStdByProgram = new WeakMap<Checker, Map<string, boolean>>();
