/**
 * The checker's diagnostics of templates, codes 5060–5079 (§2): what a template's values need. A
 * part of the checker's one catalog (index.ts).
 */

export const templateTemplates = {
  notStringable: {
    code: 5060,
    message: (type: string) =>
      `A template writes each value as text with its toString, and no 'toString' takes ${type} and gives a string (§2).`,
  },
};
