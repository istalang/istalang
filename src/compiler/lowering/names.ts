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
import type { Checker } from '../checker/check.ts';
import type { NominalDeclaration, Type } from '../checker/types/type.ts';
import type { ModuleId, ProgramModule } from '../program/program.ts';
import type { FunctionDeclaration } from '../syntax/declarations.ts';

/** The program's module `module`; lowering only ever names modules of its program. */
export function loadedModule(checker: Checker, module: ModuleId): ProgramModule {
  const loaded = checker.program.modules.get(module);
  if (loaded === undefined) {
    throw new Error(`Module ${module} is not in the program.`);
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
  return owner === undefined ? name.text : `${owner.text}.${name.text}`;
}

/** A declaration's name, qualified by its module's canonical name: `time.delay`, `prelude.Optional`. */
export function qualifiedNameOf(
  checker: Checker,
  declaration: FunctionDeclaration | NominalDeclaration,
): string {
  const name =
    declaration.kind === 'FunctionDeclaration' ? declaredName(declaration) : declaration.name.text;
  return `${moduleName(checker, checker.moduleOf(declaration))}.${name}`;
}

/** The key that binds the extern `declaration` to its native. */
export function externKeyOf(checker: Checker, declaration: FunctionDeclaration): string {
  const signature: ExternSignature = {
    module: moduleName(checker, checker.moduleOf(declaration)),
    name: declaredName(declaration),
    parameters: checker.parametersOf(declaration).map((parameter) => ({
      type: keyType(checker, parameter.type),
      reference: parameter.reference,
    })),
  };
  return externKey(signature);
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
    case 'function':
      return {
        kind: 'function',
        async: type.isAsync,
        parameters: type.parameters.map((parameter) => keyType(checker, parameter.type)),
        result: keyType(checker, type.result),
      };
    case 'error':
      throw new Error('An extern with an unresolved type reached lowering.');
    default: {
      const unhandled: never = type;
      return unhandled;
    }
  }
}
