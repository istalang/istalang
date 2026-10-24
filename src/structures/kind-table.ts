/**
 * Tables with one handler per kind of a discriminated union: tree nodes for every phase that walks
 * the tree, instructions for load validation and the interpreter (architecture: Registries).
 *
 * A table is exhaustive by type: a new kind fails to compile until every table over its union says
 * what to do with it, which a `switch` with a `default` would let slip. Each handler receives the
 * item narrowed to its kind, after the table's own context; a table that needs none takes
 * `undefined`.
 */

/** One handler per kind of `Item`, each called with the table's context and the narrowed item. */
export type Handlers<
  Context,
  Item extends { readonly kind: string },
  Args extends readonly unknown[],
  Result,
> = {
  readonly [Kind in Item['kind']]: (
    context: Context,
    item: Extract<Item, { readonly kind: Kind }>,
    ...args: Args
  ) => Result;
};

/** The handler of `item`'s kind, typed for the item as its union sees it. */
export function handlerOf<
  Context,
  Item extends { readonly kind: string },
  Args extends readonly unknown[],
  Result,
>(
  handlers: Handlers<Context, Item, Args, Result>,
  item: Item,
): (context: Context, item: Item, ...args: Args) => Result {
  const kind: Item['kind'] = item.kind;
  return handlers[kind] as (context: Context, item: Item, ...args: Args) => Result;
}
