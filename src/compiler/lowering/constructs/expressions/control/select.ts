/**
 * `select` (§8): each case's awaitable in source order, then a wait on them, opened as an `await`'s
 * is (await.ts), and one `select` instruction that waits for it, or with `otherwise` chooses at
 * once, and jumps to the case it picks.
 *
 * - A case holds the registers its expression created, which losing releases (§8). A future read
 *   from a variable lives in the variable's register, which the case didn't create, so it survives
 *   a loss and can race again. The winner's holdings move to the block enclosing the `select`, so
 *   they are variables of that block with no name, which its end releases.
 * - The value a case's future gives arrives in its `bind` register; its body, a scope of its own,
 *   declares `as name` as a target of the case (variables.ts), then runs and writes the select's
 *   value.
 * - Without `await`, `else` is where the select goes when no case's future has resolved.
 */

import type { Register } from '../../../../../definition/operands.ts';
import type { Select, SelectCase } from '../../../../syntax/expressions/index.ts';
import { selectCasesOf } from '../../../../syntax/expressions/readings.ts';
import type { Block } from '../../../../syntax/statements/index.ts';
import { openWait } from '../../../calls/waits.ts';
import type { FunctionContext } from '../../../context.ts';
import type { Label, SelectCaseCode } from '../../../functions/code-writer.ts';
import { endScope } from '../../statements/scopes.ts';
import { bindTargets } from '../../statements/variables.ts';
import { awaitedAt } from './await.ts';

export function lowerSelect(context: FunctionContext, node: Select): Register {
  const { code } = context;
  const cases = selectCasesOf(node).map((selectCase) => ({
    selectCase,
    code: caseCode(context, selectCase),
  }));
  if (cases.length === 0 && node.elseClause !== undefined) {
    return context.block(node.elseClause.body);
  }
  for (const { code: written } of cases) {
    for (const register of written.holds) {
      context.variables.declareUnnamed(register);
    }
  }
  const wait = openWait(
    context,
    cases.map(({ selectCase, code: written }) => awaitedAt(context, selectCase, written.awaited)),
    node.span,
  );
  const otherwise = node.elseClause === undefined ? undefined : code.newLabel();
  code.select(
    wait,
    cases.map((each) => each.code),
    otherwise,
    node.span,
  );
  const result = code.allocate();
  const end = code.newLabel();
  const branch = (target: Label, body: Block, enter: () => void) => {
    code.place(target);
    const { scope } = context.variables.inBlock(() => {
      enter();
      code.emit({ kind: 'move', span: body.span, dst: result, src: context.block(body) });
    });
    endScope(context, scope, body.span);
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

/** A case written: its code, and the register of what it waits on. */
interface CaseCode extends SelectCaseCode {
  readonly awaited: Register;
}

/** A case's awaitable, computed in place, with the registers it created and its `as` register. */
function caseCode(context: FunctionContext, selectCase: SelectCase): CaseCode {
  const { result: awaited, registers: holds } = context.code.allocating(() =>
    context.expression(selectCase.future),
  );
  return {
    awaited,
    holds,
    bind: selectCase.binding === undefined ? undefined : context.code.allocate(),
    target: context.code.newLabel(),
  };
}
