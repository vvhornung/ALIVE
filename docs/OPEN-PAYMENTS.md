# Open Payments: referencia técnica

> Verificado el 2026-10-15 contra `@interledger/open-payments@7.4.0` (repo `interledger/open-payments-node`) y openpayments.dev.

## Conceptos

| Concepto | Resumen |
|----------|---------|
| **Wallet address** | URL HTTPS de una cuenta, p. ej. `https://ilp.interledger-test.dev/alice`. El payment pointer equivalente es `$ilp.interledger-test.dev/alice`, pero el SDK necesita **https://**. Un `GET` devuelve `{id, publicName, assetCode, assetScale, authServer, resourceServer}`. Las llaves públicas se publican en `/jwks.json` |
| **Auth server (AS)** | Emite grants y tokens usando GNAP (RFC 9635). El cliente se identifica con su llave firmante; no requiere registro previo |
| **Resource server (RS)** | Expone `incoming-payments`, `quotes` y `outgoing-payments` |
| **Grant** | Autorización delegada. Tipos: `incoming-payment`, `quote`, `outgoing-payment`. Acciones: `create`, `read`, `read-all`, `list`, `list-all`, `complete` |
| **Grant no interactivo** | `incoming-payment` y `quote`: devuelven `access_token` de inmediato |
| **Grant interactivo** | `outgoing-payment` **siempre** es interactivo: el usuario aprueba en `interact.redirect`, vuelve a tu `finish.uri` con `?interact_ref=&hash=` y luego llamas a `grant.continue` |
| **Incoming payment** | Se crea en el **receptor**. Es el destino del pago. Admite `incomingAmount` (opcional), `expiresAt` y `metadata` libre |
| **Quote** | Se crea en el **emisor** con `receiver` = URL del incoming payment. Devuelve `debitAmount` (incluye fees y FX) y `receiveAmount`. Acepta `debitAmount` **o** `receiveAmount`, nunca ambos. Expira |
| **Outgoing payment** | Se crea en el emisor con `quoteId`. Es lo que mueve el dinero |
| **Amount** | `{ value: "1000", assetCode: "USD", assetScale: 2 }` equivale a $10.00. `value` es un **string** en unidades mínimas |
| **Limits** | En el grant de salida: `{ debitAmount \| receiveAmount, receiver?, interval? }`. `interval` es un ISO 8601 repetitivo (`R/2026-10-15T00:00:00Z/P1M`) y sirve para suscripciones |
| **Tokens** | Duran ~10 min. `client.token.rotate({url: manage, accessToken})` y `client.token.revoke(...)` |

## Flujo de un pago (emisor → receptor)

```
1. walletAddress.get(sender) / get(receiver)
2. grant.request(receiver.authServer, incoming-payment)            → token (no interactivo)
3. incomingPayment.create(receiver.resourceServer, {walletAddress, incomingAmount, metadata})
4. grant.request(sender.authServer, quote)                         → token (no interactivo)
5. quote.create(sender.resourceServer, {walletAddress, receiver: incomingPayment.id, method:'ilp'})
6. grant.request(sender.authServer, outgoing-payment + limits + interact.finish) → PendingGrant
7. Usuario abre interact.redirect y aprueba → callback ?interact_ref&hash
8. Verificar hash → grant.continue({url: continue.uri, accessToken: continue.access_token.value}, {interact_ref})
9. outgoingPayment.create(sender.resourceServer, {walletAddress, quoteId})
```

El flujo completo funcionando está en [`scripts/s0-single-payment.ts`](../scripts/s0-single-payment.ts).

## API del SDK (v7.4)

```ts
createAuthenticatedClient({ walletAddressUrl, privateKey /* ruta, PEM o KeyObject */, keyId, logLevel?, validateResponses? })
createUnauthenticatedClient()

client.walletAddress.get({ url }) / getKeys({ url })
client.grant.request({ url: authServer }, { access_token, interact? })   // → PendingGrant | Grant
client.grant.continue({ url, accessToken }, { interact_ref })
client.grant.cancel({ url, accessToken })
client.incomingPayment.create / get / getPublic / complete / list
client.quote.create / get
client.outgoingPayment.create / get / list / getGrantSpentAmounts
client.token.rotate / revoke

// type guards
isPendingGrant, isFinalizedGrantWithAccessToken   // isFinalizedGrant está DEPRECADO
// errores
OpenPaymentsClientError { status, code, description, validationErrors }
```

