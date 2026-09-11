import { createClient } from '@supabase/supabase-js';

// Hardcoded on purpose — no .env file is used in this project.
// This is the publishable/anon key, which is meant to be exposed; access
// is enforced by the Row Level Security policies on the Supabase side
// (see README → Supabase Setup), not by keeping this value secret.
const SUPABASE_URL = 'https://fgopzmmwwwptbiryxzgq.supabase.co';
const SUPABASE_KEY = 'sb_publishable_kQ9Z8zC70e5JpyPJc6mafg_klXfhcEE';

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false },
});

export const BUCKET = 'zelorafiles';
export const TABLE = 'files';

const MAX_FILE_SIZE = 50 * 1024 * 1024;
const ALLOWED_DURATIONS = [1, 2, 3, 24, 0];
const BLOCKED_EXTENSIONS = ['.exe', '.bat', '.cmd', '.sh', '.ps1', '.vbs', '.com', '.scr', '.msi'];

export function generateId(length = 10) {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let id = '';
  const arr = new Uint8Array(length);
  crypto.getRandomValues(arr);
  for (const byte of arr) {
    id += chars[byte % chars.length];
  }
  return id;
}

export function validateUpload(file, hours) {
  if (!file || !(file instanceof File)) {
    return { ok: false, error: 'No file provided.' };
  }

  if (file.size === 0) {
    return { ok: false, error: 'File is empty.' };
  }

  if (file.size > MAX_FILE_SIZE) {
    return { ok: false, error: `File too large. Maximum size is ${MAX_FILE_SIZE / 1024 / 1024} MB.` };
  }

  const name = file.name;
  if (!name || name.length > 200) {
    return { ok: false, error: 'Invalid filename.' };
  }

  if (name.includes('/') || name.includes('\\') || name.includes('..')) {
    return { ok: false, error: 'Invalid filename characters.' };
  }

  const ext = name.includes('.') ? '.' + name.split('.').pop().toLowerCase() : '';
  if (BLOCKED_EXTENSIONS.includes(ext)) {
    return { ok: false, error: `File type "${ext}" is not allowed.` };
  }

  const parsedHours = parseInt(hours, 10);
  if (!ALLOWED_DURATIONS.includes(parsedHours)) {
    return { ok: false, error: 'Invalid expiry duration. Choose 1, 2, 3, 24 hours, or permanent.' };
  }

  return { ok: true };
}

export async function uploadFile(id, file, hours) {
  const permanent = hours === 0;
  const expiresAt = permanent ? 0 : Date.now() + hours * 60 * 60 * 1000;
  const sanitizedName = file.name.replace(/[^a-zA-Z0-9._\-]/g, '_');
  const storagePath = `${id}/${sanitizedName}`;

  const arrayBuffer = await file.arrayBuffer();

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, arrayBuffer, {
      contentType: file.type || 'application/octet-stream',
      upsert: false,
    });

  if (uploadError) {
    throw new Error(`Storage upload failed: ${uploadError.message}`);
  }

  const { error: dbError } = await supabase.from(TABLE).insert({
    id,
    filename: file.name,
    storage_path: storagePath,
    content_type: file.type || 'application/octet-stream',
    size: file.size,
    expires_at: expiresAt,
  });

  if (dbError) {
    // Roll back the orphaned object so storage doesn't accumulate garbage.
    await supabase.storage.from(BUCKET).remove([storagePath]).catch(() => {});
    throw new Error(`Database insert failed: ${dbError.message}`);
  }

  const { data: publicUrlData } = supabase.storage.from(BUCKET).getPublicUrl(storagePath);

  return {
    url: publicUrlData.publicUrl,
    expiresAt,
    permanent,
    id,
    filename: file.name,
    size: file.size,
  };
}

export async function findFileById(id) {
  const { data, error } = await supabase.from(TABLE).select('*').eq('id', id).maybeSingle();
  if (error) {
    throw new Error(`Database lookup failed: ${error.message}`);
  }
  return data;
}

export async function deleteFileRecord(id, storagePath) {
  await supabase.storage.from(BUCKET).remove([storagePath]).catch(() => {});
  await supabase.from(TABLE).delete().eq('id', id).catch(() => {});
}

export function getPublicUrl(storagePath) {
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(storagePath);
  return data.publicUrl;
}

// Downloads the raw file bytes from Supabase Storage server-side, so the
// route handler can stream them back under our own domain instead of
// redirecting the browser to the Supabase storage URL. Returns a Blob.
export async function downloadFile(storagePath) {
  const { data, error } = await supabase.storage.from(BUCKET).download(storagePath);
  if (error) {
    throw new Error(`Storage download failed: ${error.message}`);
  }
  return data;
}

// The extension is purely cosmetic — appended to /f/:id links so a shared
// URL shows a recognizable filename (e.g. /f/8FeC5N7rFF.jpg). Lookups strip
// it back off before hitting the database, so it's never load-bearing.
export function getExtension(filename) {
  if (!filename || !filename.includes('.')) return '';
  const ext = filename.slice(filename.lastIndexOf('.'));
  return /^\.[a-zA-Z0-9]{1,15}$/.test(ext) ? ext : '';
}

// Used by the admin dashboard to list every non-expired-or-not file.
export async function listFiles(limit = 300) {
  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(`Database list failed: ${error.message}`);
  }

  return data || [];
}

// NOTE: There is intentionally no manual "delete by user" function here.
// Files only ever disappear once their expires_at has passed — see
// src/routes/file.js (checked on access) and cleanupExpired (swept daily).
export async function cleanupExpired() {
  const now = Date.now();
  let deleted = 0;
  const pageSize = 200;
  let from = 0;

  // Loop in pages so a very large expired backlog doesn't blow past
  // Supabase's default row limit in a single query.
  for (;;) {
    const { data, error } = await supabase
      .from(TABLE)
      .select('id, storage_path, expires_at')
      .neq('expires_at', 0)
      .lt('expires_at', now)
      .range(from, from + pageSize - 1);

    if (error) {
      throw new Error(`Cleanup query failed: ${error.message}`);
    }

    if (!data || data.length === 0) break;

    const paths = data.map((row) => row.storage_path);
    const ids = data.map((row) => row.id);

    if (paths.length > 0) {
      await supabase.storage.from(BUCKET).remove(paths).catch(() => {});
      await supabase.from(TABLE).delete().in('id', ids).catch(() => {});
      deleted += data.length;
    }

    if (data.length < pageSize) break;
    from += pageSize;
  }

  return deleted;
}
