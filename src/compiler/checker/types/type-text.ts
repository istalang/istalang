/**
 * How a type reads in messages and in the names of instantiations: the way a programmer would
 * write it, `Pair<int, string>`, `int?`, `fn(int) -> bool`.
 *
 * Nominal types print their declared name without a module: inside a message the source location
 * already says where.
 */

import type { Type } from './type.ts';

/**
 * `type` as source would spell it. Extern keys spell types too (definition/extern-key.ts), but
 * apart on purpose: they are a persisted identity, and must never follow a change of wording here.
 */
export function typeText(type: Type): string {
  switch (type.kind) {
    case 'primitive':
      return type.name;
    case 'nominal':
      return nominalText(type.entity.declaration.name.text, type.arguments);
    case 'tuple':
      return `(${type.elements.map(typeText).join(', ')}${type.elements.length === 1 ? ',' : ''})`;
    case 'function': {
      const parameters = type.parameters.map(
        (parameter) => `${parameter.reference ? '&' : ''}${typeText(parameter.type)}`,
      );
      return `${type.isAsync ? 'async ' : ''}fn(${parameters.join(', ')}) -> ${typeText(type.result)}`;
    }
    case 'parameter':
      return type.declaration.name.text;
    case 'error':
      return '?';
    default: {
      const unhandled: never = type;
      return unhandled;
    }
  }
}

/** `Optional<T>` reads as `T?` (§2); anything else as `Name<Arguments>`. */
function nominalText(name: string, typeArguments: readonly Type[]): string {
  const [only] = typeArguments;
  if (name === 'Optional' && typeArguments.length === 1 && only !== undefined) {
    return `${typeText(only)}?`;
  }
  return typeArguments.length === 0 ? name : `${name}<${typeArguments.map(typeText).join(', ')}>`;
}
