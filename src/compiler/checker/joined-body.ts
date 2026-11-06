/**
 * A body as tools read it at a node (§4): the passes of the field loops around the node read as
 * one, each fact joined as its entry says (body-facts.ts). A call can't join another into one, as
 * types join into a union, so where passes resolve one text differently, tools read every pass's
 * call: `show(v)` over a struct's `Int` and `String` fields calls both overloads. Lowering reads
 * each pass apart (check.ts `CheckedBody`), one call per site.
 */

import type { FunctionDeclaration } from '../syntax/declarations.ts';
import type { Lambda } from '../syntax/expressions/index.ts';
import type { NodeOf } from '../syntax/node.ts';
import type { BodyFacts, CheckedFunction } from './check.ts';
import type { ImplicitRole, ResolvedCall, ResolvedSite } from './resolved-call.ts';

/**
 * The facts a body answers as functions and calls, once per pass, by the name tools read every
 * pass's answer under.
 */
export const listedFacts = {
  resolved: 'callsAt',
  implicitCallOf: 'implicitCallsOf',
  functionOf: 'functionsOf',
} as const satisfies Partial<Record<keyof BodyFacts, keyof ListedFacts>>;

/** What tools read of a call or a function across passes: each distinct one a pass checked, in pass order. */
export interface ListedFacts {
  /** The functions `site` calls, or names as a value: each one a pass resolved it to. */
  readonly callsAt: (site: ResolvedSite) => readonly ResolvedCall[];
  /** The calls the language makes for `node` in `role` (`implicitCallOf`): each one a pass made. */
  readonly implicitCallsOf: (node: NodeOf<string>, role: ImplicitRole) => readonly ResolvedCall[];
  /** A lambda or local function as each pass checked it: one for each type it was checked as. */
  readonly functionsOf: (node: Lambda | FunctionDeclaration) => readonly CheckedFunction[];
}

/**
 * A body as tools read it at a node: the passes of the field loops around the node read as one
 * (§4), each fact joined as its entry says (body-facts.ts), calls and functions listed.
 */
export type JoinedBody = Omit<BodyFacts, keyof typeof listedFacts> & ListedFacts;
