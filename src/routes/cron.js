import { Hono } from 'hono';
import { cleanupExpired } from '../lib/supabase.js';

const cron = new Hono();

cron.get('/cleanup', async (c) => {
  const secret = process.env.CRON_SECRET;

  const authHeader = c.req.header('authorization');
  const providedSecret = authHeader?.replace(/^Bearer\s+/i, '');

  if (!secret || providedSecret !== secret) {
    return c.json({ error: 'Unauthorized.' }, 401);
  }

  try {
    const deleted = await cleanupExpired();
    console.log(`[Cron] Deleted ${deleted} expired file(s).`);
    return c.json({ ok: true, deleted });
  } catch (err) {
    console.error('[Cron] Cleanup error:', err);
    return c.json({ error: 'Cleanup failed.' }, 500);
  }
});

export default cron;
