/**
 * What crosses the host boundary spelled (§9, docs/arch/definition.md, "Externs"): the key binding
 * an extern to its native or a startable function to what a host starts it by, and the type a host
 * extern provides as declared, both persisted by stores and host tables across deploys. So their
 * spelling is frozen bytes (extern-keys.sweep.test.ts), rendered by `externKey` and `keyTypeText`
 * (definition/extern-key.ts); this module only projects the checker's types onto `KeyType`.
 *
 * - The projection is lossy on purpose, and its own walk: it leaves out a function type's `&`
 *   parameters, sendability and pack and spells `T | None` as `prelude.Optional<T>`, as keys did
 *   before those were types, so no key changes. A Definition identifies types by table keys
 *   (names.ts), never by these.
 * - A type holding recursion is spelled as its signature writes it, which no alias written
 *   elsewhere changes: the alias written, else the alias its graph labels it with, else, a cycle no
 *   alias names, its table key.
 */

import {
  type ExternSignature,
  externKey,
  type KeyType,
  keyTypeText,
} from '../../../definition/extern-key.ts';
import { qualifiedName, wellKnown } from '../../../foundation/language/well-known/index.ts';
import { unreachable } from '../../../foundation/structures/unreachable.ts';
import type { Checker } from '../../checker/check.ts';
import { folded } from '../../checker/types/identity/folding.ts';
import type { DeclaredAliasUse } from '../../checker/types/type/alias-uses.ts';
import { persistenceOf } from '../../checker/types/type/function-kinds.ts';
import type {
  AnonymousStructType,
  FunctionType,
  TupleType,
  Type,
  UnionType,
} from '../../checker/types/type/index.ts';
import { literalText } from '../../checker/types/type/primitives.ts';
import { parameterText } from '../../checker/types/type/type-text.ts';
import { optionalInner } from '../../checker/types/unions/unions.ts';
import type { FunctionDeclaration } from '../../syntax/declarations/index.ts';
import type { Parameter } from '../../syntax/expressions/index.ts';
import type { VariableDeclaration } from '../../syntax/statements/index.ts';
import { declaredNameOf, qualifiedNameOf, tableKey } from './names.ts';

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
    ...declaredNameOf(checker, declaration),
    parameters: parameters.map((parameter) => ({
      type: keyType(checker, parameter.type),
      passing: passingOf(parameter),
    })),
  };
  return externKey(signature);
}

/** The type a host extern provides, as declared (a function's result, a constant's type). */
export function declaredTypeOf(checker: Checker, type: Type): string {
  return keyTypeText(keyType(checker, type));
}

function passingOf(parameter: KeyedParameter): 'value' | 'reference' | 'rest' {
  if (parameter.reference) {
    return 'reference';
  }
  return parameter.node?.isRest === true ? 'rest' : 'value';
}

/** How the types a type is built from are spelled. */
type PartKeyType = (part: Type) => KeyType;

/** `type` as keys spell it: whole where it is recursive (the banner), else by its parts. */
function keyType(checker: Checker, type: Type): KeyType {
  const part = (each: Type): KeyType => keyType(checker, each);
  return recursiveKeyType(checker, type, part) ?? ownKeyType(checker, type, part);
}

/** A recursive type as its signature writes it (the banner); undefined for any other type. */
function recursiveKeyType(checker: Checker, type: Type, part: PartKeyType): KeyType | undefined {
  const recursive = folded(type);
  if (recursive.kind !== 'recursive') {
    return undefined;
  }
  const label = recursive.graph.labels[recursive.node];
  const alias =
    (recursive.alias?.kind === 'alias' ? recursive.alias : undefined) ??
    (label?.kind === 'alias' ? label : undefined);
  return alias === undefined
    ? { kind: 'literal', text: tableKey(checker, recursive) }
    : aliasKeyType(checker, alias, part);
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
function unionKeyType(type: UnionType, part: PartKeyType): KeyType {
  const inner = optionalInner(type);
  return inner === undefined || inner.kind === 'union'
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

/** `type`'s own structure as keys spell it, each type it is built from spelled by `part`. */
function ownKeyType(checker: Checker, type: Type, part: PartKeyType): KeyType {
  switch (type.kind) {
    case 'primitive':
      return { kind: 'primitive', name: type.name };
    case 'parameter':
      return { kind: 'parameter', name: parameterText(type) };
    case 'any':
      return {
        kind: 'any',
        traits: type.constraints.map(({ trait, arguments: typeArguments }) => ({
          kind: 'named',
          name: qualifiedNameOf(checker, trait),
          arguments: typeArguments.map(part),
        })),
      };
    case 'nominal':
      return {
        kind: 'named',
        name: qualifiedNameOf(checker, type.entity.declaration),
        arguments: type.arguments.map(part),
      };
    case 'tuple':
    case 'anonymous':
    case 'function':
      return structureKeyType(type, part);
    case 'literal':
      return { kind: 'literal', text: literalText(type.value) };
    case 'union':
      return unionKeyType(type, part);
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
