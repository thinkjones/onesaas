import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Workflow } from '@dad/shared';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { openDb, type Database } from '../src/db/connection.js';
import { createRepo, type Repo } from '../src/db/repo.js';
import { createFileStore, type FileStore } from '../src/files/store.js';
import { createServer } from '../src/main.js';
import { ensureSamplePhoto, SAMPLE_FILE_ID } from '../src/triggers/upload.js';

const here = dirname(fileURLToPath(import.meta.url));
const HEIC_FIXTURE = join(here, 'fixtures', 'photo.heic');

function makeUploadWorkflow(): Workflow {
  return {
    id: 'flow-upload',
    name: 'Photo flow',
    description: 'test upload workflow',
    version: 1,
    status: 'on',
    trigger: {
      id: 'trigger',
      type: 'trigger.upload',
      title: 'Photo upload',
      summary: 'Runs when you drop a photo.',
      config: {},
      inputs: {},
      position: { x: 0, y: 0 },
    },
    steps: [],
    edges: [],
  };
}

describe('file store', () => {
  let db: Database;
  let files: FileStore;
  let dir: string;

  beforeEach(() => {
    db = openDb(':memory:');
    createRepo(db);
    dir = mkdtempSync(join(tmpdir(), 'dad-files-'));
    files = createFileStore({ db, dir });
  });

  afterEach(() => {
    db.close();
  });

  test('saveUpload of a 4000x3000 JPEG returns width 2048', async () => {
    const buf = await sharp({
      create: { width: 4000, height: 3000, channels: 3, background: { r: 200, g: 100, b: 50 } },
    })
      .jpeg()
      .toBuffer();
    const ref = await files.saveUpload(buf, 'image/jpeg');
    expect(ref.mime).toBe('image/jpeg');
    expect(ref.width).toBe(2048);
    expect(ref.height).toBe(1536);
    // The stored bytes really are the resized image.
    const stored = await files.read(ref.fileId);
    const meta = await sharp(stored.buf).metadata();
    expect(meta.width).toBe(2048);
    expect(meta.height).toBe(1536);
  });

  test('a HEIC photo converts to JPEG where sharp decodes HEIF, else fails readable', async () => {
    const heic = readFileSync(HEIC_FIXTURE);
    // Detect, don't assume: only a real pixel decode proves THIS sharp build
    // reads HEIC — metadata() can succeed where the decode pipeline fails.
    const sharpDecodesHeic = await sharp(heic)
      .jpeg()
      .toBuffer()
      .then(() => true)
      .catch(() => false);
    if (sharpDecodesHeic) {
      const ref = await files.saveUpload(heic, 'image/heic');
      expect(ref.mime).toBe('image/jpeg');
      expect(ref.width).toBe(320);
      expect(ref.height).toBe(240);
    } else {
      await expect(files.saveUpload(heic, 'image/heic')).rejects.toThrow(
        "I can't open that photo type yet. Try a JPEG or PNG.",
      );
    }
  });

  test('unreadable HEIC bytes fail with the HEIC message even where sharp reads HEIF', async () => {
    // ftyp + heic brand, then garbage: magic-byte detection must route this
    // to the HEIC message, not the generic photo message.
    const fake = Buffer.concat([
      Buffer.from([0, 0, 0, 24]),
      Buffer.from('ftypheic', 'ascii'),
      Buffer.from('not-a-real-image-at-all-0123456789'),
    ]);
    await expect(files.saveUpload(fake, 'image/heic')).rejects.toThrow(
      "I can't open that photo type yet. Try a JPEG or PNG.",
    );
  });

  test("a PDF is rejected with `That doesn't look like a photo.`", async () => {
    const pdf = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n', 'utf8');
    await expect(files.saveUpload(pdf, 'application/pdf')).rejects.toThrow(
      "That doesn't look like a photo.",
    );
  });

  test('a PNG stays a PNG and keeps its size when already small', async () => {
    const buf = await sharp({
      create: { width: 100, height: 80, channels: 4, background: { r: 1, g: 2, b: 3, alpha: 0.5 } },
    })
      .png()
      .toBuffer();
    const ref = await files.saveUpload(buf, 'image/png');
    expect(ref.mime).toBe('image/png');
    expect(ref.width).toBe(100);
    expect(ref.height).toBe(80);
  });

  test('read returns the stored bytes and mime; dataUrl is a base64 data URL', async () => {
    const buf = await sharp({
      create: { width: 10, height: 10, channels: 3, background: { r: 9, g: 9, b: 9 } },
    })
      .jpeg()
      .toBuffer();
    const ref = await files.saveUpload(buf, 'image/jpeg');
    const got = await files.read(ref.fileId);
    expect(got.mime).toBe('image/jpeg');
    expect(got.buf.length).toBeGreaterThan(0);
    const url = await files.dataUrl(ref.fileId);
    expect(url.startsWith('data:image/jpeg;base64,')).toBe(true);
  });

  test('read of an unknown id throws', async () => {
    await expect(files.read('nope')).rejects.toThrow('Unknown file: nope');
  });

  test('saveGenerated stores bytes with the given source', async () => {
    const buf = await sharp({
      create: { width: 50, height: 50, channels: 3, background: { r: 1, g: 1, b: 1 } },
    })
      .png()
      .toBuffer();
    const ref = await files.saveGenerated(buf, 'image/png', 'muse-image');
    expect(ref.mime).toBe('image/png');
    const got = await files.read(ref.fileId);
    expect(got.buf.equals(buf)).toBe(true);
    const row = db
      .prepare('SELECT source FROM files WHERE id = ?')
      .get(ref.fileId) as { source: string };
    expect(row.source).toBe('muse-image');
  });

  test('ensureSamplePhoto seeds the bundled mug photo under the sample id', async () => {
    await ensureSamplePhoto(files);
    const got = await files.read(SAMPLE_FILE_ID);
    expect(got.mime).toBe('image/jpeg');
    const meta = await sharp(got.buf).metadata();
    expect(meta.width).toBe(1200);
    // Idempotent: seeding twice keeps one row.
    await ensureSamplePhoto(files);
    const row = db
      .prepare('SELECT COUNT(*) AS n FROM files WHERE id = ?')
      .get(SAMPLE_FILE_ID) as { n: number };
    expect(row.n).toBe(1);
  });
});