## Configuración de la Test Wallet

1. https://wallet.interledger-test.dev → crear cuenta (correo real; el KYC acepta datos ficticios).
2. **New account**: elegir moneda (USD, EUR, MXN…) y hacer **Deposit** con dinero de juguete.
3. **Add wallet address** → queda `https://ilp.interledger-test.dev/<nombre>`.
4. **Settings → Developer Keys → Generate public & private key**: se descarga `private.key` y aparece el **Key ID** (UUID).
5. Creen **2 o 3 wallet addresses**: una como identidad del cliente (dueña de la llave), una como emisor y otra como receptor. Idealmente en monedas distintas para lucir el FX.
6. Para ver un checkout funcionando: Test Boutique en https://boutique.interledger-test.dev

La llave es Ed25519 en formato PEM PKCS#8. Para deploy (Vercel, etc.) se puede guardar en base64 en una env var y decodificarla con `Buffer.from(b64,'base64').toString()`.

## Errores típicos

1. Usar `$ilp...` en vez de `https://ilp...`.
2. Que el `keyId` no pertenezca al `walletAddressUrl` del cliente → 401 / invalid signature.
3. Hardcodear `authServer` o `resourceServer`: llevan un UUID de tenant. Léelos siempre con `walletAddress.get()`.
4. Grant en el lado equivocado: incoming va en el **receptor**; quote y outgoing van en el **emisor**.
5. Olvidar `identifier: sender.id` en el grant `outgoing-payment`.
6. Mandar `debitAmount` y `receiveAmount` a la vez.
7. `limits.debitAmount` menor que `quote.debitAmount`: usa el `quote.debitAmount` tal cual.
8. `value` como número o decimal: debe ser un string entero (`"1000"`).
9. Hacer un quote sin monto sobre un incoming payment que no tiene `incomingAmount`.
10. Quotes o tokens expirados si el usuario tarda en aprobar: re-cotizar o rotar.
11. Reusar `interact_ref`: es de un solo uso.
12. El usuario rechaza: el callback llega sin `interact_ref`. Hay que manejarlo.
13. Perder el estado entre el redirect y el callback: guarda `continue.uri`, `continue.access_token`, el nonce, `interact.finish` y `quote.id` por sesión.
14. Los scripts se corren con `tsx` y van envueltos en `async function main()` (el proyecto no usa `"type":"module"`, así que no hay top-level await).
15. **La llave privada nunca va al frontend.** Todo el SDK corre en el backend; al navegador solo se le manda la URL de redirect.
16. Para depurar: `logLevel: 'debug'` en el cliente.

## Patrones "avanzados" que suman puntos

- **FX / remesas**: emisor en USD y receptor en MXN, con `receiveAmount` fijo.
- **Suscripciones / pagos recurrentes**: `limits.interval` + `getGrantSpentAmounts`.
- **Split payments**: varios incoming payments y quotes bajo un mismo grant de salida.
- **Pagos futuros o presupuesto pre-autorizado**: por ejemplo, agentes de IA que pagan por uso.
- **Web Monetization**: `<link rel="monetization" href="https://ilp.interledger-test.dev/tu-wallet">`.
- **Verificar la propiedad de una wallet** como login.

## Links

- Docs: https://openpayments.dev/es/ · Flujo: https://openpayments.dev/concepts/op-flow/ · API: https://openpayments.dev/apis/
- SDK: https://openpayments.dev/sdk/before-you-begin/ (+ `/sdk/grant-create-outgoing/`, `/sdk/quote-create/`, etc.)
- Guías: `/guides/split-payments/`, `/guides/onetime-remittance-fixed-receive/`, `/guides/outgoing-grant-future-payments/`, `/guides/verify-wallet-address-ownership/`
- SDK Node: https://github.com/interledger/open-payments-node (ejemplo `examples/peer-to-peer`)
- Snippets: https://github.com/interledger/open-payments/tree/main/snippets/node
- Otros SDKs: PHP, Rust, Go, Java (`interledger/open-payments-{php,rust,go,java}`). Python y .NET siguen en desarrollo
- Rafiki (servidor de referencia): https://github.com/interledger/rafiki
- Web Monetization: https://webmonetization.org
- Video tutorial: https://www.youtube.com/watch?v=N9ggNr23FYc
