/**
 * Where a project's texts come from: the disk, or an editor's open documents laid over it.
 *
 * The file loader owns the toolchain's path syntax (file-loader.ts); this seam only says whether a
 * file is there and what it holds, so open documents are served by the same loader, under the same
 * ids and names, as the files they stand for. An open document counts as a file even before it is
 * saved, so a new module can be imported while it is being written.
 */

import { readFileSync, statSync } from 'node:fs';
import { isSystemError } from './errno.ts';

/** The files of a project, by absolute path. */
export interface ProjectFiles {
  readonly isFile: (path: string) => boolean;
  /** The text of the file at `path`; the system refusing it throws, for the app to report. */
  readonly read: (path: string) => string;
}

/** The files on disk. A path through something that isn't a directory names no file. */
export const diskFiles: ProjectFiles = {
  isFile: (path) => {
    try {
      return statSync(path, { throwIfNoEntry: false })?.isFile() ?? false;
    } catch (error) {
      if (isSystemError(error) && error.code === 'ENOTDIR') {
        return false;
      }
      throw error;
    }
  },
  read: (path) => readFileSync(path, 'utf8'),
};

/** `files`, with the texts in `open`, by absolute path, in place of theirs or beside them. */
export function overlaidFiles(
  open: ReadonlyMap<string, string>,
  files: ProjectFiles = diskFiles,
): ProjectFiles {
  return {
    isFile: (path) => open.has(path) || files.isFile(path),
    read: (path) => open.get(path) ?? files.read(path),
  };
}
