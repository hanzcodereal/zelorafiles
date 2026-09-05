import { Hono } from 'hono';
import { findFileById, deleteFileRecord, getPublicUrl } from '../lib/supabase.js';
import { pageShell } from '../lib/page.js';
import { iconFolderWarning, iconClock, iconArrowLeft } from '../lib/icons.js';

const file = new Hono();

file.get('/:id', async (c) => {
  const { id } = c.req.param();

  if (!id || !/^[a-zA-Z0-9]{6,20}$/.test(id)) {
    return c.text('Invalid file ID.', 400);
  }

  try {
    const record = await findFileById(id);
    if (!record) {
      return c.html(notFoundPage(), 404);
    }

    if (record.expires_at !== 0 && Date.now() > record.expires_at) {
      await deleteFileRecord(record.id, record.storage_path).catch(() => {});
      return c.html(expiredPage(), 410);
    }

    return c.redirect(getPublicUrl(record.storage_path), 302);
  } catch (err) {
    console.error('File fetch error:', err);
    return c.text('Error retrieving file.', 500);
  }
});

file.get('/:id/info', async (c) => {
  const { id } = c.req.param();

  if (!id || !/^[a-zA-Z0-9]{6,20}$/.test(id)) {
    return c.json({ error: 'Invalid file ID.' }, 400);
  }

  try {
    const record = await findFileById(id);
    if (!record) {
      return c.json({ error: 'File not found.' }, 404);
    }

    if (record.expires_at !== 0 && Date.now() > record.expires_at) {
      return c.json({ error: 'File has expired.' }, 410);
    }

    return c.json({
      ok: true,
      id: record.id,
      filename: record.filename,
      size: record.size,
      expiresAt: record.expires_at,
      permanent: record.expires_at === 0,
      downloadUrl: `/f/${record.id}`,
    });
  } catch (err) {
    console.error('Info error:', err);
    return c.json({ error: 'Error retrieving file info.' }, 500);
  }
});

// NOTE: There is intentionally no DELETE endpoint here (and no client-side
// delete function anywhere in this project). Once a file is uploaded, the
// only way it is removed is automatically, when its expiration time has
// passed (checked on access above, and swept up daily by /cron/cleanup).
// Do not re-introduce a manual delete route/button — see README "Security".

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
