/**
 * Generic functions that would need endlessly many instantiations (§3.5): generics compile per
 * instantiation, so `f<T>` calling `f<Array<T>>` never stops making new ones.
 *
 * The rule is the one .NET applies to generic expansion. The type parameters of the program's
 * generic functions are the nodes of a graph; a call inside generic `F` to generic `G` adds an
 * edge from each type parameter of `F` that a type argument mentions to the parameter of `G` it
 * is given for, an expanding edge when the parameter is nested inside the argument rather than
 * being the whole of it. Instantiation is endless exactly when a cycle holds an expanding edge,
 * which is reported at the call that makes it. Calls a witness makes count as calls too.
 */

import type { FunctionDeclaration, TypeParameter } from '../../syntax/declarations.ts';
import type { CallSite, FunctionCall, ResolvedCall } from '../check.ts';
import type { CheckerContext } from '../context.ts';
import { typeParametersOf } from '../declarations/resolve-type.ts';
import { checkerDiagnostics } from '../diagnostics.ts';
import { errorType, type ParameterKey, parametersIn, type Type } from '../types/type.ts';

interface Edge {
  readonly from: TypeParameter;
  readonly to: TypeParameter;
  readonly expanding: boolean;
  readonly caller: FunctionDeclaration;
  readonly site: CallSite;
}

const checked = new WeakSet<CheckerContext>();

/**
 * Reports every call that makes an expanding cycle, in the module of its caller. It is a property
 * of the whole program, so it is checked once per checker, whichever module asks first.
 */
export function checkExpansion(checker: CheckerContext): void {
  if (checked.has(checker)) {
    return;
  }
  checked.add(checker);
  const edges = programEdges(checker);
  const components = new Components(edges);
  const reported = new Set<CallSite>();
  for (const edge of edges) {
    const inCycle = components.of(edge.from) === components.of(edge.to);
    if (edge.expanding && inCycle && !reported.has(edge.site)) {
      reported.add(edge.site);
      checker.report(
        checker.moduleOf(edge.caller),
        checkerDiagnostics.expandingInstantiation(edge.site.span, edge.caller.name.text),
      );
    }
  }
}

function programEdges(checker: CheckerContext): readonly Edge[] {
  const edges: Edge[] = [];
  for (const module of checker.program.modules.values()) {
    for (const item of module.tree.root.items) {
      if (item.kind === 'FunctionDeclaration' && item.typeParameters.length > 0) {
        edges.push(...callerEdges(checker, item));
      }
    }
  }
  return edges;
}

function callerEdges(checker: CheckerContext, caller: FunctionDeclaration): readonly Edge[] {
  const own = new Set<ParameterKey>(typeParametersOf(caller.typeParameters));
  const calls = checker.bodyOf(caller)?.calls ?? new Map<CallSite, ResolvedCall>();
  return [...calls].flatMap(([site, call]) =>
    callsWithin(call).flatMap((each) =>
      typeParametersOf(each.function.typeParameters).flatMap((to, index) => {
        const argument = each.typeArguments[index] ?? errorType;
        return parametersIn(argument)
          .filter((from): from is TypeParameter => own.has(from))
          .map((from) => ({ from, to, caller, site, expanding: !isWhole(argument, from) }));
      }),
    ),
  );
}

/** Whether `argument` is the parameter `from` itself, rather than a type built around it. */
function isWhole(argument: Type, from: TypeParameter): boolean {
  return argument.kind === 'parameter' && argument.declaration === from;
}

/** A function call, and every call its witnesses make, as calls of declared functions. */
function callsWithin(call: ResolvedCall): readonly FunctionCall[] {
  if (call.kind !== 'function') {
    return [];
  }
  const witnessCalls = [...call.witnesses.values()].flat(2).flatMap(callsWithin);
  return [call, ...witnessCalls];
}

/** The strongly connected components of the edges' graph, each named by its root (Tarjan). */
class Components {
  readonly #successors = new Map<TypeParameter, TypeParameter[]>();
  readonly #order = new Map<TypeParameter, number>();
  readonly #lowest = new Map<TypeParameter, number>();
  readonly #component = new Map<TypeParameter, TypeParameter>();
  readonly #stack: TypeParameter[] = [];

  constructor(edges: readonly Edge[]) {
    for (const { from, to } of edges) {
      this.#successors.set(from, [...(this.#successors.get(from) ?? []), to]);
      this.#successors.set(to, this.#successors.get(to) ?? []);
    }
    for (const node of this.#successors.keys()) {
      if (!this.#order.has(node)) {
        this.#visit(node);
      }
    }
  }

  of(node: TypeParameter): TypeParameter | undefined {
    return this.#component.get(node);
  }

  #visit(node: TypeParameter): void {
    const position = this.#order.size;
    this.#order.set(node, position);
    this.#lowest.set(node, position);
    this.#stack.push(node);
    for (const next of this.#successors.get(node) ?? []) {
      if (!this.#order.has(next)) {
        this.#visit(next);
      }
      if (!this.#component.has(next)) {
        this.#lower(node, this.#lowest.get(next) ?? position);
      }
    }
    if (this.#lowest.get(node) === position) {
      this.#close(node);
    }
  }

  #lower(node: TypeParameter, to: number): void {
    this.#lowest.set(node, Math.min(this.#lowest.get(node) ?? to, to));
  }

  /** Pops the component rooted at `root` off the stack. */
  #close(root: TypeParameter): void {
    let member = this.#stack.pop();
    while (member !== undefined) {
      this.#component.set(member, root);
      member = member === root ? undefined : this.#stack.pop();
    }
  }
}
