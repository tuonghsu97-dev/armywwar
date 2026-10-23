// Tiny static server for the game (no dependencies). Usage: node serve.js [port] [--no-open]
const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const root = __dirname;
const port = Number(process.argv.find(a => /^\d+$/.test(a)) || 5173);
const open = !process.argv.includes('--no-open');

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream', '.wasm': 'application/wasm',
  '.md': 'text/markdown; charset=utf-8', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav',
};

http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const file = path.normalize(path.join(root, p));
  if (!file.startsWith(root)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}).listen(port, '127.0.0.1', () => {
  const url = `http://localhost:${port}/`;
  console.log(`WARGRID đang chạy tại ${url}  (Ctrl+C để tắt)`);
  if (open) exec(process.platform === 'win32' ? `start "" "${url}"` : `xdg-open ${url}`);
});
