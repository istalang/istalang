/**
 * The instance store behind `ista run --store <dir>`: a Definition at `definitions/<hash>.json`,
 * an instance's snapshot at `instances/<name>.json`, both as the canonical texts the runtime
 * writes (runtime/store.ts).
 *
 * Each write goes to a temporary file in the same directory, which is then renamed over the old
 * one. A rename within one file system is atomic, so a crash mid-write leaves the previous commit
 * in place, which is what a commit promises (§5). Names are percent-encoded into file names, so no
 * instance name can reach outside its directory.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import type { InstanceStore } from '../runtime/store.ts';

export function directoryStore(directory: string): InstanceStore {
  const definitions = join(directory, 'definitions');
  const instances = join(directory, 'instances');
  return {
    readDefinition: (hash) => readIfPresent(fileIn(definitions, hash)),
    writeDefinition: (hash, text) => {
      writeAtomically(definitions, fileIn(definitions, hash), text);
    },
    readSnapshot: (instance) => readIfPresent(fileIn(instances, instance)),
    writeSnapshot: (instance, text) => {
      writeAtomically(instances, fileIn(instances, instance), text);
    },
  };
}

function fileIn(directory: string, name: string): string {
  return join(directory, `${encodeURIComponent(name)}.json`);
}

function readIfPresent(file: string): string | undefined {
  try {
    return readFileSync(file, 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return undefined;
    }
    throw error;
  }
}

function writeAtomically(directory: string, file: string, text: string): void {
  mkdirSync(directory, { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  writeFileSync(temporary, text);
  renameSync(temporary, file);
}
