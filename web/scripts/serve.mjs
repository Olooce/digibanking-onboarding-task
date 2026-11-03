// Minimal static file server for the built client in web/dist (no dependencies).
// Usage: node scripts/serve.mjs            -> http://localhost:5173
//        PORT=8080 node scripts/serve.mjs
import {createServer} from 'node:http';
import {readFile, stat} from 'node:fs/promises';
import {extname, join, normalize, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('../dist', import.meta.url)));
const PORT = Number(process.env.PORT) || 5173;
const TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.map': 'application/json; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.png': 'image/png',
    '.woff2': 'font/woff2',
};

async function resolveFile(urlPath) {
    const clean = normalize(decodeURIComponent(urlPath.split('?')[0])).replace(/^(\.\.[/\\])+/, '');
    if (clean.split(/[/\\]/).some((part) => part.startsWith('.'))) return null;
    const file = join(ROOT, clean);
    if (!file.startsWith(ROOT)) return null;
    try {
        const info = await stat(file);
        return info.isDirectory() ? join(file, 'index.html') : file;
    } catch {
        return null;
    }
}

createServer(async (req, res) => {
    const file = await resolveFile(req.url || '/');
    if (!file) {
        res.writeHead(404, {'Content-Type': 'text/plain'}).end('Not found');
        return;
    }
    try {
        const body = await readFile(file);
        res.writeHead(200, {
            'Content-Type': TYPES[extname(file)] || 'application/octet-stream',
            'Cache-Control': 'no-store',
        }).end(body);
    } catch {
        res.writeHead(404, {'Content-Type': 'text/plain'}).end('Not found');
    }
}).listen(PORT, () => {
    console.log(`Web client on http://localhost:${PORT}`);
});
