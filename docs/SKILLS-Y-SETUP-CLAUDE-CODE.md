# Setup de Claude Code para la hackathon (VS Code)

> Verificado contra la documentación oficial el 2026-10-15. Fuentes al final.
> En VS Code: escribe `/plugins` en el panel de Claude para instalar desde la interfaz.
> Los comandos `claude ...` se corren en la terminal integrada (requiere el CLI instalado).

## 1. Top recomendado (instala 6–8, no todo: cada plugin consume contexto)

| # | Qué | Por qué en esta hackathon | Instalar |
|---|-----|---------------------------|----------|
| 1 | **context7** (MCP) | Docs actualizadas de librerías (Next.js, `@interledger/open-payments`…). Evita APIs inventadas | `/plugin install context7@claude-plugins-official` |
| 2 | **superpowers** | Brainstorming, planes, TDD, debugging sistemático, worktrees | `/plugin install superpowers@claude-plugins-official` |
| 3 | **frontend-design** | UI pulida y no genérica = puntos en la demo | `/plugin install frontend-design@claude-plugins-official` |
| 4 | **playwright** | Claude prueba el flujo de pago en el navegador y saca screenshots | `/plugin install playwright@claude-plugins-official` |
| 5 | **commit-commands** | commit / push / PR en un comando | `/plugin install commit-commands@claude-plugins-official` |
| 6 | **security-guidance** | Detecta secretos hardcodeados (¡la private key!), inyecciones, SSRF | `/plugin install security-guidance@claude-plugins-official` |
| 7 | **vercel** (o `netlify-skills` / `render`) | Deploy temprano y leer logs de build | `/plugin install vercel@claude-plugins-official` |
| 8 | **typescript-lsp** | Navegación precisa en TS | `/plugin install typescript-lsp@claude-plugins-official` |
| 9 | **document-skills** (pptx) + **example-skills** (theme-factory, webapp-testing, mcp-builder) | Pitch deck y estilos | `/plugin marketplace add anthropics/skills` → `/plugin install document-skills@anthropic-agent-skills` y `example-skills@anthropic-agent-skills` |
| 10 | **supabase** (opcional) | Auth + Postgres en minutos si necesitan BD | `/plugin install supabase@claude-plugins-official` |

Ya vienen integrados (no instalar nada): `/code-review`, `/simplify`, `/security-review`, `/plan`, `/rewind`, `/compact`, `/context`, `/fewer-permission-prompts`.

> ⚠️ El plugin `stripe` es muy popular para pagos, pero **Open Payments no es Stripe**: no lo instalen salvo que la idea combine ambos.

MCP alternativos por terminal:
```bash
claude mcp add --transport http context7 https://mcp.context7.com/mcp
```
```bash
claude mcp add playwright npx @playwright/mcp@latest
```

## 2. Skills propias de este proyecto (ya creadas en `.claude/skills/`)

| Skill | Uso |
|-------|-----|
| `/open-payments` | Se activa sola al tocar código de pagos. Contiene el flujo GNAP correcto y los errores típicos |
| `/hackathon-ideate` | Generar y puntuar ideas contra los criterios de los jueces (para la reunión con el equipo) |
| `/demo-ready` | Checklist final: demo sin fallos, README, video de respaldo y pitch |

## 3. Flujo de trabajo recomendado

1. **Hora 0**: `git init`, primer commit, conectar el deploy (Vercel/Render) desde la primera hora.
2. **Cada feature**: plan mode (Shift+Tab) → aprobar → `acceptEdits` → probar (playwright) → `/code-review` → commit.
3. **Paralelo**: una pestaña de Claude por persona o feature, idealmente cada una en su propio git worktree (`claude --worktree nombre`) para no pisarse.
4. **Contexto limpio**: `/clear` entre tareas distintas, `/compact` en hilos largos, investigación pesada → subagentes.
5. **Si algo se rompe**: `/rewind` (o pasar el mouse sobre un mensaje en VS Code → rewind).
6. **Últimas 3 h**: congelar features, README + diagrama Mermaid, deck (pptx + theme-factory), screenshots y video de respaldo del happy path.

## 4. Permisos (menos interrupciones)

`.claude/settings.json` ya incluye un allowlist básico (npm, git, docs de Open Payments). Después de unas horas de trabajo corre `/fewer-permission-prompts` para que Claude proponga más reglas según lo que realmente usan.

## 5. Atajos de VS Code

- `Alt+K`: menciona la selección actual (`@archivo.ts#5-10`).
- `Ctrl+Esc`: alternar foco entre editor y Claude.
- Varias conversaciones: "Open in New Tab".

## Fuentes
- https://code.claude.com/docs/en/skills · /plugins · /mcp · /memory · /permissions · /hooks-guide · /vs-code · /worktrees
- https://github.com/anthropics/skills
- https://github.com/anthropics/claude-plugins-official
- https://github.com/obra/superpowers
- https://github.com/hesreallyhim/awesome-claude-code
