/**
 * The names a Definition gives what it lowers: qualified by the declaring module's canonical name
 * (`LocatedModule.name`), so traces, messages and the runtime's recognition of special types
 * (`time.Time`, `prelude.Optional`) depend neither on where a module's file lives nor on where
 * the toolchain runs (docs/arch/definition.md, "Types and locations").
 *
 * An extern's key is built by `externKey` (definition/extern-key.ts) from the declared parameter
 * types; this module only turns the checker's types into the key's.
 *
 * Names are of declarations: a generic type's entries are told apart by the type arguments the
 * Definition records beside the name. A function instance's name also spells its type arguments
 * the way keys do (instances.ts), for traces to read; definition.md, "Names", has the rule.
 */

import {
  type ExternSignature,
  externKey,
  type KeyType,
  keyTypeText,
} from '../../../definition/extern-key.ts';
import { qualifiedName, wellKnown } from '../../../foundation/language/well-known/index.ts';
import { memo } from '../../../foundation/structures/memo.ts';
import { unreachable } from '../../../foundation/structures/unreachable.ts';
import type { Checker } from '../../checker/check.ts';
import { folded } from '../../checker/types/identity/folding.ts';
import { canonicalKey } from '../../checker/types/identity/recursive-terms.ts';
import { holdsRecursion } from '../../checker/types/parts/type-children.ts';
import type { DeclaredAliasUse } from '../../checker/types/type/alias-uses.ts';
import { type RecursiveType, unfolded } from '../../checker/types/type/computed-types.ts';
import { persistenceOf } from '../../checker/types/type/function-kinds.ts';
import type {
  AnonymousStructType,
  FunctionType,
  NominalDeclaration,
  TupleType,
  Type,
  UnionType,
} from '../../checker/types/type/index.ts';
import { parameterText, typeText } from '../../checker/types/type/type-text.ts';
import { optionalInner } from '../../checker/types/unions/unions.ts';
import { type ModuleId, programModule } from '../../program/program.ts';
import { declaredFunctionName } from '../../syntax/declarations/field-defaults.ts';
import type {
  ContextConstantDeclaration,
  ExternConstantDeclaration,
  FunctionDeclaration,
  TraitDeclaration,
  TypeAliasDeclaration,
} from '../../syntax/declarations/index.ts';
import type { Parameter } from '../../syntax/expressions/index.ts';
import { targetNames } from '../../syntax/patterns.ts';
import type { VariableDeclaration } from '../../syntax/statements/index.ts';
import { preferredAlias, reachesItselfUnnamed } from './recursive-aliases.ts';

/** The canonical name a module's declarations are qualified with. */
function moduleName(checker: Checker, module: ModuleId): string {
  return programModule(checker.program, module).name;
}

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
  return qualifiedName({
    module: moduleName(checker, checker.moduleOf(declaration)),
    name: nameOf(declaration),
  });
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

/** A parameter as a key spells it: its type, whether by `&`, and its node when declared. */
interface KeyedParameter {
  readonly type: Type;
  readonly reference: boolean;
  readonly node?: Pick<Parameter, 'isRest'>;
}

/**
 * The key binding `declaration`, taking `parameters`, across the host boundary (§9): an extern to
 * its native, or a startable function to what a host starts it by. Both are spelled alike: module,
 * name, and the declared parameter types.
 */
export function keyOf(
  checker: Checker,
  declaration: FunctionDeclaration | VariableDeclaration,
  parameters: readonly KeyedParameter[],
): string {
  const signature: ExternSignature = {
    module: moduleName(checker, checker.moduleOf(declaration)),
    name: nameOf(declaration),
    parameters: parameters.map((parameter) => ({
      type: keyType(externSpelling(checker), parameter.type),
      passing: passingOf(parameter),
    })),
  };
  return externKey(signature);
}

/**
 * An extern's key spells a recursive type as its signature writes it (§3.17), which no alias
 * written elsewhere changes: the alias written, else the preferred one, else the alias its graph
 * labels it with, else its text.
 */
