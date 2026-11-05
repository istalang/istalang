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
} from '../../definition/extern-key.ts';
import { compareOrdered } from '../../language/order.ts';
import { staticName } from '../../language/static-names.ts';
import { qualifiedName, wellKnown } from '../../language/well-known.ts';
import { memo } from '../../structures/memo.ts';
import { unreachable } from '../../structures/unreachable.ts';
import type { Checker } from '../checker/check.ts';
import type { RecursiveType } from '../checker/types/computed-types.ts';
import { folded } from '../checker/types/recursive-types.ts';
import type {
  AnonymousStructType,
  DeclaredAliasUse,
  FunctionType,
  LiteralType,
  NominalDeclaration,
  TupleType,
  Type,
  UnionType,
} from '../checker/types/type.ts';
import { parameterText, typeText } from '../checker/types/type-text.ts';
import { optionalInner } from '../checker/types/unions.ts';
import { isStdModule, type ModuleId, programModule } from '../program/program.ts';
import type {
  ExternConstantDeclaration,
  FunctionDeclaration,
  TraitDeclaration,
  TypeAliasDeclaration,
} from '../syntax/declarations.ts';
import type { Parameter } from '../syntax/expressions/index.ts';
import { isFieldsFunction } from '../syntax/field-defaults.ts';
import { targetNames } from '../syntax/patterns.ts';
import type { VariableDeclaration } from '../syntax/statements.ts';

/** The canonical name a module's declarations are qualified with. */
function moduleName(checker: Checker, module: ModuleId): string {
  return programModule(checker.program, module).name;
}

/**
 * A function's name as declared, with its owner type for a static function (`Slot.create`); a
 * fields function's is its struct's or variant's, the variant's with its enum (`Shape.Circle`).
 */
function declaredName(declaration: FunctionDeclaration): string {
  if (isFieldsFunction(declaration)) {
    const { fieldsOwner } = declaration;
    return 'struct' in fieldsOwner
      ? fieldsOwner.struct.name.text
      : staticName(fieldsOwner.enumeration.name.text, fieldsOwner.variant.name.text);
  }
  const { owner, name } = declaration;
  return owner === undefined ? name.text : staticName(owner.text, name.text);
}

/** A declaration lowering names: a function, a type, a top-level constant or an extern one. */
type NamedDeclaration =
  | FunctionDeclaration
  | NominalDeclaration
  | TraitDeclaration
  | TypeAliasDeclaration
  | VariableDeclaration
  | ExternConstantDeclaration;

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
      return declaredName(declaration);
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

/** An extern's key spells a recursive type by the alias its signature writes (`Spelling`). */
function externSpelling(checker: Checker): Spelling {
  return {
    checker,
    recursiveName: (type) =>
      type.alias?.kind === 'alias' ? type.alias : preferredAlias(checker, type),
  };
}

function passingOf(parameter: KeyedParameter): 'value' | 'reference' | 'rest' {
  if (parameter.reference) {
    return 'reference';
  }
  return parameter.node?.isRest === true ? 'rest' : 'value';
}

/**
 * How a recursive type is spelled (§3.17): its key's preferred alias, the one every spelling of that
 * type in a Definition's tables shares (`preferredAlias`); or, in an extern's key, the alias its
 * signature writes, which no alias written elsewhere changes.
 */
interface Spelling {
  readonly checker: Checker;
  readonly recursiveName: (type: RecursiveType) => DeclaredAliasUse | undefined;
}

/** `type` spelled as keys spell it: module-qualified, without sugar (`prelude.Optional<Int>`). */
export function spelledType(checker: Checker, type: Type): string {
  return keyTypeText(keyType(tableSpelling(checker), type));
}

/** The spelling of the type table: every recursive type by its key's preferred alias. */
function tableSpelling(checker: Checker): Spelling {
  return { checker, recursiveName: (type) => preferredAlias(checker, type) };
}

/**
 * How a union is named, in keys and in the type table: `T | None` as `prelude.Optional` of `T`, as
 * it was named before unions, so no key or host table changes; any other by its members.
 */
export function unionName(
  checker: Checker,
  type: UnionType,
): { readonly name: string; readonly arguments: readonly Type[] } {
  const spelling = tableSpelling(checker);
  const named = namedUnionOf(spelling, type);
  return named === undefined
    ? { name: keyTypeText(unionKey(spelling, type)), arguments: [] }
    : named;
}

/**
 * The declaration a union is named for: a recursive alias's, whose body it is (§3.17), `json.Json`
 * among them, or `prelude.Optional` for `T | None` with its one `T`; undefined for any other.
 */
function namedUnionOf(
  spelling: Spelling,
  type: UnionType,
): { readonly name: string; readonly arguments: readonly Type[] } | undefined {
  const recursive = folded(type);
  const alias = recursive.kind === 'recursive' ? spelling.recursiveName(recursive) : undefined;
  if (alias !== undefined) {
    return {
      name: qualifiedNameOf(spelling.checker, alias.declaration),
      arguments: alias.arguments,
    };
  }
  const inner = optionalOfOne(type);
  return inner === undefined
    ? undefined
    : { name: qualifiedName(wellKnown.optional), arguments: [inner] };
}

