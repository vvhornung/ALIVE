---
name: open-payments
description: Implement, debug or review Open Payments (Interledger) integrations with @interledger/open-payments — grants (GNAP), incoming payments, quotes, outgoing payments, interactive redirect/callback, token rotation, recurring/split payments. Use whenever writing or fixing payment code, wallet address handling, or SDK errors in this project.
argument-hint: "[qué implementar o el error a depurar]"
---

# Open Payments: implementación correcta a la primera

Tarea: $ARGUMENTS

## Antes de escribir código
1. Lee @docs/OPEN-PAYMENTS.md, @docs/ARCHITECTURE-BACKEND.md y el wrapper `lib/op/` (ejemplo completo: `scripts/s0-single-payment.ts`). Reutiliza `lib/op` en vez de llamar al SDK directo.
2. Si necesitas una firma que no esté ahí, consulta context7 (`@interledger/open-payments`) o `https://openpayments.dev/sdk/<pagina>/`. **No inventes métodos.**

## Reglas que el código DEBE cumplir
- El SDK solo corre en el servidor. Nunca importes `@interledger/open-payments` ni leas la llave en código de cliente o navegador.
- `createAuthenticatedClient({ walletAddressUrl, privateKey, keyId })`: el `keyId` pertenece a `walletAddressUrl`.
- Las wallet addresses llevan `https://`. Si el usuario escribe `$host/path`, conviértela a `https://host/path`.
- Usa `authServer` y `resourceServer` de `walletAddress.get()`, nunca hardcodeados.
- Lado correcto: incoming payment → **receptor**; quote y outgoing → **emisor**.
- El grant `outgoing-payment` lleva `identifier: sender.id`, `limits` (solo `debitAmount` **o** `receiveAmount`) y `interact.finish` con nonce.
- `limits.debitAmount = quote.debitAmount` exacto.
- Amounts: `value` string entero; `assetCode`/`assetScale` de la wallet. Para mostrar: `Number(value) / 10 ** assetScale`.
- Usa los type guards `isPendingGrant` e `isFinalizedGrantWithAccessToken`.
- Persiste por sesión el estado del redirect: `continue.uri`, `continue.access_token.value`, nonce, `interact.finish`, `quote.id`.
- En el callback: si no viene `interact_ref`, el usuario rechazó y hay que mostrarlo en la UI. Verifica el `hash`.
- Captura `OpenPaymentsClientError` y loguea `status`, `code`, `description` y `validationErrors`.
- Si un token puede expirar (~10 min), rota con `client.token.rotate({ url: manage, accessToken })`.

## Debugging rápido
| Síntoma | Causa probable |
|---------|---------------|
| 401 / invalid signature / invalid client | keyId de otra wallet, llave regenerada, `walletAddressUrl` equivocada |
| Validation error en grant | falta `identifier`, `debitAmount` y `receiveAmount` juntos, `value` numérico |
| Outgoing payment rechazado | límite menor que `quote.debitAmount`, quote expirado |
| Quote falla | incoming sin `incomingAmount` y el quote sin monto |
| `grant.continue` sin access_token | el usuario aún no aprueba, o `interact_ref` ya usado |
| `Cannot use import` / top-level await | el script no se corrió con `tsx` o falta envolverlo en `async function main()` |

Activa `logLevel: 'debug'` en el cliente para ver los requests.

## Al terminar
Prueba el flujo completo contra la Test Wallet (`https://ilp.interledger-test.dev/...`) y confirma que el pago aparece en la wallet receptora.
