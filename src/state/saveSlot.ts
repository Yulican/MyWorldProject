import { Directory, File, Paths } from 'expo-file-system';
import type { SaveSlot } from './saveGame';

// The save game as a file in the app's storage (expo-file-system). A write
// goes to a temporary file first, which then replaces the save by a move
// (Requirement Speichern und Laden 3: a crash never destroys the old save).
// The move deletes the old save just before it renames the new one; a
// crash in between leaves only the complete temporary file, which reading
// takes then (and moves into place). Each kind of write has its own
// temporary file, and a write that finishes after a newer one has been
// moved into place is dropped, so an older world never replaces a newer one.

/** The player's slot: one save game in the app's documents. */
export function fileSlot(name = 'world.sav', directory: Directory = Paths.document): SaveSlot {
  const slotFile = () => new File(directory, name);
  const tempNames = [`${name}.tmp`, `${name}.now.tmp`];
  let started = 0;
  let committed = 0;
  let queue: Promise<void> = Promise.resolve();

  /** Moves a complete temporary file into place, unless a newer write already is. */
  const commit = (temp: File, id: number) => {
    if (id < committed) {
      temp.delete();
      return;
    }
    temp.moveSync(slotFile(), { overwrite: true });
    committed = id;
  };
  const freshTemp = (tempName: string) => {
    const temp = new File(directory, tempName);
    if (temp.exists) temp.delete();
    temp.create();
    return temp;
  };
  /** The save, or after a crash between delete and rename the temporary file left (the newer one). */
  const existing = (): File | null => {
    const file = slotFile();
    if (file.exists) return file;
    const temps = tempNames.map((n) => new File(directory, n)).filter((f) => f.exists && f.size > 0);
    temps.sort((a, b) => (b.lastModified ?? 0) - (a.lastModified ?? 0));
    return temps[0] ?? null;
  };

  return {
    async read() {
      const file = existing();
      return file ? await file.bytes() : null;
    },
    readSync() {
      const file = existing();
      return file ? file.bytesSync() : null;
    },
    write(world, trailer) {
      const id = ++started;
      // One write at a time into the temporary file; both parts are written off the JS thread.
      const done = queue.then(async () => {
        const temp = freshTemp(tempNames[0]);
        await temp.write(world);
        await temp.write(trailer, { append: true });
        commit(temp, id);
      });
      queue = done.catch(() => {});
      return done;
    },
    writeSync(world, trailer) {
      const id = ++started;
      const temp = freshTemp(tempNames[1]);
      temp.writeSync(world);
      temp.writeSync(trailer, { append: true });
      commit(temp, id);
    },
  };
}

/** The benchmark's own file (in the cache), never the player's slot. */
export function benchSlot(): SaveSlot {
  return fileSlot('bench.sav', Paths.cache);
}