function externSpelling(checker: Checker): Spelling {
  return {
    checker,
    whole: (type, part) => {
      const recursive = folded(type);
      if (recursive.kind !== 'recursive') {
        return;
      }
      const label = recursive.graph.labels[recursive.node];
      const alias =
        (recursive.alias?.kind === 'alias' ? recursive.alias : undefined) ??
        preferredAlias(checker, recursive) ??
        (label?.kind === 'alias' ? label : undefined);
      return alias === undefined
        ? { kind: 'literal', text: typeText(recursive) }
        : aliasKeyType(checker, alias, part);
    },
  };
}

function passingOf(parameter: KeyedParameter): 'value' | 'reference' | 'rest' {
  if (parameter.reference) {
    return 'reference';
  }
  return parameter.node?.isRest === true ? 'rest' : 'value';
}

/** How the types a type is built from are spelled: as keys spell them, or by number in a graph. */
type PartKeyType = (part: Type) => KeyType;

/**
 * How a type holding recursion is spelled (§3.17): in a Definition's tables, by its key alone
 * (`tableSpelling`); in an extern's key, as its signature writes it (`externSpelling`).
 */
interface Spelling {
  readonly checker: Checker;
  /** `type` spelled whole, an alias or a text naming it; undefined where its parts spell it. */
  readonly whole: (type: Type, part: PartKeyType) => KeyType | undefined;
}

/** `type` spelled as keys spell it: module-qualified, without sugar (`prelude.Optional<Int>`). */
export function spelledType(checker: Checker, type: Type): string {
  return keyTypeText(keyType(tableSpelling(checker), type));
}

/**
 * The spelling of the type table, a function of a type's key (recursive-aliases.ts): a type holding
 * recursion by its preferred alias, else, where it is a cycle no alias breaks, by its structure
 * (`unnamedText`); any other by its parts.
 */
function tableSpelling(checker: Checker): Spelling {
  return {
    checker,
    whole: (type, part) => {
      if (!holdsRecursion(type)) {
        return;
      }
      const alias = preferredAlias(checker, type);
      if (alias !== undefined) {
        return aliasKeyType(checker, alias, part);
      }
      const text = unnamedText(checker, type);
      return text === undefined ? undefined : { kind: 'literal', text };
    },
  };
}

/**
 * A type holding recursion that no alias names, where it reaches itself through types no alias
 * names, as the type table spells it: its minimized term graph spelled by names where its key has
 * identities' numbers (`canonicalKey`), `~i` where a node is reached again; undefined for any
 * other, which its parts spell.
 */
function unnamedText(checker: Checker, type: Type): string | undefined {
  const byKey = memo(unnamedTextsByProgram, checker, () => new Map<string, string | undefined>());
  return memo(byKey, checker.typeKeys.typeKey(type), () => {
    if (!reachesItselfUnnamed(checker, type)) {
      return;
    }
    const spelling = tableSpelling(checker);
    const numbered = (text: string): KeyType => ({ kind: 'literal', text });
    return canonicalKey(
      type,
      (leaf) => keyTypeText(keyType(spelling, leaf)),
      (term, partKey) => keyTypeText(ownKeyType(checker, term, (part) => numbered(partKey(part)))),
    );
  });
}

/** Each program's `unnamedText` of each key of a type holding recursion. */
const unnamedTextsByProgram = new WeakMap<Checker, Map<string, string | undefined>>();

/**
 * How a union is named, in keys and in the type table: a recursive alias's body by the alias
 * (§3.17), `json.Json` among them; `T | None` as `prelude.Optional` of `T`, as it was named before
 * unions, so no key or host table changes; any other by its members.
 */
export function unionName(checker: Checker, type: UnionType): EntryName {
  const alias = holdsRecursion(type) ? preferredAlias(checker, type) : undefined;
  if (alias !== undefined) {
    return aliasName(checker, alias);
  }
  const inner = optionalOfOne(type);
  if (inner !== undefined) {
    return { name: qualifiedName(wellKnown.optional), arguments: [inner] };
  }
  const spelling = tableSpelling(checker);
  return {
    name: keyTypeText(unionKey(type, (part) => keyType(spelling, part))),
    arguments: [],
  };
}

