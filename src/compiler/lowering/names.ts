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
import { staticName } from '../../language/static-names.ts';
import { qualifiedName, wellKnown } from '../../language/well-known.ts';
import { unreachable } from '../../structures/unreachable.ts';
import type { Checker } from '../checker/check.ts';
import type { NominalDeclaration, Type, UnionType } from '../checker/types/type.ts';
import { parameterText, typeText } from '../checker/types/type-text.ts';
import { optionalInner } from '../checker/types/unions.ts';
import { type ModuleId, programModule } from '../program/program.ts';
import type {
  ExternConstantDeclaration,
  FunctionDeclaration,
  TraitDeclaration,
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
      type: keyType(checker, parameter.type),
      passing: passingOf(parameter),
    })),
  };
  return externKey(signature);
}

function passingOf(parameter: KeyedParameter): 'value' | 'reference' | 'rest' {
  if (parameter.reference) {
    return 'reference';
  }
  return parameter.node?.isRest === true ? 'rest' : 'value';
}

/** `type` spelled as keys spell it: module-qualified, without sugar (`prelude.Optional<Int>`). */
export function spelledType(checker: Checker, type: Type): string {
  return keyTypeText(keyType(checker, type));
}

/**
 * How a union is named, in keys and in the type table: `T | None` as `prelude.Optional` of `T`, as
 * it was named before unions, so no key or host table changes; any other by its members.
 */
export function unionName(
  checker: Checker,
  type: UnionType,
): { readonly name: string; readonly arguments: readonly Type[] } {
  const inner = optionalOfOne(type);
  return inner === undefined
    ? { name: keyTypeText(unionKey(checker, type)), arguments: [] }
    : { name: qualifiedName(wellKnown.optional), arguments: [inner] };
}

/** A union as keys spell it (`unionName`). */
function unionKey(checker: Checker, type: UnionType): KeyType {
  const inner = optionalOfOne(type);
  return inner === undefined
    ? { kind: 'union', members: type.members.map((member) => keyType(checker, member)) }
    : {
        kind: 'named',
        name: qualifiedName(wellKnown.optional),
        arguments: [keyType(checker, inner)],
      };
}

/** `T` of a union `T | None` whose `T` is one member; undefined for any other union. */
function optionalOfOne(type: UnionType): Type | undefined {
  const inner = optionalInner(type);
  return inner?.kind === 'union' ? undefined : inner;
}

function keyType(checker: Checker, type: Type): KeyType {
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
          arguments: typeArguments.map((argument) => keyType(checker, argument)),
        })),
      };
    case 'nominal': {
      const { declaration } = type.entity;
      return {
        kind: 'named',
        name: qualifiedNameOf(checker, declaration),
        arguments: type.arguments.map((argument) => keyType(checker, argument)),
      };
    }
    case 'tuple':
      return { kind: 'tuple', elements: type.elements.map((element) => keyType(checker, element)) };
    case 'anonymous':
      return {
        kind: 'anonymous',
        fields: type.fields.map((field) => ({
          name: field.name,
          type: keyType(checker, field.type),
        })),
      };
    case 'function':
      return {
        kind: 'function',
        async: type.isAsync,
        parameters: type.parameters.map((parameter) => keyType(checker, parameter.type)),
        result: keyType(checker, type.result),
      };
    case 'literal':
    case 'recursive':
      return { kind: 'literal', text: typeText(type) };
    case 'union':
      return unionKey(checker, type);
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
