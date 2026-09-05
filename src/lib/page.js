// Shared page shell so every server-rendered page (404, 410, etc.) uses the
// exact same navbar/footer/markup as the main SPA shell in public/index.html.
// Keep this in sync with public/index.html if you change the header/footer.

import { iconLogo } from './icons.js';

export function pageShell({ title, body, description }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <meta name="description" content="${description || 'Upload files and share them temporarily. Files are deleted automatically after your chosen time.'}">
  <link rel="icon" href="/favicon.png" type="image/png">
  <link rel="stylesheet" href="/style.css">
</head>
<body>
  <div class="page-shell">
    <div class="container">

      <div class="navbar">
        <a href="/" class="navbar-brand">
          <span class="navbar-logo-mark" aria-hidden="true">${iconLogo}</span>
          <span>ZeloraFiles</span>
        </a>
        <nav class="navbar-links">
          <a href="/">Home</a>
          <a href="/#how-it-works">How it works</a>
        </nav>
      </div>

      <div class="header">
        <div class="logo">ZeloraFiles</div>
        <div class="tagline">Temporary file hosting, done the simple way</div>
      </div>

      ${body}

      <div class="footer">
        <p>Simple temporary file sharing &middot; Max 50&nbsp;MB per file &middot; Files are removed automatically after expiry, never manually.</p>
        <p class="footer-links"><a href="/">Home</a><span aria-hidden="true">&middot;</span><a href="https://github.com" target="_blank" rel="noopener">Source</a></p>
      </div>

    </div>
  </div>
</body>
</html>`;
}
