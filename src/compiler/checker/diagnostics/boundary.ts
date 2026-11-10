/**
 * The checker's diagnostics of the host boundary and of tests, codes 5900–5999 (§3.6, §3.16, §9,
 * §10): a part of the checker's one catalog (index.ts), a block of codes per family below. A type
 * that can't cross as JSON is a constraint not met (generics.ts).
 */

export const boundaryTemplates = {
  // The host boundary, 5900–5949 (§3.6, §3.16, §9): externs a host implements, and annotations.
  hostReference: {
    code: 5901,
    message: () =>
      "An extern the host implements can't take '&': its arguments cross as JSON, which the host can't write back.",
  },
  notAnnotation: {
    code: 5902,
    message: (found: string) => `An annotation is a struct value, and ${found} isn't one.`,
  },
  misplacedAnnotation: {
    code: 5903,
    message: (annotation: string, place: string) => `'@${annotation}' has no meaning on ${place}.`,
  },
  repeatedAnnotation: {
    code: 5904,
    message: (annotation: string) => `'@${annotation}' is already on this item.`,
  },
  skippedWithoutDefault: {
    code: 5905,
    message: (type: string) =>
      `A field '@JsonSkip' leaves out reads back as its type's default(), and ${type} isn't Default.`,
  },
  bigIntNotInt: {
    code: 5906,
    message: (type: string) =>
      `'@JsonBigInt' writes an int as a string, and this field is ${type}.`,
  },
  jsonNameClash: {
    code: 5907,
    message: (name: string) => `Another field already has the JSON name '${name}'.`,
  },
  waypointWithoutWait: {
    code: 5908,
    message: () =>
      "'@Waypoint' names where a statement waits, and this one has no 'await' or 'select'.",
  },
  annotationNotConstant: {
    code: 5909,
    message: () =>
      'An annotation needs a value compile time computes: literals, other constants, and structs, arrays and maps built from them.',
  },
  unconfinedDisposable: {
    code: 5910,
    message: (type: string) =>
      `A 'dispose' can't make ${type} disposable: a disposable value has an identity of its own, which never leaves its instance, so declare it 'extern shared struct' or 'extern live struct' (§3.6, §7).`,
  },
  resourceConstant: {
    code: 5911,
    message: (type: string) =>
      `An extern constant is read once and the same value given to every read, so it can't hold ${type}, whose values each have an identity of their own.`,
  },
  shapeFieldAnnotation: {
    code: 5912,
    message: () =>
      "A shape's field takes no annotation, since no declaration carries it; a field that needs one belongs to a struct.",
  },

  // Tests, 5950–5999 (§10): suite functions, and the testing module's calls whose arguments
  // its signatures can't constrain.
  suiteSignature: {
    code: 5950,
    message: () => "A suite is a plain 'fn' taking nothing and returning Array<Test>.",
  },
  suiteEffect: {
    code: 5951,
    message: () =>
      "A suite function only builds its list of tests: it can't call an extern or touch a handle, such as a shared struct or a slot, so every call builds the same list.",
  },
  mockTarget: {
    code: 5952,
    message: () =>
      "A mock's target must name a function: a lambda or a variable has no identity to replace, and a variant is built where it is called.",
  },
  handleOfNonExtern: {
    code: 5953,
    message: (type: string) =>
      `testing.handle makes a value of a host type, and ${type} isn't one.`,
  },
  mockLeavesDefaults: {
    code: 5954,
    message: (name: string) =>
      `A mock replaces '${name}' once its defaults are filled, so its replacement takes every parameter: name '${name}' at a type taking them all, not one leaving its defaults out.`,
  },
} as const;
