/**
 * Where what registers hold is let go (docs/arch/definition.md, "Frames"; spec §3.4, §7): the end
 * of a scope, and the end of a header. Every construct that opens a scope or evaluates a header
 * ends it through here, so the release points are emitted one way.
 *
 * - A scope's end keeps what its held variables hold (`hold let`, `hold const`, `hold _`) into
 *   their hold scopes' lists, then releases every variable it declared.
 * - A header, such as a condition or a `match` subject, ends before what it leads to: its
 *   temporaries are released on every path out of it, instead of at its statement's end.
 */

import type { Register } from '../../../definition/operands.ts';
import type { Span } from '../../../text/span.ts';
import type { FunctionContext } from '../context.ts';
import type { BlockScope } from './variables.ts';

/** Ends `scope`: keeps what its held variables hold, then releases every variable. */
export function endScope(context: FunctionContext, scope: BlockScope, span: Span): void {
  const lists = Map.groupBy(scope.kept, (kept) => kept.into);
  for (const [into, kept] of lists) {
    context.code.emit({
      kind: 'keep',
      span,
      registers: kept.map(({ register }) => register),
      into,
    });
  }
  release(context, scope.declared, span);
}

/**
 * Lowers a header with `header`; its value, and its temporaries, which every path out of it
 * releases (`release`) instead of its statement.
 */
export function headerTemporaries(
  context: FunctionContext,
  header: () => Register,
): { readonly result: Register; readonly temporaries: readonly Register[] } {
  const { result, registers } = context.code.allocating(header);
  return { result, temporaries: context.variables.temporariesAmong(registers) };
}

/** A scope entered through a header that may not hold: an `if` branch, a `while` pass, a guarded case. */
export interface Guarded {
  /** What runs in the scope before the header: a case's tests and bindings. */
  readonly before?: () => void;
  /** The header, whose value decides: a condition or a guard. */
  readonly header: () => Register;
  /** What runs when the header holds; the scope ends after it. */
  readonly body: () => void;
  /** Where the body goes once its scope has ended, such as past the other branches. */
  readonly leave: () => void;
  readonly span: Span;
}

/**
 * Lowers `guarded`: its scope, the header's temporaries released before the body, and after it
 * the path where the header doesn't hold, which releases the scope's variables and the header's
 * temporaries and goes on from there.
 */
export function lowerGuarded(context: FunctionContext, guarded: Guarded): void {
  const { code } = context;
  const holds = code.newLabel();
  const fails = code.newLabel();
  const { scope, result: temporaries } = context.variables.inBlock(() => {
    guarded.before?.();
    const header = headerTemporaries(context, guarded.header);
    code.branch(header.result, holds, fails, guarded.span);
    code.place(holds);
    release(context, header.temporaries, guarded.span);
    guarded.body();
    return header.temporaries;
  });
  endScope(context, scope, guarded.span);
  guarded.leave();
  code.place(fails);
  release(context, [...scope.declared, ...temporaries], guarded.span);
}

/** Emits a release of `registers`, if there are any. */
export function release(
  context: FunctionContext,
  registers: readonly Register[],
  span: Span,
): void {
  if (registers.length > 0) {
    context.code.emit({ kind: 'release', span, registers: [...registers] });
  }
}
