# Orçamentos de transporte — módulo do Portal Táxi 2.0

Propostas de transporte organizadas, com um link para o cliente ver, imprimir e aprovar.

- **Equipe:** entra pelo cartão **Orçamentos** do portal (`apptx20.agenciatx.ia.br`), sem senha nova.
  Usa o mesmo passe assinado do Financeiro, da Medição e do Corridas com IA.
- **Dados:** propostas e "Minha empresa" ficam no banco **Neon** do Orçamentos. A equipe toda vê as mesmas propostas.
- **Cliente:** recebe um link curto (`…/p/código`), sem login, que mostra sempre a versão mais atual.
  O botão **Aprovar esta opção** abre o WhatsApp da empresa com a mensagem pronta.

## Como é feito
| Parte | Onde |
|---|---|
| Telas (HTML/CSS/JS puro, sem montagem) | `public/` |
| Servidor (rotas `/api`) | `servidor/api.js`, chamado por `api/index.js` na Vercel |
| Banco (Neon na nuvem; PGlite no computador) | `servidor/bd.js` |
| Passe do portal (cópia de `taxi20-app/src/servidor/passe.ts`) | `servidor/passe.js` |
| Testes | `tests/api.test.js` → `npm test` |

## Testar no computador
1. Na primeira vez: `npm install`.
2. `npm run dev` → abre em `http://localhost:5180` com um **banco de teste** (pasta `dados/banco-local`).
3. Para entrar sem o portal: `npm run passe-teste` e abra o link mostrado (vale 60 segundos).

> Nunca teste com o banco de produção: no `.env.local` deste computador, `DATABASE_URL` fica **vazio**.

---

# Publicação (passo a passo)

> **Regras:** senhas nunca vão no chat nem para o Git. O Claude só faz commit quando você disser **"salvar"**
> e só envia para o GitHub com o seu **"pode publicar"**.

## Parte 1 — GitHub
1. Você entra em **github.com** → **New repository**.
   - Nome: `taxi20-orcamentos`
   - Marque **Private**.
   - **Não** marque README, .gitignore nem licença (o repositório precisa nascer vazio).
   - Clique em **Create repository**.
2. Você me diz **"pode publicar no GitHub"** e eu envio o código para `github.com/dudufla8/taxi20-orcamentos`.

## Parte 2 — Projeto na Vercel
1. **vercel.com** → **Add New → Project** → escolha `taxi20-orcamentos` → **Import**.
2. Em **Framework Preset**, deixe **Other**. Não mude mais nada.
3. Clique em **Deploy**. Vai abrir, mas ainda sem banco (isso é normal, vem na Parte 3).

## Parte 3 — Banco Neon
1. No projeto `taxi20-orcamentos` na Vercel → aba **Storage** → **Create Database** → **Neon** → **Continue**.
2. Região **São Paulo**, nome `taxi20-orcamentos`, plano Free → **Create**.
3. Quando perguntar, **ligue ao projeto** `taxi20-orcamentos` (marque Production). A Vercel cria a variável `DATABASE_URL` sozinha.
   As tabelas são criadas sozinhas no primeiro acesso.

## Parte 4 — Segredo do passe
1. Abra o `.env.local` da pasta **`taxi20-app`** com o Bloco de Notas e copie **só o valor** depois de `PORTAL_PASSE_SEGREDO=`.
2. Projeto `taxi20-orcamentos` → **Settings → Environment Variables** → **Add**:
   - Key: `PORTAL_PASSE_SEGREDO`
   - Value: o valor copiado
   - Marque como **Sensitive** → **Save**.
3. **Deployments** → **⋯** no mais recente → **Redeploy**.

## Parte 5 — Cartão no portal
1. Você me diz **"pode publicar o portal"**: eu salvo e envio o cartão **Orçamentos** para o `taxi20-portal`.
   A Vercel publica o portal sozinha.
2. No portal → **Endereços dos módulos** → **Orçamentos**: cole o endereço da Parte 2 (ex.: `https://taxi20-orcamentos.vercel.app/`) → **Salvar**.
3. Quem vê o cartão: **Administração** e **Atendimento**. Para outros perfis, marque "Abrir os Orçamentos de transporte" em **Usuários e perfis**.
4. Teste: clique no cartão **Orçamentos**. Ele deve abrir já com o seu nome no canto.

## Parte 6 — Arrumar a empresa
1. Dentro do Orçamentos → **Minha empresa**: confira nome, CNPJ e logo, e preencha **WhatsApp** e **e-mail**.
   Sem WhatsApp ou e-mail, o cliente não vê o botão **Aprovar esta opção**.
2. Preencha a forma de pagamento e as condições padrão.

## (Opcional) Endereço próprio
Igual ao portal (Registro.br, `agenciatx.ia.br`): na Vercel → **Domains** → `orcamentos.agenciatx.ia.br`,
e no Registro.br uma entrada **CNAME** `orcamentos` com o valor que a Vercel mostrar. Depois, troque o endereço
em **Endereços dos módulos**. Atenção: links já enviados a clientes continuam no endereço antigo (os dois funcionam).

## Se algo der errado
| Mensagem | O que fazer |
|---|---|
| "Falta configurar o banco (DATABASE_URL)…" | Parte 3 não terminou, ou faltou o **Redeploy**. |
| "A entrada pelo portal ainda não foi configurada" | Falta `PORTAL_PASSE_SEGREDO` (Parte 4) + **Redeploy**. |
| "O link de entrada venceu ou é inválido" | O segredo está diferente do portal, ou a página demorou mais de 60 s. Clique no cartão de novo. |
| O cartão aparece mas não abre | Falta o endereço em **Endereços dos módulos** (Parte 5). |
