import { Hono } from 'hono';
import { generateId, validateUpload, uploadFile } from '../lib/supabase.js';

const upload = new Hono();

upload.post('/', async (c) => {
  try {
    const formData = await c.req.formData();
    const file = formData.get('file');
    const hours = formData.get('hours');

    const validation = validateUpload(file, hours);
    if (!validation.ok) {
      return c.json({ error: validation.error }, 400);
    }

    const id = generateId(10);
    const result = await uploadFile(id, file, parseInt(hours, 10));

    return c.json({
      ok: true,
      id: result.id,
      filename: result.filename,
      size: result.size,
      expiresAt: result.expiresAt,
      permanent: result.permanent,
      url: `/f/${result.id}`,
    });
  } catch (err) {
    console.error('Upload error:', err);
    return c.json({ error: 'Upload failed. Please try again.' }, 500);
  }
});

export default upload;
