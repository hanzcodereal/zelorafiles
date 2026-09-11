import { Hono } from 'hono';
import { findFileById, deleteFileRecord, downloadFile, getExtension } from '../lib/supabase.js';
import { pageShell } from '../lib/page.js';
import { iconFolderWarning, iconClock, iconArrowLeft } from '../lib/icons.js';

const file = new Hono();

// Links look like /f/8FeC5N7rFF.jpg — the extension after the id is purely
// cosmetic (so a shared link shows a real filename) and is stripped before
// any lookup happens. /f/8FeC5N7rFF (no extension) still works exactly the
// same way.
function parseId(raw) {
  const dot = raw.indexOf('.');
  return dot === -1 ? raw : raw.slice(0, dot);
}

file.get('/:id', async (c) => {
  const id = parseId(c.req.param('id'));

  if (!id || !/^[a-zA-Z0-9]{6,20}$/.test(id)) {
    return c.text('Invalid file ID.', 400);
  }

  try {
    const record = await findFileById(id);
    if (!record) {
      return c.html(notFoundPage(), 404);
    }

    if (record.expires_at !== 0 && Date.now() > record.expires_at) {
      await deleteFileRecord(record.id, record.storage_path).catch((err) => {
        console.error('[File] Failed to delete expired file on access:', err.message);
      });
      return c.html(expiredPage(), 410);
    }

    // Fetched server-side and streamed back under our own domain — the
    // Supabase project URL / storage path is never sent to the client
    // (previously this route did `c.redirect(getPublicUrl(...))`, which put
    // the raw Supabase storage URL directly in the browser's address bar).
    let blob;
    try {
      blob = await downloadFile(record.storage_path);
    } catch (err) {
      console.error('File download error:', err);
      return c.text('Error retrieving file.', 500);
    }

    const arrayBuffer = await blob.arrayBuffer();
    const asciiFallbackName = record.filename.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, '');

    return new Response(arrayBuffer, {
      headers: {
        'Content-Type': record.content_type || 'application/octet-stream',
        'Content-Length': String(arrayBuffer.byteLength),
        'Content-Disposition':
          `inline; filename="${asciiFallbackName}"; filename*=UTF-8''${encodeURIComponent(record.filename)}`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    console.error('File fetch error:', err);
    return c.text('Error retrieving file.', 500);
  }
});

file.get('/:id/info', async (c) => {
  const id = parseId(c.req.param('id'));

  if (!id || !/^[a-zA-Z0-9]{6,20}$/.test(id)) {
    return c.json({ error: 'Invalid file ID.' }, 400);
  }

  try {
    const record = await findFileById(id);
    if (!record) {
      return c.json({ error: 'File not found.' }, 404);
    }

    if (record.expires_at !== 0 && Date.now() > record.expires_at) {
      // Same lazy-delete-on-access as the download route above, so an
      // expired file's row (and storage object) is removed the moment
      // anything touches it, not only when /f/:id itself is opened.
      await deleteFileRecord(record.id, record.storage_path).catch((err) => {
        console.error('[File] Failed to delete expired file on access (info):', err.message);
      });
      return c.json({ error: 'File has expired.' }, 410);
    }

    return c.json({
      ok: true,
      id: record.id,
      filename: record.filename,
      size: record.size,
      expiresAt: record.expires_at,
      permanent: record.expires_at === 0,
      downloadUrl: `/f/${record.id}${getExtension(record.filename)}`,
    });
  } catch (err) {
    console.error('Info error:', err);
    return c.json({ error: 'Error retrieving file info.' }, 500);
  }
});

// NOTE: There is intentionally no public DELETE endpoint here. The only
// ways a file disappears are (1) automatically on expiry — checked above on
// every access, and swept daily by /cron/cleanup — or (2) a manual removal
// from /admin. See README "Security".

function notFoundPage() {
  return pageShell({
    title: 'File Not Found — ZeloraFiles',
    body: `
    <div class="box state-box state-404">
      <div class="state-icon" aria-hidden="true">${iconFolderWarning}</div>
      <h1 class="state-title">404 — File not found</h1>
      <p class="state-text">This file does not exist, the link is incorrect, or it has already expired and been removed automatically.</p>
      <p class="state-actions"><a class="btn btn-primary" href="/">${iconArrowLeft}<span>Upload a new file</span></a></p>
    </div>`,
  });
}

function expiredPage() {
  return pageShell({
    title: 'File Expired — ZeloraFiles',
    body: `
    <div class="box state-box state-410">
      <div class="state-icon" aria-hidden="true">${iconClock}</div>
      <h1 class="state-title">410 — File expired</h1>
      <p class="state-text">This file passed its expiration time and was automatically deleted. Files on ZeloraFiles cannot be recovered after expiry.</p>
      <p class="state-actions"><a class="btn btn-primary" href="/">${iconArrowLeft}<span>Upload a new file</span></a></p>
    </div>`,
  });
}

export default file;
