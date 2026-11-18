/**
 * SÓ PARA TESTE NO COMPUTADOR: mostra um link de entrada no Orçamentos local, como se viesse do portal.
 * Uso: npm run passe-teste   (o link vale 60 segundos e entra uma vez só)
 */
import { existsSync, readFileSync } from 'node:fs';
import { gerarPasse, segredoDoPasse } from '../servidor/passe.js';

if (existsSync('.env.local')) {
  for (const linha of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
    const m = linha.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
const segredo = segredoDoPasse();
if (!segredo) {
  console.error('Falta PORTAL_PASSE_SEGREDO (32 caracteres ou mais) no .env.local.');
  process.exit(1);
}
const porta = Number(process.env.PORT) || 5180;
const passe = gerarPasse({ email: 'teste@local.test', nome: 'Teste Local', perfilId: 'administrador' }, segredo);
console.log(`http://localhost:${porta}/#passe=${passe}`);
