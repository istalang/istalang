/**
 * Which nominal types are handles (§7.2, §17.2, §5.4), read off their declarations, never their
 * names, so a handle a program builds of others (an `Inbox` of a `Slot`) is one by being declared
 * `shared struct`, as the std's own are.
 *
 * A value has no identity: copying shares an immutable value, and `==` is structural. A handle has
 * one: copying copies a reference to one object, and `==` compares that identity. Where the object
 * lives is the handle's kind: an `instance` handle stays in its instance (a shared struct, an
 * `extern shared struct`), a `global` one is the same in every instance (`extern sendable
 * struct`), and a `process` one stays in the process that made it (`extern live struct`).
 */

import type { ModifierWord } from '../../../syntax/tokens/modifiers.ts';
import type { NominalDeclaration, NominalType, Type } from '../type/index.ts';

type Identity = 'value' | 'instance' | 'global' | 'process';

const externIdentities = {
  shared: 'instance',
  sendable: 'global',
  live: 'process',
} as const satisfies Record<ModifierWord<'handle'>, Identity>;

/** What identity the values of `declaration`'s types have. */
function identityOf(declaration: NominalDeclaration): Identity {
  switch (declaration.kind) {
    case 'StructDeclaration':
    case 'EnumDeclaration':
      return 'value';
    case 'SharedStructDeclaration':
      return 'instance';
    case 'ExternStructDeclaration':
      return declaration.handle === undefined ? 'value' : externIdentities[declaration.handle];
    default: {
      const unhandled: never = declaration;
      return unhandled;
    }
  }
}

/**
 * Whether `declaration`'s values are handles whose identity stays where they were made, an
 * instance or a process, so they never leave it: never sendable, and the only host types a
 * `dispose` may make disposable (§17.2, §16).
 */
export function isConfined(declaration: NominalDeclaration): boolean {
  const identity = identityOf(declaration);
  return identity === 'instance' || identity === 'process';
}

/** Whether `declaration`'s values stay in the process that made them (`extern live struct`). */
export function staysInProcess(declaration: NominalDeclaration): boolean {
  return identityOf(declaration) === 'process';
}

/** Whether `declaration`'s values are handles, which every copy shares. */
export function isHandleDeclaration(declaration: NominalDeclaration): boolean {
  return identityOf(declaration) !== 'value';
}

/** Whether `type`'s values are handles, which every copy shares. */
export function isHandleType(type: Type): type is NominalType {
  return type.kind === 'nominal' && isHandleDeclaration(type.entity.declaration);
}