/** How the type table names the recursive type `type`'s entry: by its preferred alias, else its text. */
export function recursiveName(checker: Checker, type: RecursiveType): EntryName {
  const alias = preferredAlias(checker, type);
  return alias === undefined
    ? { name: spelledType(checker, type), arguments: [] }
    : aliasName(checker, alias);
}

/** An entry's name: a declaration's qualified name and the type arguments it is given. */
interface EntryName {
  readonly name: string;
  readonly arguments: readonly Type[];
}

function aliasName(checker: Checker, alias: DeclaredAliasUse): EntryName {
  return { name: qualifiedNameOf(checker, alias.declaration), arguments: alias.arguments };
}

/** A type through `alias`, as `prelude.Optional<T>` is spelled (§3.17). */
function aliasKeyType(checker: Checker, alias: DeclaredAliasUse, part: PartKeyType): KeyType {
  return {
    kind: 'named',
    name: qualifiedNameOf(checker, alias.declaration),
    arguments: alias.arguments.map(part),
  };
}

/** A union as keys spell it: `T | None` as `prelude.Optional<T>`, any other by its members. */
function unionKey(type: UnionType, part: PartKeyType): KeyType {
  const inner = optionalOfOne(type);
  return inner === undefined
    ? { kind: 'union', members: type.members.map(part) }
    : { kind: 'named', name: qualifiedName(wellKnown.optional), arguments: [part(inner)] };
}

/** A tuple, a shape or a function type as keys spell it: by its parts. */
function structureKeyType(
  type: TupleType | AnonymousStructType | FunctionType,
  part: PartKeyType,
): KeyType {
  switch (type.kind) {
    case 'tuple':
      return { kind: 'tuple', elements: type.elements.map(part) };
    case 'anonymous':
      return {
        kind: 'anonymous',
        fields: type.fields.map((field) => ({ name: field.name, type: part(field.type) })),
      };
    default:
      return {
        kind: 'function',
        persistence: persistenceOf(type.mark),
        parameters: type.parameters.map((parameter) => part(parameter.type)),
        result: part(type.result),
      };
  }
}

/** `T` of a union `T | None` whose `T` is one member; undefined for any other union. */
function optionalOfOne(type: UnionType): Type | undefined {
  const inner = optionalInner(type);
  return inner?.kind === 'union' ? undefined : inner;
}

/** `type` as keys spell it: whole where `spelling` names it so, else by its parts. */
function keyType(spelling: Spelling, type: Type): KeyType {
  const part = (each: Type): KeyType => keyType(spelling, each);
  return spelling.whole(type, part) ?? ownKeyType(spelling.checker, unfolded(type), part);
}

/** `type`'s own structure as keys spell it, each type it is built from spelled by `part`. */
function ownKeyType(checker: Checker, type: Type, part: PartKeyType): KeyType {
  switch (type.kind) {
    case 'primitive':
      return { kind: 'primitive', name: type.name };
    case 'parameter':
      return {
        kind: 'parameter',
        name: parameterText(type),
      };
    case 'any':
      return {
        kind: 'any',
        traits: type.constraints.map(({ trait, arguments: typeArguments }) => ({
          kind: 'named',
          name: qualifiedNameOf(checker, trait),
          arguments: typeArguments.map(part),
        })),
      };
    case 'nominal': {
      const { declaration } = type.entity;
      return {
        kind: 'named',
        name: qualifiedNameOf(checker, declaration),
        arguments: type.arguments.map(part),
      };
    }
    case 'tuple':
    case 'anonymous':
    case 'function':
      return structureKeyType(type, part);
    case 'literal':
      return { kind: 'literal', text: typeText(type) };
    case 'union':
      return unionKey(type, part);
    case 'recursive':
      return unreachable('A recursive type is spelled whole or as what it unfolds to.');
    case 'associated':
    case 'field':
    case 'keys':
    case 'mapped':
    case 'match':
      return unreachable('An instantiated type is computed already.');
    case 'error':
      return unreachable('An extern with an unresolved type reached lowering.');
    default: {
      const unhandled: never = type;
      return unhandled;
    }
  }
}
