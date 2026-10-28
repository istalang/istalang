/**
 * Generic functions that would need endlessly many instantiations (§3.5): `f<T>` calling
 * `f<Array<T>>` never stops making new ones.
 *
 * The expansion graph (types/expansion-edges.ts) takes its edges from calls here: a call inside
 * generic `F` to generic `G` gives `G`'s type parameters arguments built from `F`'s, and an
 * expanding edge on a cycle is reported at the call that makes it. Every call a function's code
 * makes counts: its
 * body's and its parameters' defaults', the calls the language makes for a construct, the defaults
 * a struct literal leaves fields to, and the calls a witness makes. The functions a struct's
 * fields read as (§3.1) are nodes too, so a cycle through a field's default is one like any.
 *
 * Checking stays lazy. A module's diagnostics follow edges only from its own generic functions,
 * so only the bodies those edges reach are checked. Every cycle through one of the module's calls
 * is among them, since a cycle comes back to where it starts. Each function's edges are found
 * once per checker, by whichever module reaches it first.
 */

import { memo } from '../../../structures/memo.ts';
import { type ModuleId, programModule } from '../../program/program.ts';
import { type FunctionDeclaration, typeParametersOf } from '../../syntax/declarations.ts';
import { functionsOf } from '../../syntax/field-defaults.ts';
import type { NodeOf } from '../../syntax/node.ts';
import type { CheckerContext } from '../context.ts';
import { checkerDiagnostics } from '../diagnostics/index.ts';
import type { FunctionCall, ResolvedCall } from '../resolved-call.ts';
import { type ArgumentEdge, argumentEdges, endlessEdges } from '../types/expansion-edges.ts';
import type { ParameterKey } from '../types/type.ts';

interface Edge extends ArgumentEdge {
  readonly caller: FunctionDeclaration;
  readonly callee: FunctionDeclaration;
  readonly site: NodeOf<string>;
}

/** The expansion rule over one checker's program. */
export class Expansion {
  readonly #checker: CheckerContext;
  readonly #edges = new Map<FunctionDeclaration, readonly Edge[]>();
  #generic: ReadonlySet<FunctionDeclaration> | undefined;

  constructor(checker: CheckerContext) {
    this.#checker = checker;
  }

  /** Reports every call in a generic function of `module` that makes an expanding cycle. */
  check(module: ModuleId): void {
    const { root } = programModule(this.#checker.program, module).tree;
    const own = new Set(functionsOf(root).filter(isGeneric));
    const reported = new Set<NodeOf<string>>();
    for (const edge of endlessEdges(this.#reachedFrom(own))) {
      if (own.has(edge.caller) && !reported.has(edge.site)) {
        reported.add(edge.site);
        this.#checker.report(
          module,
          checkerDiagnostics.expandingInstantiation(edge.site.span, edge.caller.name.text),
        );
      }
    }
  }

  /** The edges of `roots`, and of every generic function those edges lead to. */
  #reachedFrom(roots: ReadonlySet<FunctionDeclaration>): readonly Edge[] {
    const generic = this.#programGeneric();
    const visited = new Set<FunctionDeclaration>();
    const pending = [...roots];
    const edges: Edge[] = [];
    for (let caller = pending.pop(); caller !== undefined; caller = pending.pop()) {
      if (!visited.has(caller)) {
        visited.add(caller);
        const own = this.#edgesOf(caller);
        edges.push(...own);
        pending.push(...own.map((edge) => edge.callee).filter((callee) => generic.has(callee)));
      }
    }
    return edges;
  }

  #edgesOf(caller: FunctionDeclaration): readonly Edge[] {
    return memo(this.#edges, caller, () => callerEdges(this.#checker, caller));
  }

  /** The program's generic functions, whose type parameters are the graph's nodes. */
  #programGeneric(): ReadonlySet<FunctionDeclaration> {
    this.#generic ??= new Set(
      [...this.#checker.program.modules.values()].flatMap((module) =>
        functionsOf(module.tree.root).filter(isGeneric),
      ),
    );
    return this.#generic;
  }
}

function isGeneric(declaration: FunctionDeclaration): boolean {
  return declaration.typeParameters.length > 0;
}

function callerEdges(checker: CheckerContext, caller: FunctionDeclaration): readonly Edge[] {
  const own = new Set<ParameterKey>(typeParametersOf(caller.typeParameters));
  const bodies = [checker.bodyOf(caller), checker.defaultsOf(caller)];
  const calls = bodies.flatMap((body) => body?.madeCalls() ?? []);
  return calls.flatMap(({ site, call }) =>
    callsWithin(call).flatMap((each) =>
      argumentEdges(own, each.function.typeParameters, each.typeArguments).map((edge) => ({
        ...edge,
        caller,
        callee: each.function,
        site,
      })),
    ),
  );
}

/** A function call, and every call its witnesses make, as calls of declared functions. */
function callsWithin(call: ResolvedCall): readonly FunctionCall[] {
  if (call.kind !== 'function') {
    return [];
  }
  const witnessCalls = [...call.witnesses.values()].flat(2).flatMap(callsWithin);
  return [call, ...witnessCalls];
}
