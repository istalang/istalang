/**
 * The kinds of token highlighting tells apart. They are the standard names editors already theme
 * (LSP's semantic token types, and VS Code's `label`), so a client colors them with no setup.
 */

export const semanticTypes = [
  'keyword',
  'type',
  'struct',
  'enum',
  'interface',
  'typeParameter',
  'function',
  'method',
  'parameter',
  'variable',
  'property',
  'enumMember',
  'namespace',
  'decorator',
  'label',
  'string',
  'number',
  'comment',
  'operator',
] as const;

export type SemanticType = (typeof semanticTypes)[number];
