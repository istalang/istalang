/**
 * Tables with one handler per node kind, for every phase that walks the tree (architecture:
 * Registries).
 *
 * A table is exhaustive by type: a new node kind fails to compile until every table over its
 * category says what to do with it, which a `switch` with a `default` would let slip. Each handler
 * receives the node narrowed to its kind, after the phase's own context.
 */

/** One handler per kind of `Node`, each called with the phase's context and the narrowed node. */
export type Handlers<
  Context,
  Node extends { readonly kind: string },
  Args extends readonly unknown[],
  Result,
> = {
  readonly [Kind in Node['kind']]: (
    context: Context,
    node: Extract<Node, { readonly kind: Kind }>,
    ...args: Args
  ) => Result;
};

/** The handler of `node`'s kind, typed for the node as its category sees it. */
export function handlerOf<
  Context,
  Node extends { readonly kind: string },
  Args extends readonly unknown[],
  Result,
>(
  handlers: Handlers<Context, Node, Args, Result>,
  node: Node,
): (context: Context, node: Node, ...args: Args) => Result {
  const kind: Node['kind'] = node.kind;
  return handlers[kind] as (context: Context, node: Node, ...args: Args) => Result;
}
