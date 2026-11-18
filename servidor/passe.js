/**
 * "Passe" do portal: o jeito do Orçamentos saber quem entrou no Portal Táxi 2.0.
 *
 * - O portal assina { e-mail, nome, validade, id, perfil } com o segredo PORTAL_PASSE_SEGREDO
 *   (o mesmo valor no portal e aqui; nunca no Git nem no chat).
 * - O passe vale 60 segundos e só é aceito UMA vez (o id fica guardado em passes_usados).
 * - Vem no endereço depois do "#" (…/#passe=…); a página lê, apaga do endereço e manda para /api/entrar.
 *
 * Cópia em JavaScript de taxi20-app/src/servidor/passe.ts. Se mudar lá, mude aqui.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const VALIDADE_PASSE_SEG = 60;
const TAMANHO_MINIMO_SEGREDO = 32;

export function segredoDoPasse() {
  const s = process.env.PORTAL_PASSE_SEGREDO?.trim() ?? '';
  return s.length >= TAMANHO_MINIMO_SEGREDO ? s : null;
}

const assinar = (corpo, segredo) => createHmac('sha256', segredo).update(corpo).digest('base64url');

/** Usado só nos testes e no script de teste local (quem gera o passe de verdade é o portal). */
export function gerarPasse(pessoa, segredo, agoraMs = Date.now()) {
  const dados = {
    e: pessoa.email.trim().toLowerCase(),
    n: pessoa.nome,
    exp: Math.floor(agoraMs / 1000) + VALIDADE_PASSE_SEG,
    id: randomBytes(16).toString('base64url'),
    ...(pessoa.perfilId ? { p: pessoa.perfilId } : {})
  };
  const corpo = Buffer.from(JSON.stringify(dados)).toString('base64url');
  return `${corpo}.${assinar(corpo, segredo)}`;
}

/** Confere assinatura e validade. Devolve os dados, ou null se o passe for falso, alterado ou vencido. */
export function conferirPasse(passe, segredo, agoraMs = Date.now()) {
  const [corpo, assinatura, sobra] = String(passe ?? '').split('.');
  if (!corpo || !assinatura || sobra !== undefined) return null;
  const esperada = Buffer.from(assinar(corpo, segredo));
  const recebida = Buffer.from(assinatura);
  if (esperada.length !== recebida.length || !timingSafeEqual(esperada, recebida)) return null;
  try {
    const d = JSON.parse(Buffer.from(corpo, 'base64url').toString('utf8'));
    if (typeof d.e !== 'string' || !d.e.includes('@') || typeof d.id !== 'string' || typeof d.exp !== 'number') return null;
    if (d.exp < Math.floor(agoraMs / 1000)) return null;
    if (d.exp > Math.floor(agoraMs / 1000) + VALIDADE_PASSE_SEG + 5) return null;
    return d;
  } catch {
    return null;
  }
}
