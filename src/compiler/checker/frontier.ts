/**
 * The checker's frontier (architecture, Registries): every construct narrower than a node kind that
 * the checker reports as not supported yet, named once. The slice that lifts a construct deletes
 * its key, and the compiler then finds every place that reported it.
 */

/** The constructs, narrower than a node kind, reported as not supported yet. */
export const frontier = {
  heldByFunction: 'A variable held by the function',
  elementAssignment: 'Assigning to an element',
  elementReference: 'Passing an element by reference',
  unwrapPart: "Passing a '$' value, or part of one, by reference",
  sharedValueField: "Reading a 'Shared' value as '.value' (write '$')",
  heldFuture: 'A future that is neither awaited nor returned',
  hostExtern: 'Calling an extern function the host implements',
  externConstant: 'An extern constant',
  spreadArgument: 'A spread argument',
  restParameter: 'Rest parameter',
  dropVariable: 'Dropping a variable',
} as const;

/** A construct `frontier` names. */
export type FrontierConstruct = (typeof frontier)[keyof typeof frontier];
