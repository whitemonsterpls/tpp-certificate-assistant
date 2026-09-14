'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { parseWordApplication } = require('./parser');
const { validateApplication } = require('./validator');
const { verifyPdf } = require('./pdf-verifier');
const { BrowserManager } = require('./browser');

const projectDir = path.resolve(__dirname, '..');
const publicDir = path.join(projectDir, 'public');
const dataDir = path.join(projectDir, 'data');
const port = Number(process.env.TPP_PORT || 3210);
const host = '127.0.0.1';
const dashboardUrl = `http://${host}:${port}`;
const noBrowser = process.argv.includes('--no-browser');
const browser = new BrowserManager({ projectDir, dashboardUrl, headless: false });

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml'
};

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { 'Content-Type': TYPES['.json'], 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store' });
  res.end(body);
}

function readJson(req, limit = 25 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('The uploaded file is too large.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch { reject(new Error('Invalid JSON request.')); }
    });
    req.on('error', reject);
  });
}

function decodeBase64(data) {
  if (!data || typeof data !== 'string') throw new Error('No file data was received.');
  return Buffer.from(data.replace(/^data:[^,]+,/, ''), 'base64');
}

function safeJsonName(sourceName = 'application') {
  const base = path.basename(sourceName, path.extname(sourceName));
  const safe = base.replace(/[^A-Za-zА-Яа-я0-9._-]+/gu, '_').slice(0, 100) || 'application';
  return `${safe}.json`;
}

async function api(req, res, pathname) {
  const body = await readJson(req);
  if (pathname === '/api/parse-word') {
    const parsed = await parseWordApplication(body.name || 'application.doc', decodeBase64(body.data));
    return sendJson(res, 200, { parsed, validation: validateApplication(parsed) });
  }
  if (pathname === '/api/validate') return sendJson(res, 200, validateApplication(body.data || {}));
  if (pathname === '/api/save-json') {
    fs.mkdirSync(dataDir, { recursive: true });
    const filePath = path.join(dataDir, safeJsonName(body.data?.sourceName));
    fs.writeFileSync(filePath, JSON.stringify(body.data, null, 2), 'utf8');
    return sendJson(res, 200, { path: filePath });
  }
  if (pathname === '/api/open-platform') return sendJson(res, 200, await browser.openPlatform(body.url));
  if (pathname === '/api/inspect-platform') return sendJson(res, 200, await browser.inspectPlatform());
  if (pathname === '/api/fill-platform') {
    const validation = validateApplication(body.data || {});
    if (!validation.ok) return sendJson(res, 422, { error: 'Correct validation errors before filling.', validation });
    return sendJson(res, 200, await browser.fillPlatform(body.data));
  }
  if (pathname === '/api/save-download') return sendJson(res, 200, await browser.saveAndDownload());
  if (pathname === '/api/verify-pdf') {
    return sendJson(res, 200, await verifyPdf(decodeBase64(body.data), body.expected || {}));
  }
  return sendJson(res, 404, { error: 'Unknown API endpoint.' });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, dashboardUrl);
    if (req.method === 'POST' && url.pathname.startsWith('/api/')) return await api(req, res, url.pathname);
    if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed.' });
    const requested = url.pathname === '/' ? '/index.html' : url.pathname;
    const filePath = path.resolve(publicDir, `.${requested}`);
    if (!filePath.startsWith(publicDir) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      return sendJson(res, 404, { error: 'Not found.' });
    }
    const content = fs.readFileSync(filePath);
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(filePath)] || 'application/octet-stream', 'Content-Length': content.length });
    res.end(content);
  } catch (error) {
    console.error(error);
    if (!res.headersSent) sendJson(res, 500, { error: error.message || String(error) });
    else res.end();
  }
});

server.listen(port, host, async () => {
  console.log(`TPP Certificate Assistant: ${dashboardUrl}`);
  if (!noBrowser) {
    try { await browser.openDashboard(); }
    catch (error) {
      console.error(`Could not open the dashboard browser: ${error.message}`);
      console.error(`Open ${dashboardUrl} manually after installing dependencies with npm install.`);
    }
  }
});

async function shutdown() {
  await browser.close().catch(() => {});
  server.close(() => process.exit(0));
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

module.exports = { server };
