/**
 * The checker's diagnostics of the host boundary, codes 5900–5999 (§3.6, §3.16, §9): externs a
 * host implements, JSON forms and annotations. A part of the checker's one catalog (index.ts).
 */

export const boundaryTemplates = {
  noJsonForm: {
    code: 5900,
    message: (type: string, reason: string) =>
      `${type} crosses to the host as JSON, but it has no JSON form: ${reason}.`,
  },
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
      `A field '@JsonSkip' leaves out reads back as none, [] or [:], and ${type} is none of an optional, an Array or a Map.`,
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
  unprintableOutcome: {
    code: 5909,
    message: (type: string, reason: string) =>
      `'main' gives ${type}, which its host reads as JSON, but it has no JSON form: ${reason}.`,
  },
  disposableSendable: {
    code: 5910,
    message: (type: string) =>
      `${type} is declared sendable, so a 'dispose' can't make it disposable: a disposable value has an identity of its own, which never leaves its instance.`,
  },
  resourceConstant: {
    code: 5911,
    message: (type: string) =>
      `An extern constant is read once and the same value given to every read, so it can't hold ${type}, whose values each have an identity of their own.`,
  },
} as const;
