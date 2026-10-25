/**
 * The one diagnostic for constructs the checker doesn't handle yet (checkerDiagnostics
 * `notSupportedYet`), and the checker's whole frontier vocabulary.
 *
 * - A node kind the checker doesn't handle at all is named from its kind, so the handler tables can
 *   point any kind here without a message table to keep in step.
 * - Anything narrower is named from `frontier` (frontier.ts), the one list of what is reported
 *   this way.
 * This module goes with the last.
 */

import type { Diagnostic } from '../../diagnostics/diagnostic.ts';
import type { NodeOf } from '../syntax/node.ts';
import type { BodyContext } from './context.ts';
import { checkerDiagnostics } from './diagnostics/index.ts';
import type { FrontierConstruct } from './frontier.ts';
import type { Type } from './types/type.ts';

/**
 * `notSupportedYet` for `node`. The construct is named by `construct`, or else from the node's
 * kind: `MapLiteral` reads "Map literal".
 */
export function notSupported(node: NodeOf<string>, construct?: FrontierConstruct): Diagnostic {
  return checkerDiagnostics.notSupportedYet(node.span, construct ?? kindText(node.kind));
}

function kindText(kind: string): string {
  const words = kind.replaceAll(/(?<=[a-z])(?=[A-Z])/gu, ' ').toLowerCase();
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
}

/** The handler table entry of every kind the checker doesn't handle yet; the error type. */
export function unsupportedHandler(context: BodyContext, node: NodeOf<string>): Type {
  return context.unsupported(node);
}
