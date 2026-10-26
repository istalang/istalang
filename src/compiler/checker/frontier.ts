/**
 * The checker's frontier (architecture, Registries): every construct narrower than a node kind that
 * the checker reports as not supported yet, named once. The slice that lifts a construct deletes
 * its key, and the compiler then finds every place that reported it.
 */

/** The constructs, narrower than a node kind, reported as not supported yet. */
export const frontier = {
  spreadArgument: 'A spread argument',
  restParameter: 'Rest parameter',
} as const;

/** A construct `frontier` names. */
export type FrontierConstruct = (typeof frontier)[keyof typeof frontier];
