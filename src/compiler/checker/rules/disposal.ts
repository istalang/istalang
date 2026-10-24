/**
 * Which values are disposable (§7), and who disposes them. A type is disposable when a `dispose`
 * takes it as `self`: structural conformance to `Disposable` (§3.10), with no list kept anywhere
 * else. Only extern types can be.
 *
 * - An extern `dispose` that a std module declares beside its type, as the prelude does for
 *   `Future` and `Slot`, is the runtime's to perform. A host's type is the host's to own (§7), so
 *   an extern `dispose` in any other module makes nothing the runtime's.
 * - A `dispose` a program declares for an instantiation, such as `fn dispose(self: Shared<Lease>)`,
 *   runs as code; finding it (argument-dependent lookup over the instantiation) and calling it
 *   arrive with the disposal slice, until which such a type counts as not disposable.
 */

import type { Disposal } from '../check.ts';
import type { CheckerContext } from '../context.ts';
import type { NominalType } from '../types/type.ts';

export function disposalOf(checker: CheckerContext, type: NominalType): Disposal {
  const { entity } = type;
  const module = checker.bindings.moduleOf(entity);
  if (
    entity.declaration.kind !== 'ExternStructDeclaration' ||
    module === undefined ||
    checker.program.modules.get(module)?.isStd !== true
  ) {
    return 'none';
  }
  const declared = checker.bindings.exportsOf(module).get('dispose');
  const disposes =
    declared?.kind === 'functions' &&
    declared.overloads.some((candidate) => {
      const [self] = checker.parametersOf(candidate);
      return (
        candidate.isExtern &&
        self?.node.name.text === 'self' &&
        self.type.kind === 'nominal' &&
        self.type.entity === entity
      );
    });
  return disposes ? 'runtime' : 'none';
}
