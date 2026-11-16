/**
 * Waypoints (§10): the name a statement's `@Waypoint` gives where code inside it waits, which a
 * host inspecting a waiting instance reads. The innermost statement naming one counts; a function
 * or lambda boundary ends the search, as a nested function's waits are its own.
 */

import { programModule } from '../../program/program.ts';
import type { Statement } from '../../syntax/statements/index.ts';
import { ancestorsOf, type SyntaxNode } from '../../syntax/tree/index.ts';
import type { NodeOf } from '../../syntax/tree/node.ts';
import type { FunctionContext } from '../context.ts';

/** The name the innermost statement around `site` gives where it waits. */
export function waypointAt(context: FunctionContext, site: NodeOf<string>): string | undefined {
  const { checker, module } = context;
  const { tree } = programModule(checker.program, module);
  for (const node of ancestorsOf(tree, site as SyntaxNode)) {
    if (node.kind === 'Lambda' || node.kind === 'FunctionDeclaration') {
      return undefined;
    }
    const waypoint =
      'annotations' in node ? checker.annotations.waypointOf(module, node as Statement) : undefined;
    if (waypoint !== undefined) {
      return waypoint;
    }
  }
  return undefined;
}
