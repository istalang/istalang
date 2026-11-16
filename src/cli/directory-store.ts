/**
 * The instance store behind `ista run --store <dir>`: a Definition's bytes at
 * `definitions/<hash>.bin`, an instance's snapshot at `instances/<name>.json`, and the types its
 * host's externs declare at `externs.json`, each as the runtime writes it (runtime/store.ts).
 *
 * Each write goes to a temporary file in the same directory, which is then renamed over the old
 * one. A rename within one file system is atomic, so a crash mid-write leaves the previous commit
 * in place, which is what a commit promises (§5). Names are percent-encoded into file names, so no
 * instance name can reach outside its directory.
 */

import { mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { isSystemError } from '../project/errno.ts';
import type { InstanceStore } from '../runtime/store.ts';

export function directoryStore(directory: string): InstanceStore {
  const definitions = join(directory, 'definitions');
  const instances = join(directory, 'instances');
  return {
    readDefinition: (hash) => readIfPresent(fileIn(definitions, hash, binary)),
    writeDefinition: (hash, bytes) => {
      writeAtomically(definitions, fileIn(definitions, hash, binary), bytes);
    },
    readSnapshot: (instance) => readTextIfPresent(fileIn(instances, instance, json)),
    writeSnapshot: (instance, text) => {
      writeAtomically(instances, fileIn(instances, instance, json), text);
    },
    instances: () => storedNames(instances),
    readExterns: () => readTextIfPresent(join(directory, externsFile)),
    writeExterns: (text) => {
      writeAtomically(directory, join(directory, externsFile), text);
    },
  };
}

const json = '.json';
const binary = '.bin';
const externsFile = `externs${json}`;

function fileIn(directory: string, name: string, extension: string): string {
  return join(directory, `${encodeURIComponent(name)}${extension}`);
}

/** The names of the instances `directory` keeps, decoded from their files' names. */
function storedNames(directory: string): readonly string[] {
  let files: readonly string[];
  try {
    files = readdirSync(directory);
  } catch (error) {
    if (isSystemError(error) && error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
  return files.flatMap((file) =>
    file.endsWith(json) ? [decodeURIComponent(file.slice(0, -json.length))] : [],
  );
}

function readTextIfPresent(file: string): string | undefined {
  return readIfPresent(file)?.toString('utf8');
}

function readIfPresent(file: string): Buffer | undefined {
  try {
    return readFileSync(file);
  } catch (error) {
    if (isSystemError(error) && error.code === 'ENOENT') {
      return undefined;
    }
    throw error;
  }
}

function writeAtomically(directory: string, file: string, data: string | Uint8Array): void {
  mkdirSync(directory, { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  writeFileSync(temporary, data);
  renameSync(temporary, file);
}
