import { mkdirSync, promises as fs } from 'node:fs';
import { join } from 'node:path';
import type { FileRef } from '@onesaas/shared';
import { nanoid } from 'nanoid';
import sharp from 'sharp';
import type { Database } from '../db/connection.js';

// Local photo storage: resized bytes on disk under `dir`, one `files` row
// per photo. Assumes the `files` table exists (createRepo runs the DDL).

/** Rejected uploads: the routes map these to 400 with the message. */
export class FileRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FileRejectedError';
  }
}

/** Unknown file id (or bytes missing from disk): the route maps these to 404. */
export class FileNotFoundError extends Error {
  constructor(fileId: string) {
    super(`Unknown file: ${fileId}`);
    this.name = 'FileNotFoundError';
  }
}

export interface FileStore {
  /**
   * Store an uploaded photo: images become JPEG/PNG at most 2048px on a side
   * (EXIF-rotated first). Anything else is rejected with a readable error.
   * The optional id pins the row id (the sample-photo seed); default random.
   */
  saveUpload(buf: Buffer, mime: string, opts?: { id?: string }): Promise<FileRef>;
  /** Store model-made bytes as-is (already the right size), tagged by source. */
  saveGenerated(buf: Buffer, mime: string, source: string): Promise<FileRef>;
  read(fileId: string): Promise<{ buf: Buffer; mime: string }>;
  dataUrl(fileId: string): Promise<string>;
}

// HEIF brand codes (ISO BMFF ftyp box): heic/heix and friends, plus the
// generic mif1/msf1 brands phones sometimes write. AVIF (avif) is excluded:
// sharp reads it, so it converts like any other image.
const HEIC_BRANDS = new Set([
  'heic',
  'heix',
  'hevc',
  'hevx',
  'heim',
  'heis',
  'hevm',
  'hevs',
  'mif1',
  'msf1',
]);

// Detected from the BYTES (ftyp box), not assumed from sharp's build flags:
// when sharp cannot decode the buffer we still owe the owner the HEIC-specific
// message for HEIC bytes and the photo message for everything else.
function isHeicBytes(buf: Buffer, mime: string): boolean {
  if (mime === 'image/heic' || mime === 'image/heif') return true;
  if (buf.length < 12) return false;
  if (buf.subarray(4, 8).toString('ascii') !== 'ftyp') return false;
  return HEIC_BRANDS.has(buf.subarray(8, 12).toString('ascii'));
}

function extFor(mime: string): string {
  if (mime === 'image/png') return 'png';
  if (mime === 'image/jpeg') return 'jpg';
  if (mime === 'image/webp') return 'webp';
  if (mime === 'image/gif') return 'gif';
  return 'bin';
}

export function createFileStore(d: { db: Database; dir: string }): FileStore {
  const { db, dir } = d;

  async function persist(
    id: string,
    data: Buffer,
    mime: string,
    width: number | undefined,
    height: number | undefined,
    source: string,
  ): Promise<FileRef> {
    mkdirSync(dir, { recursive: true });
    const filename = `${id}.${extFor(mime)}`;
    await fs.writeFile(join(dir, filename), data);
    db.prepare(
      'INSERT OR REPLACE INTO files (id, path, mime, width, height, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(id, filename, mime, width ?? null, height ?? null, source, new Date().toISOString());
    return width === undefined || height === undefined
      ? { fileId: id, mime }
      : { fileId: id, mime, width, height };
  }

  async function saveUpload(buf: Buffer, mime: string, opts?: { id?: string }): Promise<FileRef> {
    // Convert FIRST, persist after: a disk failure must never be
    // misreported as "not a photo".
    let converted: { data: Buffer; mime: string; width: number; height: number };
    try {
      const img = sharp(buf)
        .rotate()
        .resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true });
      // metadata() reports the INPUT format (pre-pipeline) without consuming it.
      const inputFormat = (await img.metadata()).format;
      // PNG in → PNG out (keeps transparency); everything else → JPEG.
      converted =
        inputFormat === 'png'
          ? await img
              .png()
              .toBuffer({ resolveWithObject: true })
              .then(({ data, info }) => ({ data, mime: 'image/png', width: info.width, height: info.height }))
          : await img
              .jpeg({ quality: 85 })
              .toBuffer({ resolveWithObject: true })
              .then(({ data, info }) => ({
                data,
                mime: 'image/jpeg',
                width: info.width,
                height: info.height,
              }));
    } catch {
      if (isHeicBytes(buf, mime)) {
        throw new FileRejectedError("I can't open that photo type yet. Try a JPEG or PNG.");
      }
      throw new FileRejectedError("That doesn't look like a photo.");
    }
    return persist(
      opts?.id ?? nanoid(),
      converted.data,
      converted.mime,
      converted.width,
      converted.height,
      'upload',
    );
  }

  async function saveGenerated(buf: Buffer, mime: string, source: string): Promise<FileRef> {
    let width: number | undefined;
    let height: number | undefined;
    try {
      const meta = await sharp(buf).metadata();
      width = meta.width;
      height = meta.height;
    } catch {
      // Generated bytes stay readable even when sharp cannot size them.
    }
    return persist(nanoid(), buf, mime, width, height, source);
  }

  async function read(fileId: string): Promise<{ buf: Buffer; mime: string }> {
    const row = db.prepare('SELECT path, mime FROM files WHERE id = ?').get(fileId) as
      | { path: string; mime: string }
      | undefined;
    if (!row) throw new FileNotFoundError(fileId);
    try {
      return { buf: await fs.readFile(join(dir, row.path)), mime: row.mime };
    } catch {
      // A row without bytes is the same 404 as no row at all.
      throw new FileNotFoundError(fileId);
    }
  }

  async function dataUrl(fileId: string): Promise<string> {
    const { buf, mime } = await read(fileId);
    return `data:${mime};base64,${buf.toString('base64')}`;
  }

  return { saveUpload, saveGenerated, read, dataUrl };
}
