---
name: demo-ready
description: Final pre-submission checklist for the hackathon — verify the payment happy path end to end, secrets hygiene for a public repo, README with AI-usage disclosure, backup demo assets, and pitch script. Use in the last hours before judging or when asked "are we ready to submit/demo".
disable-model-invocation: true
---

# Checklist "listos para la demo"

Revisa cada punto, arregla lo que puedas y reporta una tabla ✅ / ❌ con la acción pendiente.

## 1. El pago funciona
- [ ] Ejecuta el happy path completo contra la Test Wallet (con playwright si está disponible): crear incoming → quote → aprobar en la wallet → outgoing → el pago aparece en la receptora.
- [ ] Manejo visible de: rechazo del usuario, quote expirado, error del SDK (mensaje amigable, no stacktrace).
- [ ] El deploy público responde y sus env vars están configuradas.

## 2. Seguridad del repo público
- [ ] `git ls-files` no contiene `.env`, `*.key` ni tokens. Busca también strings tipo `BEGIN PRIVATE KEY` en el historial (`git log -p -S "PRIVATE KEY"`).
- [ ] `.gitignore` cubre `.env*`, `*.key` y `node_modules`.
- [ ] El SDK y la llave solo existen en el servidor.
- [ ] Corre `/security-review`.

## 3. README (los jueces lo leen)
- [ ] Problema, solución y a quién ayuda (3 líneas).
- [ ] Cómo usamos Open Payments: qué grants, qué flujo y qué feature avanzada. Diagrama Mermaid del flujo.
- [ ] Cómo correrlo: env vars en `.env.example` y comandos.
- [ ] Link al demo desplegado y al video.
- [ ] **Declaración de uso de IA** (requisito): herramientas usadas y para qué.
- [ ] Equipo.

## 4. Respaldos
- [ ] Screenshots del happy path (playwright) en `docs/demo/`.
- [ ] Video de 1–2 min del flujo, por si falla el internet en vivo.
- [ ] Wallets de prueba con saldo suficiente y credenciales a mano.

## 5. Pitch (3–5 min)
Genera `docs/PITCH.md` con:
1. Hook: un dato o historia del problema (15 s).
2. Problema y usuario.
3. Demo en vivo del happy path (el centro del pitch).
4. Por qué Open Payments: qué habilita que otros rieles no.
5. Impacto, mercado y modelo de negocio.
6. Siguientes pasos y escala.
7. Cierre memorable.

Mapea explícitamente cada sección a los ejes de la rúbrica (Idea / Impacto / Implementación). Ofrece crear el deck con el skill `pptx` si está instalado.
