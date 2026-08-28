/**
 * A tiny, dependency-free, deterministic ZIP writer.
 *
 * The dev box has no `zip` binary, and the three stores all care about the
 * exact shape of the archive they are handed:
 *
 *   - files must sit at the archive ROOT (no leading `dist/`), or Chrome and
 *     Safari both report "manifest file is missing or unreadable";
 *   - no `__MACOSX`, `.DS_Store` or directory entries, which AMO's linter
 *     flags as unexpected files;
 *   - a byte-identical archive for the same input, so a re-run of the release
 *     can be compared against what was actually uploaded. Every entry is
 *     therefore stamped with a fixed DOS timestamp rather than mtime.
 *
 * Only the two things a store package ever needs are implemented: STORED (0)
 * for already-compressed bytes and DEFLATE (8) for everything else.
 */

import { deflateRawSync } from 'node:zlib';
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/** 2020-01-01 00:00:00, encoded as DOS date/time. Fixed so builds are reproducible. */
const DOS_TIME = 0;
const DOS_DATE = ((2020 - 1980) << 9) | (1 << 5) | 1;

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/**
 * Files a store package must never contain. Keeping this at the writer means
 * every caller — extension package, AMO source archive — gets the same filter.
 */
const EXCLUDED = new Set(['.DS_Store', 'Thumbs.db', '__MACOSX', '.git', 'node_modules']);

/**
 * Walk `dir` and return `{ name, data }` entries with POSIX-separated names
 * relative to `dir`, sorted so the archive order is stable.
 */
export function collect(dir, { exclude = [] } = {}) {
  const entries = [];
  const skip = new Set([...EXCLUDED, ...exclude]);

  function walk(current) {
    for (const item of readdirSync(current).sort()) {
      if (skip.has(item)) continue;
      const full = join(current, item);
      const stat = statSync(full);
      if (stat.isDirectory()) walk(full);
      else if (stat.isFile()) {
        entries.push({ name: relative(dir, full).split(sep).join('/'), data: readFileSync(full) });
      }
    }
  }

  walk(dir);
  return entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/**
 * Write `entries` ([{ name, data }]) to `outPath` as a ZIP archive.
 * Returns the archive size in bytes.
 */
export function writeZip(outPath, entries) {
  const locals = [];
  const central = [];
  let offset = 0;

  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const deflated = deflateRawSync(data, { level: 9 });
    // Never let "compression" make an entry bigger than the original.
    const stored = deflated.length >= data.length;
    const body = stored ? data : deflated;
    const method = stored ? 0 : 8;
    const crc = crc32(data);

    const local = Buffer.alloc(30 + nameBuf.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28); // extra field length
    nameBuf.copy(local, 30);

    locals.push(local, body);

    const dirEntry = Buffer.alloc(46 + nameBuf.length);
    dirEntry.writeUInt32LE(0x02014b50, 0);
    dirEntry.writeUInt16LE(20, 4); // version made by
    dirEntry.writeUInt16LE(20, 6); // version needed
    dirEntry.writeUInt16LE(0, 8);
    dirEntry.writeUInt16LE(method, 10);
    dirEntry.writeUInt16LE(DOS_TIME, 12);
    dirEntry.writeUInt16LE(DOS_DATE, 14);
    dirEntry.writeUInt32LE(crc, 16);
    dirEntry.writeUInt32LE(body.length, 20);
    dirEntry.writeUInt32LE(data.length, 24);
    dirEntry.writeUInt16LE(nameBuf.length, 28);
    dirEntry.writeUInt16LE(0, 30); // extra
    dirEntry.writeUInt16LE(0, 32); // comment
    dirEntry.writeUInt16LE(0, 34); // disk number
    dirEntry.writeUInt16LE(0, 36); // internal attrs
    dirEntry.writeUInt32LE(0o644 << 16, 38); // external attrs: regular file, rw-r--r--
    dirEntry.writeUInt32LE(offset, 42);
    nameBuf.copy(dirEntry, 46);
    central.push(dirEntry);

    offset += local.length + body.length;
  }

  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  const archive = Buffer.concat([...locals, centralBuf, end]);
  writeFileSync(outPath, archive);
  return archive.length;
}
