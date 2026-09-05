import { Hono } from 'hono';
import uploadRoute from './routes/upload.js';
import fileRoute from './routes/file.js';
import cronRoute from './routes/cron.js';
import { readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';

const app = new Hono();

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

app.get('/style.css', servePublic('style.css'));
app.get('/app.js', servePublic('app.js'));
// NOTE: the previous version pointed both of these at a file named
// "favicon.ico" that didn't exist on disk (only favicon.png does), which
// made every browser's automatic favicon request silently 404. Both routes
// now correctly serve the actual public/favicon.png file.
app.get('/favicon.ico', servePublic('favicon.png'));
app.get('/favicon.png', servePublic('favicon.png'));

function servePublic(filename) {
  return async (c) => {
    try {
      const filePath = join(process.cwd(), 'public', filename);
      const content = await readFile(filePath);
      const ext = extname(filename);
      const mime = MIME[ext] || 'application/octet-stream';
      return new Response(content, {
        headers: { 'Content-Type': mime, 'Cache-Control': 'public, max-age=3600' },
      });
    } catch {
      return c.notFound();
    }
  };
}

app.route('/upload', uploadRoute);
app.route('/f', fileRoute);
app.route('/cron', cronRoute);

app.get('/', async (c) => {
  try {
    const filePath = join(process.cwd(), 'public', 'index.html');
    const content = await readFile(filePath, 'utf-8');
    return c.html(content);
  } catch (err) {
    console.error('Failed to serve index.html:', err);
    return c.text('Service unavailable.', 503);
  }
});

app.notFound((c) => c.json({ error: 'Not found.' }, 404));

app.onError((err, c) => {
  console.error('Unhandled error:', err);
  return c.json({ error: 'Internal server error.' }, 500);
});

export default app;
