/**
 * The types a body writes (§2), resolved where the body is checked. Outside the passes of a loop
 * over a type's keys, a written type is the program's, resolved once; inside them, each pass binds
 * the loop's key (contexts/passes.ts), so a written type is resolved afresh in each pass, from its
 * leaves up, its mistakes reported in the pass, and each node it is built of recorded for the pass
 * (types/written/written.ts), which tools read joined (`CheckedBody.writtenTypeOf`).
 */

import type { Diagnostic } from '../../../../foundation/diagnostics/diagnostic.ts';
import type { ModuleId } from '../../../program/program.ts';
import type { AnchoredSpan } from '../../../syntax/tree/positions.ts';
import type { TypeNode } from '../../../syntax/types/index.ts';
import type { CheckerContext } from '../../contexts/context.ts';
import type { Pass, Passes, PassTable } from '../../contexts/passes.ts';
import type { Type } from '../../types/type/index.ts';
import { resolveInPass } from '../../types/written/resolve-type.ts';

/** Where a body resolves its written types: its checker and module, and how it reports. */
interface Resolving {
  readonly checker: CheckerContext;
  readonly module: ModuleId;
  readonly report: (diagnostic: Diagnostic<AnchoredSpan>) => void;
}

export class WrittenTypes {
  readonly #passes: Passes;
  readonly #types: PassTable<TypeNode, Type>;

  constructor(passes: Passes) {
    this.#passes = passes;
    this.#types = passes.table();
  }

  /** The type `node` denotes in the pass being checked (the banner), recorded. */
  resolved({ checker, module, report }: Resolving, node: TypeNode): Type {
    const { binds } = this.#passes.current;
    const record = (each: TypeNode, denoted: Type) => this.#types.set(each, denoted);
    if (binds.size > 0) {
      return resolveInPass(checker, module, node, { binds, report, record });
    }
    const resolved = checker.resolveType(module, node);
    record(node, resolved);
    return resolved;
  }

  /** The type `node` denoted where `pass` resolved it. */
  of(node: TypeNode, pass?: Pass): Type | undefined {
    return this.#types.get(node, pass);
  }
}
