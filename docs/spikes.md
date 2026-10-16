# Spikes: resultados

Cada spike prueba una incógnita contra la Interledger Test Wallet (AGENTS.md §11). Los corre una persona porque necesitan las llaves y una aprobación en el navegador. Después de correr un spike, pega aquí el bloque `RESULTADO` que imprime y actualiza la columna Status de AGENTS.md §11.

| Spike | Resultado | Evidencia (ids) | Notas |
|-------|-----------|-----------------|-------|
| S0: un pago completo (8 pasos) | NOT RUN | | `npm run spike:s0`. Usa el diseño D2: incoming abierto y quote de débito fijo de 1.00. También confirma la regla de completado D10 y el hash D5. |
| S1: grant sin receiver, usado después | NOT RUN | | `npm run spike:s2`. Grant con límite total de 3.00, sin `receiver` ni `interval`. |
| S2: varios pagos bajo un solo grant | NOT RUN | | `npm run spike:s2`. 1.00 → A y 2.00 → B; el tercer pago de 0.50 tiene que ser rechazado (cualquier rechazo cuenta como PASS). |
| S3: fecha futura / interval en limits | NOT RUN | | Sin script. Fallback: el servidor guarda el token y ejecuta en la fecha. |
| S4: FX USD → otra moneda | NOT RUN | | Sin script. Se puede probar con `spike:s2` poniendo un receptor en otra moneda (D2 hace FX solo). |
| S5: vida del token y rotación | NOT RUN | | `npm run spike:s2`. Rota a los 15 s, imprime `expires_in` y comprueba que el token viejo deje de servir. |
| S6: revocación detectable | NOT RUN | | Sin script. Fallback: toggle `revoke-sim`. |
| S7: wallet COP recibe de pagador USD | NOT RUN | | Sin script. Mismo método que S4. |

## Qué observar al correrlos

- **D10 (regla de completado, pendiente de confirmar).** COMPLETADO cuando `incoming.receivedAmount >= quote.receiveAmount`; FALLIDO cuando `outgoing.failed`; TIMEOUT si no pasa ninguna de las dos en 30 s. En cada intento se imprimen `sentAmount`, `debitAmount`, `receiveAmount` y `receivedAmount`. Hay que anotar si `sentAmount` llega a igualar a `debitAmount`. Si no llega, la regla antigua (`sent === debit`) no habría servido.
- **D5 (hash).** El spike imprime si el `hash` del callback coincide con `base64(sha256(clientNonce\nfinishNonce\ninteract_ref\nauthServer))`. Si no coincide, anotarlo y dejar `STRICT_HASH=false`.
- **S5.** Anotar `expires_in` del token original y del rotado, y si el token viejo queda rechazado.
- **Tercer pago de S2.** Anotar en qué paso lo rechazan (`quote.create` o `outgoing.create`) y con qué `status`/`code`. El dominio va a tener que mapear ese error.

## Contraste del SDK con nuestros docs (`@interledger/open-payments@7.4.0`)

Revisado contra `node_modules/@interledger/open-payments/dist/**/*.d.ts` antes de escribir `lib/op`.

| Tema | Docs | Tipos instalados | Acción |
|------|------|------------------|--------|
| `createAuthenticatedClient` | `{walletAddressUrl, privateKey, keyId, logLevel?, validateResponses?}` | Igual. `privateKey: string \| KeyLike`; un string se toma como ruta (relativa a `cwd`) y, si no existe el archivo, como PEM | Ninguna. `OP_PRIVATE_KEY_B64` se decodifica a PEM en `lib/env.ts` |
| `grant.request` / `grant.continue` | `continue({url, accessToken}, {interact_ref})` | Igual. Devuelve `Grant \| GrantContinuation` | Ninguna |
| Type guards | `isPendingGrant`, `isFinalizedGrantWithAccessToken` | Existen; `isFinalizedGrant` sigue exportado pero deprecado | Solo usamos los no deprecados |
| `token.rotate` | `{url: manage, accessToken}` | Igual. Devuelve `{access_token: {value, manage, expires_in?, access}}` | Guardar el **nuevo** `manage` además del valor |
| `interact.finish` | `{method:'redirect', uri, nonce}` | Igual; la respuesta trae `interact.redirect` e `interact.finish` (string) | `finish` es el segundo input del hash |
| Limits del grant de salida | `debitAmount \| receiveAmount`, `receiver?`, `interval?` | Igual (XOR entre los dos montos); `identifier` es obligatorio | Ninguna |
| `quote.create` | `debitAmount` **o** `receiveAmount` | Igual (`never` en el otro) | Ninguna |
| `outgoingPayment.create` | `{walletAddress, quoteId, metadata?}` | **Además** acepta `{walletAddress, incomingPayment, debitAmount, metadata?}` sin quote | Diferencia: no la usamos (queremos mostrar la quote), pero sirve de plan B si las quotes dan problemas |
| `outgoingPayment.getGrantSpentAmounts` | Mencionado | `{url: resourceServer, accessToken}` → `{spentDebitAmount \| null, spentReceiveAmount \| null}` | Usado en S2 |
| Módulo | Docs decían `"type":"module"` | El SDK es CommonJS; el proyecto no usa `"type":"module"` | Los scripts van envueltos en `async function main()` (docs actualizados) |
