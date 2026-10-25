/**
 * `select` (§8): each case's future in source order, then one `select` instruction that waits for
 * one of them, or with `otherwise` chooses at once, and jumps to the case it picks.
 *
 * - A case holds the registers its expression created, which losing releases (§8). A future read
 *   from a variable lives in the variable's register, which the case didn't create, so it survives
 *   a loss and can race again.
 * - The value a case's future gives arrives in its `bind` register; its body declares `as name`
 *   as a target of the case (variables.ts), then runs and writes the select's value.
 * - Without `await`, `else` is where the select goes when no case's future has resolved.
 */

import type { Register } from '../../../definition/operands.ts';
import type { Select, SelectCase } from '../../syntax/expressions.ts';
import type { Block } from '../../syntax/statements.ts';
import type { Label, SelectCaseCode } from '../code-writer.ts';
import type { FunctionContext } from '../context.ts';
import { bindTargets } from '../statements/variables.ts';

export function lowerSelect(context: FunctionContext, node: Select): Register {
  const { code } = context;
  const cases = node.cases
    .filter((each) => each.kind === 'SelectCase')
    .map((selectCase) => ({ selectCase, code: caseCode(context, selectCase) }));
  const otherwise = node.elseClause === undefined ? undefined : code.newLabel();
  code.select(
    cases.map((each) => each.code),
    otherwise,
    node.span,
  );
  const result = code.allocate();
  const end = code.newLabel();
  const branch = (target: Label, body: Block, enter: () => void) => {
    code.place(target);
    enter();
    code.emit({ kind: 'move', span: body.span, dst: result, src: context.block(body) });
    code.jump(end, body.span);
  };
  for (const { selectCase, code: written } of cases) {
    branch(written.target, selectCase.body, () => {
      if (written.bind !== undefined) {
        bindTargets(context, selectCase, written.bind, selectCase.span);
      }
    });
  }
  if (otherwise !== undefined && node.elseClause !== undefined) {
    branch(otherwise, node.elseClause.body, () => undefined);
  }
  code.place(end);
  return result;
}

/** A case's future, computed in place, with the registers it created and its `as` register. */
function caseCode(context: FunctionContext, selectCase: SelectCase): SelectCaseCode {
  const { result: future, registers: holds } = context.code.allocating(() =>
    context.expression(selectCase.future),
  );
  return {
    future,
    holds,
    bind: selectCase.binding === undefined ? undefined : context.code.allocate(),
    target: context.code.newLabel(),
  };
}
