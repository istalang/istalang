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
  unwrapPart: "Changing a part of a value through '$'",
  heldFuture: 'A future that is neither awaited nor returned',
  hostExtern: 'Calling an extern function the host implements',
  staticMember: 'A static member',
  functionValue: 'A function value',
  externConstant: 'An extern constant',
  functionValueCall: 'Calling a function value',
  spreadArgument: 'A spread argument',
  restParameter: 'Rest parameter',
  nullishOperator: "The '??' operator",
  optionalChaining: "The '?.' operator",
  sharedValue: "A 'Shared' value",
} as const;

/** A construct `frontier` names. */
export type FrontierConstruct = (typeof frontier)[keyof typeof frontier];
