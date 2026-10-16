# Proyecto: Hackathon Open Payments (Interledger)

Equipo en una hackathon de 24–48 h. Objetivo: un POC con un **flujo de pago real funcionando** sobre Open Payments, más un pitch. Prioridad: **demo funcional > features**. Idioma del equipo: español. Código e identificadores en inglés.

> Idea: **ALIVE**: una aprobación del pagador (grant interactivo con límite) se reparte en varios pagos a distintos destinatarios el día de pago. La especificación completa está en @AGENTS.md y las decisiones del backend en @docs/ARCHITECTURE-BACKEND.md (estas mandan sobre AGENTS.md cuando son más específicas).

## Reglas duras
- Integrar la API de Open Payments es obligatorio. Todo flujo nuevo debe terminar en un pago real en la Test Wallet.
- El repo es **público**: nunca commitear `.env`, `private.key` ni tokens. Verificar `.gitignore` antes de cada commit.
- **La llave privada y el SDK solo corren en el backend.** Al frontend solo se le manda `interact.redirect`.
- Wallet addresses siempre con `https://`, nunca `$`. Leer `authServer` y `resourceServer` con `walletAddress.get()`; nunca hardcodearlos.
- Amounts: `value` es un **string** entero en unidades mínimas, y `assetCode`/`assetScale` se toman de la wallet.
- Usar `isFinalizedGrantWithAccessToken` (no el deprecado `isFinalizedGrant`).
- Ante la duda sobre la API, consultar context7 o https://openpayments.dev antes de inventar.

## Stack (por defecto, ajustable)
- Node 20+ (ideal 22), TypeScript, `tsx` para correr scripts.
- `@interledger/open-payments` v7.x
- Frontend sugerido: Next.js (App Router) con API routes como backend del SDK, o Express más un front simple.
- Deploy temprano: Vercel o Render. La llave va en una env var en base64.

## Comandos
- `npm run dev` / `npm run typecheck` / `npm run lint` / `npm test`
- `npm run spike:s0`, `npm run spike:s2`: spikes contra la Test Wallet (los corre una persona, no Claude)

## Cómo trabajar
- Features no triviales: plan mode primero, luego implementar en pasos chicos y commits frecuentes.
- Después de cada feature: probar el flujo de pago completo (playwright) y correr `/code-review`.
- Mantener el happy path del demo **siempre** funcionando en `main`.
- Errores del SDK: loguear `OpenPaymentsClientError` con `status`, `code`, `description` y `validationErrors`.

## Contexto detallado
- Referencia técnica de Open Payments (flujo, API, errores típicos): @docs/OPEN-PAYMENTS.md
- Criterios de jueces, ganadores previos e ideas: docs/IDEAS-Y-CRITERIOS.md
- Setup de Claude Code y skills: docs/SKILLS-Y-SETUP-CLAUDE-CODE.md
