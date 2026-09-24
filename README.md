# testpilot-mcp

Servidor MCP en TypeScript para hablar con la API de [Test Pilot](https://test-pilot-management-tool.vercel.app)
(el test case management tool interno de RAVN QA) desde Claude Code u otro cliente MCP.

Construido como parte del flujo de agentes de QA ("Test Pilot Agent Workflow"): agentes que generan
test cases a partir de un ticket de Linear y después corren una ejecución manual en staging.

## Qué resuelve

Test Pilot tiene una API REST completa (`/api/docs`, OpenAPI 3.0), pero:

- No hay API token / service account: todo corre sobre la cookie de sesión de Auth.js v5
  (`authjs.session-token`, o `__Secure-authjs.session-token` en producción sobre HTTPS).
- El `PUT` de un test case reemplaza el objeto completo. Actualizar solo un campo a mano
  requiere hacer `GET` → mergear → `PUT` de nuevo, o se pisan los campos que no mandaste.
- El formato de test case que usamos (title, description, preconditions) tiene reglas
  específicas que un agente puede romper fácilmente si arma el request a mano.

Este MCP resuelve las tres cosas: maneja la sesión, hace el merge de las actualizaciones, y
valida el formato antes de mandar nada a la API.

## Setup

```bash
npm install
npx playwright install chromium   # solo la primera vez, para el script de login
npm run build
```

### Login

La API no tiene token de servicio, así que la sesión se obtiene logueándote vos misma una vez:

```bash
npm run login
```

Esto abre una ventana de Chromium (separada de cualquier otro navegador que tengas abierto).
Iniciá sesión ahí con tu cuenta de RAVN (SSO/email) y el script detecta la cookie de sesión y
la guarda en `.session/session.json` (gitignored, nunca se sube ni se comparte).

Cuando la sesión expire vas a ver un error pidiendo volver a correr `npm run login`.

## Uso con Claude Code

```bash
claude mcp add --scope user testpilot -- node "$(pwd)/dist/index.js"
```

`--scope user` lo deja disponible en cualquier proyecto, no solo en el repo donde lo corriste.
Si editás el código, hay que reconstruirlo para que el servidor registrado tome los cambios:

```bash
npm run build
```

## Tools disponibles

| Tool | Qué hace |
|---|---|
| `list_projects` | Lista los proyectos de Test Pilot a los que tenés acceso |
| `list_features` | Lista los features de un proyecto, para no inventar uno nuevo |
| `list_labels` | Lista los labels de la organización (solo lectura, ver Limitaciones) |
| `search_test_cases` | Busca TCs existentes por texto, feature, tipo o status |
| `get_test_case` | Lee un TC completo, incluyendo sus steps |
| `create_test_case` | Crea un TC nuevo, siempre como `DRAFT` y `ai_generated: true` |
| `update_test_case` | Actualiza campos de un TC existente (GET + merge + PUT interno) |

### Formato de test case

`create_test_case` y `update_test_case` validan:

- `title`: `Area - Module - Action - Scenario` (mínimo 4 segmentos separados por ` - `)
- `description`: debe empezar con `Covers...` o `Verifies...`
- `preconditions`: `Role: X | State: Y | Location: Z`
- `steps`: al menos uno, cada uno con `action` y `expectedResult`

`status`, `aiGenerated` y `automationStatus` no son parámetros de `create_test_case`: siempre se
crea `DRAFT` / `true` / `NOT_AUTOMATED`. `update_test_case` no permite pasar un TC a `READY` — esa
promoción la hace la QA humana en la UI de Test Pilot.

## Limitaciones conocidas (API, no de este MCP)

- **Labels no se pueden asignar a un test case todavía.** Confirmado probando contra el
  sandbox: mandar `labels` en `POST /test-cases` (con ids válidos o inválidos) no falla, pero
  tampoco persiste nada — el TC siempre vuelve con `labels: []`. `list_labels` queda solo para
  consulta hasta que la API lo soporte.
- **Crear un label nuevo requiere rol ADMIN** de la organización en Test Pilot.
- Los endpoints `/ai/generate`, `/ai/improve` y `/ai/suggest-gaps` existen pero tienen costo por
  uso — no están expuestos como tools acá a propósito, para no gastar sin que sea una decisión
  explícita.
- Datos legacy pueden tener `description`/`preconditions` en `null` o steps sin
  `expectedResult` — los tipos de lectura lo contemplan, pero un TC *nuevo* siempre debe
  cumplir el formato completo.

## Estructura

```
src/
  session.ts            guarda/lee la cookie de sesión en .session/session.json
  login.ts              script interactivo de login (Playwright, ventana separada)
  types.ts               tipos de los recursos de Test Pilot
  schemas.ts             validación Zod del formato de test case
  testpilot-client.ts     cliente HTTP: resuelve nombres a ids, hace GET+merge+PUT
  index.ts               servidor MCP, registra los tools
```
