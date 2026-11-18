/**
 * Roda o Orçamentos neste computador (para testar): node servidor-local.mjs
 * - Usa um banco de TESTE (pasta dados/banco-local). Nunca o banco Neon de produção.
 * - Lê o PORTAL_PASSE_SEGREDO do .env.local.
 * - Para entrar sem o portal: npm run passe-teste (mostra um link de entrada que vale 60 s).
 */
import http from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = path.dirname(fileURLToPath(import.meta.url));
const pastaPublica = path.join(raiz, 'public');

export function lerEnvLocal() {
  const arq = path.join(raiz, '.env.local');
  if (!existsSync(arq)) return;
  for (const linha of readFileSync(arq, 'utf8').split(/\r?\n/)) {
    const m = linha.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
lerEnvLocal();

if (process.env.DATABASE_URL?.trim()) {
  console.error('\nPara testar no computador, deixe DATABASE_URL vazio no .env.local (o teste usa um banco local).');
  console.error('Nunca teste com o banco de produção.\n');
  process.exit(1);
}

const { tratarApi, lerCookies } = await import('./servidor/api.js');

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};
const porta = Number(process.env.PORT) || 5180;

http
  .createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname.startsWith('/api/')) {
      let texto = '';
      for await (const pedaco of req) {
        texto += pedaco;
        if (texto.length > 2_000_000) {
          res.writeHead(413);
          res.end();
          return;
        }
      }
      let corpo = {};
      try {
        corpo = texto ? JSON.parse(texto) : {};
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ erro: 'Corpo da requisição inválido.' }));
        return;
      }
      const r = await tratarApi({ metodo: req.method, caminho: url.pathname, corpo, cookies: lerCookies(req.headers.cookie), https: false });
      res.writeHead(r.status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...(r.cabecalhos ?? {}) });
      res.end(JSON.stringify(r.corpo));
      return;
    }
    // Página do cliente (/p/<código>) e a raiz usam o mesmo index.html
    const pedido = url.pathname === '/' || url.pathname.startsWith('/p/') ? '/index.html' : decodeURIComponent(url.pathname);
    const arquivo = path.join(pastaPublica, path.normalize(pedido));
    if (!arquivo.startsWith(pastaPublica + path.sep)) {
      res.writeHead(403);
      res.end();
      return;
    }
    try {
      const dados = await readFile(arquivo);
      res.writeHead(200, { 'Content-Type': TIPOS[path.extname(arquivo)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(dados);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Não encontrado');
    }
  })
  .listen(porta, () => console.log(`Orçamentos (teste) em http://localhost:${porta}`));