describe('file routes', () => {
  let dbFile: string;
  let filesDir: string;
  let server: ReturnType<typeof createServer>;

  beforeEach(() => {
    dbFile = join(mkdtempSync(join(tmpdir(), 'dad-dbfiles-')), 'app.db');
    filesDir = mkdtempSync(join(tmpdir(), 'dad-route-files-'));
    server = createServer({ dbFile, filesDir });
  });

  afterEach(() => {
    server.db.close();
  });

  function jpegFile(name = 'mug.jpg'): File {
    return new File(
      [
        readFileSync(
          join(here, '..', 'assets', 'sample-mug.jpg'),
        ),
      ],
      name,
      { type: 'image/jpeg' },
    );
  }

  test('POST /api/files stores a photo and returns its FileRef', async () => {
    const form = new FormData();
    form.set('file', jpegFile());
    const res = await server.app.request('/api/files', { method: 'POST', body: form });
    expect(res.status).toBe(200);
    const ref = (await res.json()) as { fileId: string; mime: string; width: number };
    expect(typeof ref.fileId).toBe('string');
    expect(ref.mime).toBe('image/jpeg');
    expect(ref.width).toBe(1200);
  });

  test('POST /api/files without a file is a 400', async () => {
    const form = new FormData();
    form.set('note', 'no file here');
    const res = await server.app.request('/api/files', { method: 'POST', body: form });
    expect(res.status).toBe(400);
  });

  test('POST /api/files rejects a PDF with the readable message', async () => {
    const form = new FormData();
    form.set('file', new File(['%PDF-1.4 fake'], 'doc.pdf', { type: 'application/pdf' }));
    const res = await server.app.request('/api/files', { method: 'POST', body: form });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("That doesn't look like a photo.");
  });

  test('GET /api/files/:id serves the stored bytes with its content type', async () => {
    const form = new FormData();
    form.set('file', jpegFile());
    const saved = (await (
      await server.app.request('/api/files', { method: 'POST', body: form })
    ).json()) as { fileId: string };
    const res = await server.app.request(`/api/files/${saved.fileId}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('image/jpeg');
    expect((await res.arrayBuffer()).byteLength).toBeGreaterThan(0);
  });

  test('GET /api/files/:id for an unknown id is a 404', async () => {
    const res = await server.app.request('/api/files/nope');
    expect(res.status).toBe(404);
  });

  test('POST /api/workflows/:id/upload saves the photo and starts a run with { file, note }', async () => {
    const repo: Repo = server.repo;
    repo.saveWorkflow(makeUploadWorkflow());
    const form = new FormData();
    form.set('file', jpegFile());
    form.set('note', 'the blue one');
    const res = await server.app.request('/api/workflows/flow-upload/upload', {
      method: 'POST',
      body: form,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      run: { id: string; status: string; triggerPayload: unknown };
      file: { fileId: string };
    };
    expect(body.run.status).toBe('done');
    const payload = body.run.triggerPayload as { file: { fileId: string }; note?: string };
    expect(payload.file.fileId).toBe(body.file.fileId);
    expect(payload.note).toBe('the blue one');
    // The file behind the payload is servable.
    const img = await server.app.request(`/api/files/${body.file.fileId}`);
    expect(img.status).toBe(200);
  });

  test('POST /api/workflows/:id/upload on an unknown workflow is a 404', async () => {
    const form = new FormData();
    form.set('file', jpegFile());
    const res = await server.app.request('/api/workflows/nope/upload', {
      method: 'POST',
      body: form,
    });
    expect(res.status).toBe(404);
  });

  test('"Try it" on an upload workflow runs on the catalog sample photo', async () => {
    server.repo.saveWorkflow(makeUploadWorkflow());
    await ensureSamplePhoto(server.files);
    const { run, usedSample } = await server.testRun('flow-upload');
    expect(run.status).toBe('done');
    expect(usedSample).toBe(false);
    const payload = run.triggerPayload as { file: { fileId: string } };
    expect(payload.file.fileId).toBe(SAMPLE_FILE_ID);
  });

  test('POST /api/workflows/:id/upload on a non-upload trigger is a 400', async () => {
    const wf = makeUploadWorkflow();
    wf.trigger = { ...wf.trigger, type: 'trigger.manual' };
    server.repo.saveWorkflow(wf);
    const form = new FormData();
    form.set('file', jpegFile());
    const res = await server.app.request('/api/workflows/flow-upload/upload', {
      method: 'POST',
      body: form,
    });
    expect(res.status).toBe(400);
  });
});
