/**
 * Reading a signature help answer as a test states it: the active signature's label and its active
 * parameter's text, however the server marks the parameter (by text or by offsets into the label).
 */

import type { SignatureHelp } from 'vscode-languageserver/node';

/** The active signature's label and its active parameter's text; empty strings where there is none. */
export function activeOf(help: SignatureHelp | null) {
  const signature = help?.signatures[help.activeSignature ?? 0];
  const parameter = signature?.parameters?.[help?.activeParameter ?? -1]?.label;
  const text = Array.isArray(parameter) ? signature?.label.slice(...parameter) : parameter;
  return { label: signature?.label ?? '', parameter: text ?? '' };
}
