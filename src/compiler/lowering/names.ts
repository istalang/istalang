/**
 * The names a Definition gives what it lowers: qualified by the declaring module's canonical name
 * (`LocatedModule.name`), so traces, messages and the runtime's recognition of special types
 * (`time.Time`, `prelude.Optional`) depend neither on where a module's file lives nor on where
 * the toolchain runs (docs/arch/definition.md, "Types and locations").
 *
 * An extern's key is built by `externKey` (definition/extern-key.ts) from the declared parameter
 * types; this module only turns the checker's types into the key's. A handle's functions (§3.18)
 * are bound by the keys of the prelude's `Shared`'s: every handle is a cell, which those natives
 * make, read and write, as the type entry its function's declared types name.
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
  staticName,
} from '../../definition/extern-key.ts';
import { wellKnown } from '../../language/well-known.ts';
import { unreachable } from '../../structures/unreachable.ts';
import type { Checker } from '../checker/check.ts';
import type { NominalDeclaration, Type } from '../checker/types/type.ts';
import type { ModuleId, ProgramModule } from '../program/program.ts';
import type {
  ExternConstantDeclaration,
  FunctionDeclaration,
  HandleDeclaration,
} from '../syntax/declarations.ts';
import { handleFunctionsOf, originOf } from '../syntax/derived-functions.ts';
import { targetNames } from '../syntax/patterns.ts';
import type { VariableDeclaration } from '../syntax/statements.ts';

/** The program's module `module`; lowering only ever names modules of its program. */
export function loadedModule(checker: Checker, module: ModuleId): ProgramModule {
  const loaded = checker.program.modules.get(module);
  if (loaded === undefined) {
    unreachable(`Module ${module} is not in the program.`);
  }
  return loaded;
}

/** The canonical name a module's declarations are qualified with. */
function moduleName(checker: Checker, module: ModuleId): string {
  return loadedModule(checker, module).name;
}

/** A function's name as declared, with its owner type for a static function: `Slot.create`. */
function declaredName(declaration: FunctionDeclaration): string {
  const { owner, name } = declaration;
  return owner === undefined ? name.text : staticName(owner.text, name.text);
}

/** A declaration lowering names: a function, a type, a top-level constant or an extern one. */
type NamedDeclaration =
  | FunctionDeclaration
  | NominalDeclaration
  | VariableDeclaration
  | ExternConstantDeclaration;

/**
 * A declaration's name, qualified by its module's canonical name: `time.delay`, `prelude.Optional`;
 * a top-level constant's is its first name's.
 */
export function qualifiedNameOf(checker: Checker, declaration: NamedDeclaration): string {
  return `${moduleName(checker, checker.moduleOf(declaration))}.${nameOf(declaration)}`;
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

/**
 * The key binding `declaration`, taking `parameters`, across the host boundary (§9): an extern to
 * its native, or a startable function to what a host starts it by. Both are spelled alike: module,
 * name, and the declared parameter types.
 */
export function keyOf(
  checker: Checker,
  declaration: FunctionDeclaration | VariableDeclaration,
  parameters: readonly { readonly type: Type; readonly reference: boolean }[],
): string {
  const signature: ExternSignature = {
    module: moduleName(checker, checker.moduleOf(declaration)),
    name: nameOf(declaration),
    parameters: parameters.map(({ type, reference }) => ({
      type: keyType(checker, type),
      reference,
    })),
  };
  return externKey(signature);
}

/** The key binding the extern function `declaration` to its native (definition/extern-key.ts). */
export function nativeKeyOf(checker: Checker, declaration: FunctionDeclaration): string {
  const origin = originOf(declaration);
  const bound =
    origin?.kind === 'handle'
      ? handleFunctionsOf(preludeShared(checker))[origin.role]
      : declaration;
  return keyOf(checker, bound, checker.parametersOf(bound));
}

/** The prelude's `Shared`, the handle whose natives every handle's functions are. */
function preludeShared(checker: Checker): HandleDeclaration {
  const entity = checker.wellKnownEntity(wellKnown.shared);
  if (entity?.kind !== 'type' || entity.declaration.kind !== 'HandleDeclaration') {
    unreachable("A handle was lowered in a program without the prelude's Shared.");
  }
  return entity.declaration;
}

/** `type` spelled as keys spell it: module-qualified, without sugar (`prelude.Optional<int>`). */
export function spelledType(checker: Checker, type: Type): string {
  return keyTypeText(keyType(checker, type));
}

function keyType(checker: Checker, type: Type): KeyType {
  switch (type.kind) {
    case 'primitive':
      return { kind: 'primitive', name: type.name };
    case 'parameter':
      return { kind: 'parameter', name: type.declaration.name.text };
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
    case 'error':
      return unreachable('An extern with an unresolved type reached lowering.');
    default: {
      const unhandled: never = type;
      return unhandled;
    }
  }
}