/** How the type table names the recursive type `type`'s entry: by its preferred alias, else its text. */
export function recursiveName(
  checker: Checker,
  type: RecursiveType,
): { readonly name: string; readonly arguments: readonly Type[] } {
  const alias = preferredAlias(checker, type);
  return alias === undefined
    ? { name: spelledType(checker, type), arguments: [] }
    : { name: qualifiedNameOf(checker, alias.declaration), arguments: alias.arguments };
}

/**
 * The alias the type table names the recursive type `type` by (§3.17): of the program's recursive
 * aliases taking no type arguments whose type it is, a std module's first, then by module name,
 * then by name; for one no such alias is, the alias its graph labels its node with, if any.
 */
function preferredAlias(checker: Checker, type: RecursiveType): DeclaredAliasUse | undefined {
  const preferred = preferredAliases(checker).get(checker.typeKeys.typeKey(type));
  return preferred === undefined
    ? type.graph.labels[type.node]
    : { kind: 'alias', declaration: preferred, arguments: [] };
}

/** Each program's preferred alias of each recursive type key (`preferredAlias`). */
const preferredByProgram = new WeakMap<Checker, ReadonlyMap<string, TypeAliasDeclaration>>();

function preferredAliases(checker: Checker): ReadonlyMap<string, TypeAliasDeclaration> {
  return memo(preferredByProgram, checker, () => {
    const { program } = checker;
    const ranked = [...program.modules].flatMap(([module, loaded]) =>
      loaded.tree.root.items.flatMap((item) =>
        item.kind === 'TypeAliasDeclaration' && item.typeParameters.length === 0
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
    const preferred = new Map<string, TypeAliasDeclaration>();
    for (const { item } of ranked) {
      const type = checker.aliasedType(item);
      const key = type.kind === 'recursive' ? checker.typeKeys.typeKey(type) : undefined;
      if (key !== undefined && !preferred.has(key)) {
        preferred.set(key, item);
      }
    }
    return preferred;
  });
}

/**
 * A literal type as keys spell it, by its text, and a recursive type, through the alias `spelling`
 * names it by, as `prelude.Optional<T>` is (§3.17), by its text where no alias wrote it.
 */
function spelledKeyType(spelling: Spelling, type: LiteralType | RecursiveType): KeyType {
  const alias = type.kind === 'recursive' ? spelling.recursiveName(type) : undefined;
  if (alias === undefined) {
    return { kind: 'literal', text: typeText(type) };
  }
  return {
    kind: 'named',
    name: qualifiedNameOf(spelling.checker, alias.declaration),
    arguments: alias.arguments.map((argument) => keyType(spelling, argument)),
  };
}

/** A union as keys spell it (`unionName`). */
function unionKey(spelling: Spelling, type: UnionType): KeyType {
  const named = namedUnionOf(spelling, type);
  return named === undefined
    ? { kind: 'union', members: type.members.map((member) => keyType(spelling, member)) }
    : {
        kind: 'named',
        name: named.name,
        arguments: named.arguments.map((argument) => keyType(spelling, argument)),
      };
}

/** A tuple, a shape or a function type as keys spell it: by its parts. */
function structureKeyType(
  spelling: Spelling,
  type: TupleType | AnonymousStructType | FunctionType,
): KeyType {
  switch (type.kind) {
    case 'tuple':
      return {
        kind: 'tuple',
        elements: type.elements.map((element) => keyType(spelling, element)),
      };
    case 'anonymous':
      return {
        kind: 'anonymous',
        fields: type.fields.map((field) => ({
          name: field.name,
          type: keyType(spelling, field.type),
        })),
      };
    default:
      return {
        kind: 'function',
        async: type.isAsync,
        parameters: type.parameters.map((parameter) => keyType(spelling, parameter.type)),
        result: keyType(spelling, type.result),
      };
  }
}

/** `T` of a union `T | None` whose `T` is one member; undefined for any other union. */
function optionalOfOne(type: UnionType): Type | undefined {
  const inner = optionalInner(type);
  return inner?.kind === 'union' ? undefined : inner;
}

/**
 * `given` as keys spell it, a type equal to a recursive alias's spelled as that alias (`folded`),
 * so every spelling of one type is one key, whichever of them a table meets first.
 */
function keyType(spelling: Spelling, given: Type): KeyType {
  const { checker } = spelling;
  const type = folded(given);
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
          arguments: typeArguments.map((argument) => keyType(spelling, argument)),
        })),
      };
    case 'nominal': {
      const { declaration } = type.entity;
      return {
        kind: 'named',
        name: qualifiedNameOf(checker, declaration),
        arguments: type.arguments.map((argument) => keyType(spelling, argument)),
      };
    }
    case 'tuple':
    case 'anonymous':
    case 'function':
      return structureKeyType(spelling, type);
    case 'literal':
    case 'recursive':
      return spelledKeyType(spelling, type);
    case 'recursiveMatch':
      return type.declaration.kind === 'TypeAliasDeclaration'
        ? {
            kind: 'named',
            name: qualifiedNameOf(checker, type.declaration),
            arguments: type.arguments.map((argument) => keyType(spelling, argument)),
          }
        : { kind: 'literal', text: typeText(type) };
    case 'union':
      return unionKey(spelling, type);
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
