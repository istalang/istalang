/**
 * The checker's frontier (architecture, Registries): every construct narrower than a node kind that
 * the checker reports as not supported yet, named once. The slice that lifts a construct deletes
 * its key, and the compiler then finds every place that reported it.
 */

/** The constructs, narrower than a node kind, reported as not supported yet. */
export const frontier = {
  destructuring: 'Destructuring',
  heldByFunction: 'A variable held by the function',
  partAssignment: 'Assigning to a part of a value',
  heldFuture: 'A future that is neither awaited nor returned',
  genericCall: 'Calling a generic function',
  reference: 'Passing a reference',
  hostExtern: 'Calling an extern function the host implements',
  shorthandField: 'A shorthand field',
  typeArgumentInference: 'Inferring type arguments',
  enumVariant: 'An enum variant',
  staticMember: 'A static member',
  functionValue: 'A function value',
  externConstant: 'An extern constant',
  conversion: 'A conversion',
  functionValueCall: 'Calling a function value',
  methodCall: 'Calling a method',
  spreadArgument: 'A spread argument',
  explicitTypeArguments: 'Explicit type arguments',
  restParameter: 'Rest parameter',
  defaultValue: 'Default value',
  arrayOrMapConstant: 'An array or map constant',
  nullishOperator: "The '??' operator",
  optionalChaining: "The '?.' operator",
  anonymousStructLiteral: "A 'struct{…}' literal",
} as const;

/** A construct `frontier` names. */
export type FrontierConstruct = (typeof frontier)[keyof typeof frontier];
