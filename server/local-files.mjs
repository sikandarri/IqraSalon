import {mkdir, writeFile, lstat, unlink, open} from 'node:fs/promises';
import {constants} from 'node:fs';
import {resolve} from 'node:path';
import {Readable} from 'node:stream';
export function localFiles(directory) {
  const root = resolve(directory), path = key => { if (!/^salon\/[a-f0-9-]{36}$/.test(key)) throw new Error('Invalid file key'); return resolve(root, key); };
  return {
    async put(key, file) {
      await mkdir(resolve(root, 'salon'), {recursive: true, mode: 0o700});
      await writeFile(path(key), Buffer.from(await file.arrayBuffer()), {flag: 'wx', mode: 0o600});
    },
    async get(key, range) {
      const p = path(key); let handle;
      try { const info = await lstat(p); if (!info.isFile() || info.isSymbolicLink()) return null; handle = await open(p, constants.O_RDONLY | (constants.O_NOFOLLOW || 0)); }
      catch (error) { if (['ENOENT', 'ELOOP'].includes(error.code)) return null; throw error; }
      try {
        const info = await handle.stat();
        const options = range ? {start: range.offset, end: range.offset + range.length - 1} : {};
        return {body: Readable.toWeb(handle.createReadStream(options)), size: info.size, range};
      } catch (error) { await handle.close(); throw error; }
    },
    async remove(key) { await unlink(path(key)).catch(error => { if (error.code !== 'ENOENT') throw error; }); },
  };
}
