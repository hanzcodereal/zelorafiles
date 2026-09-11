import { Hono } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { verifyLogin, createSessionToken, verifySessionToken, ADMIN_COOKIE_NAME } from '../lib/admin.js';
import { listFiles, findFileById, deleteFileRecord, getExtension } from '../lib/supabase.js';
import { pageShell } from '../lib/page.js';

const admin = new Hono();

async function isAuthed(c) {
  const token = getCookie(c, ADMIN_COOKIE_NAME);
  return verifySessionToken(token);
}

admin.get('/', async (c) => {
  if (!(await isAuthed(c))) {
    return c.html(loginPage());
  }

  let files = [];
  let loadError = null;
  try {
    files = await listFiles();
  } catch (err) {
    console.error('[Admin] List error:', err);
    loadError = 'Could not load files from the database.';
  }

  const deleteError = c.req.query('deleteError');
  return c.html(dashboardPage(files, loadError, deleteError));
});

admin.post('/login', async (c) => {
  const formData = await c.req.formData();
  const username = formData.get('username');
  const password = formData.get('password');

  let ok = false;
  try {
    ok = await verifyLogin(username, password);
  } catch (err) {
    console.error('[Admin] Credentials error:', err);
    return c.html(loginPage('Admin is not configured correctly on the server (check admin.json).'), 500);
  }

  if (!ok) {
    return c.html(loginPage('Invalid username or password.'), 401);
  }

  const token = await createSessionToken();
  setCookie(c, ADMIN_COOKIE_NAME, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'Strict',
    path: '/admin',
    maxAge: 60 * 60 * 12,
  });

  return c.redirect('/admin', 302);
});

admin.post('/logout', async (c) => {
  deleteCookie(c, ADMIN_COOKIE_NAME, { path: '/admin' });
  return c.redirect('/admin', 302);
});

admin.post('/delete/:id', async (c) => {
  if (!(await isAuthed(c))) {
    return c.redirect('/admin', 302);
  }

  const { id } = c.req.param();
  if (!id || !/^[a-zA-Z0-9]{6,20}$/.test(id)) {
    return c.redirect('/admin', 302);
  }

  try {
    const record = await findFileById(id);
    if (record) {
      await deleteFileRecord(record.id, record.storage_path);
    }
  } catch (err) {
    console.error('[Admin] Delete error:', err);
    // Surface the failure instead of redirecting as if it succeeded — the
    // most likely cause is a missing Supabase RLS "delete" policy on the
    // `files` table or the `zelorafiles` storage bucket (see README →
    // Security / Supabase Setup).
    return c.redirect(`/admin?deleteError=${encodeURIComponent(err.message)}`, 302);
  }

  return c.redirect('/admin', 302);
});

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
}

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

function loginPage(error) {
  return pageShell({
    title: 'Admin Login — ZeloraFiles',
    body: `
    <div class="box" id="admin-login-box">
      <h1 class="state-title" style="margin-bottom:16px;">Admin Login</h1>
      ${error ? `<div class="msg error">${escapeHtml(error)}</div>` : ''}
      <form method="POST" action="/admin/login" class="admin-form">
        <label class="admin-label" for="username">Username</label>
        <input class="admin-input" type="text" id="username" name="username" required autocomplete="username" autofocus>
        <label class="admin-label" for="password">Password</label>
        <input class="admin-input" type="password" id="password" name="password" required autocomplete="current-password">
        <button class="btn btn-primary" type="submit" style="margin-top:16px;width:100%;">Log in</button>
      </form>
    </div>`,
  });
}

function dashboardPage(files, loadError, deleteError) {
  const rows = files.map((f) => {
    const expired = f.expires_at !== 0 && Date.now() > f.expires_at;
    const expiry = f.expires_at === 0 ? 'Permanent' : new Date(f.expires_at).toLocaleString();
    const link = `/f/${f.id}${getExtension(f.filename)}`;

    return `
      <tr>
        <td>${escapeHtml(f.filename)}</td>
        <td>${formatBytes(f.size)}</td>
        <td>${escapeHtml(expiry)}${expired ? ' <span class="admin-badge-expired">expired</span>' : ''}</td>
        <td><a href="${link}" target="_blank" rel="noopener">${link}</a></td>
        <td>
          <form method="POST" action="/admin/delete/${f.id}" onsubmit="return confirm('Delete this file permanently? This cannot be undone.');">
            <button class="btn btn-sm" type="submit">Delete</button>
          </form>
        </td>
      </tr>`;
  }).join('');

  return pageShell({
    title: 'Admin Dashboard — ZeloraFiles',
    body: `
    <div class="box">
      <div class="admin-header-row">
        <h1 class="state-title" style="margin:0;">Files (${files.length})</h1>
        <form method="POST" action="/admin/logout"><button class="btn btn-sm" type="submit">Log out</button></form>
      </div>
      ${loadError ? `<div class="msg error">${escapeHtml(loadError)}</div>` : ''}
      ${deleteError ? `<div class="msg error">Delete failed: ${escapeHtml(deleteError)} — check your Supabase RLS "delete" policies (see README → Security).</div>` : ''}
      ${files.length === 0 && !loadError ? '<p class="state-text">No files yet.</p>' : ''}
      ${files.length > 0 ? `
      <div class="admin-table-wrap">
        <table class="admin-table">
          <thead><tr><th>Filename</th><th>Size</th><th>Expires</th><th>Link</th><th></th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>` : ''}
    </div>`,
  });
}

export default admin;
