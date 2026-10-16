---
name: hackathon-ideate
description: Brainstorm, score and pick the hackathon idea for the Open Payments hackathon against the judging rubric (idea quality, impact, implementation 0-5), then turn the winner into a scoped MVP plan and update CLAUDE.md. Use when the team discusses ideas, wants to compare options, or needs to define scope.
argument-hint: "[ideas del equipo, o vacío para proponer]"
disable-model-invocation: true
---

# Ideación y selección de idea

Entrada del equipo: $ARGUMENTS

Lee docs/IDEAS-Y-CRITERIOS.md (rúbrica, ganadores previos, banco de ideas) y la sección de patrones avanzados de docs/OPEN-PAYMENTS.md.

## Paso 1: opciones
Si el equipo trajo ideas, úsalas. Si no, propone 6 ideas: problema local concreto, usuario específico y la feature de Open Payments que luce cada una.

## Paso 2: puntuar (tabla)
Para cada idea, puntúa de 0 a 5 con una línea de justificación:
- **Idea** (problema claro y novedoso)
- **Impacto** (usuarios, mercado, escalabilidad, historia para el pitch)
- **Implementación factible en el tiempo** (riesgo técnico, ¿cabe en 24 h con 4–5 personas?)
- **Uso de Open Payments** (¿usa grants con límites, recurrencia, split o FX, o es un pago trivial?)
- **Factor "wow" en demo** (¿se ve bien en 3 minutos?)

Ordena por total y recomienda una, explicando el porqué.

## Paso 3: MVP de la idea elegida
- Pitch de una frase: "Para [usuario] que [problema], [producto] permite [acción] usando Open Payments para [feature]".
- **Happy path del demo** paso a paso (máximo 5 pantallas o pasos), marcando dónde ocurre cada llamada de Open Payments.
- Lista **MUST** (indispensable para el demo) / **NICE** (si sobra tiempo) / **NO** (fuera de alcance).
- Arquitectura mínima (diagrama Mermaid) y stack.
- Reparto sugerido para 4–5 personas: backend de pagos, frontend, integración y QA, pitch y negocio.
- Cronograma por bloques horarios, con el **feature freeze** 3 h antes del cierre.
- Riesgos técnicos y su plan B.

## Paso 4
Ofrece reemplazar la línea "Idea de solución: POR DEFINIR" de CLAUDE.md con el resumen de la idea elegida (problema, usuario, flujo, feature OP) y crear `docs/PLAN.md` con el MVP.
