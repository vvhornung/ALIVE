# Cómo ganar: criterios, ganadores previos e ideas

## Criterios de evaluación (FAQ oficial de Interledger)

Cada eje se califica de 0 a 5:

| Eje | 3 | 4 | 5 |
|-----|---|---|---|
| **Calidad de la idea** | Problema claro | Problema validado y relevante | Novedoso |
| **Impacto potencial** | Usuarios definidos | Impacto medible y plan de escala creíble | Camino viable a despliegue y go-to-market |
| **Implementación** | Demo funcional | Demo pulida y profundidad técnica | Técnicamente impresionante, combina varias tecnologías |

**Reglas duras** (FAQ 2025; confirmen en la guía de su evento):
- Integrar la API de Open Payments es **obligatorio**; sin eso, descalificación.
- El repo debe ser **público** y hay que **declarar el uso de IA**.
- No se permite código escrito antes del evento. Este starter es solo un ejemplo de referencia de los docs; pregunten a los organizadores si pueden usarlo o si deben reescribirlo en vivo.
- Equipos de 4–5. El entregable es un POC con un flujo de pago funcional más un pitch.

**Consejos de los organizadores**: primero hagan funcionar UN pago. Resuelvan un problema bien. Muestren un uso pensado de Open Payments (grants con límites, pagos recurrentes, split payments), no una integración mínima.

## Ganadores 2025 (CDMX, 47 equipos, 24 h)

1. **VibePayments**: SaaS para turismo y cadena de suministro con pagos simultáneos (nómina, proveedores, propinas) usando **split payments**.
2. **Pagos**: pagos sin dispositivo, autorizados con biometría de rostro y voz. Enfoque en accesibilidad.
3. **Shabaha**: educación más pagos. Los estudiantes ganan puntos y los sponsors pagan cross-border.
4. **Premio de la comunidad, Paguito**: un bot de WhatsApp con IA que detecta pedidos de transferencia en el chat y dispara el flujo de Open Payments.

Patrón común: un **problema local concreto** (LatAm, efectivo, remesas, informalidad), **UX fuera de lo común** (chat, biometría) y **uso avanzado** del estándar (split, cross-border).

## Banco de ideas para la reunión con el equipo

| Idea | Feature de OP que luce | Gancho del pitch |
|------|------------------------|------------------|
| Remesas USD→MXN con monto fijo de recepción | `receiveAmount`, FX | Remesas a México: costos altos de envío |
| "Tandas" / ahorro grupal automatizado | `interval` recurrente + split | Práctica cultural muy conocida, ahora digital |
| Cobro QR para tienditas y ambulantes | incoming payments abiertos + metadata | ~90% de transacciones en efectivo en México |
| Agente de IA con presupuesto pre-autorizado (pay-per-use / API) | grant con límites + `getGrantSpentAmounts` | Pagos agénticos, muy de moda |
| Propinas o split automático en restaurantes | split payments | Repartir entre meseros y cocina al instante |
| Nómina de trabajadores informales o gig | outgoing en lote + FX | Inclusión financiera |
| Suscripciones con tope de gasto (anti-sorpresa) | `limits` + `interval` | El usuario controla cuánto se le cobra |
| Bot de Telegram/WhatsApp para cobrar y pagar | `interact.redirect` en el chat | Pagos donde la gente ya está |
| Creadores con Web Monetization + micropagos | Web Monetization + incoming | Alternativa a los anuncios |
| Donaciones transparentes / crowdfunding | incoming payments + `metadata.externalRef` | Trazabilidad para ONGs |

Usen `/hackathon-ideate` en Claude Code para puntuar sus ideas contra la rúbrica.

## Fuentes
- https://interledger.org/summit/hackathon/faqs
- https://interledger.org/news/building-real-solutions-interledger-hackathon-winners-2025
- https://community.interledger.org/sriramjeyakumar/building-with-interledger-how-we-used-open-payments-to-win-hackomania-2025-3329
