/**
 * The arrays what `hold`s keep is kept in (§16), one per scope and type, for the flow writing them
 * (writer.ts): each made empty where first asked for, each `keep` appending to its own
 * (operations.ts). One is let go of where its scope ends and made anew, empty, for the scope's next
 * run; the function's are let go of by the entry's return, never by a loop's turn.
 */

import type { Register } from '../../../definition/operands.ts';
import { memo } from '../../../foundation/structures/memo.ts';
import type { Type } from '../../checker/types/type/index.ts';
import { arrayOf } from '../../checker/types/type/well-known.ts';
import type { LabelledScope } from '../../syntax/statements/index.ts';
import type { AnchoredSpan } from '../../syntax/tree/positions.ts';
import type { CodeContext } from '../context.ts';

/** The scope what a `hold` keeps lasts until: a labelled block or loop, or the function. */
type HeldUntil = LabelledScope | 'function';

export class HoldLists {
  readonly #lists = new Map<HeldUntil, Map<string, Register>>();

  /** The array what `hold`s keep of `type` until `until` ends is kept in, made empty where new. */
  listOf(context: CodeContext, until: HeldUntil, type: Type, span: AnchoredSpan): Register {
    const { checker, tables, code } = context;
    const lists = memo(this.#lists, until, () => new Map<string, Register>());
    return memo(lists, checker.typeKeys.typeKey(type), () => {
      const list = code.allocate(tables.types.reference(arrayOf(checker, type)));
      code.pin(list);
      code.emit({ kind: 'array', span, dst: list, elements: [] });
      return list;
    });
  }

  /** The arrays what `hold`s keep until `until` ends. */
  keptUntil(until: HeldUntil): readonly Register[] {
    return [...(this.#lists.get(until)?.values() ?? [])];
  }

  /** Whether `register` is one of the arrays. */
  has(register: Register): boolean {
    return [...this.#lists.values()].some((lists) => [...lists.values()].includes(register));
  }
}
