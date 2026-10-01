# testpilot-mcp

A TypeScript MCP server for talking to the [Test Pilot](https://test-pilot-management-tool.vercel.app)
API (RAVN QA's internal test case management tool) from Claude Code or any other MCP client.

Built as part of the QA "Test Pilot Agent Workflow": agents that generate test cases from a
Linear ticket number and then run a manual execution pass on staging.

## What it solves

Test Pilot has a full REST API (`/api/docs`, OpenAPI 3.0), but:

- There's no API token / service account: everything runs on the Auth.js v5 session cookie
  (`authjs.session-token`, or `__Secure-authjs.session-token` in production over HTTPS).
- `PUT` on a test case replaces the whole object. Updating a single field by hand requires a
  `GET` → merge → `PUT` round trip, or the untouched fields get wiped.
- The test case format we use (title, description, preconditions) has specific rules an agent
  can easily break if it builds the request by hand.

This MCP handles all three: manages the session, does the merge for updates, and validates the
format before anything is sent to the API.

## Setup

```bash
npm install
npx playwright install chromium   # first time only, for the login script
npm run build
```

### Login

The API has no service token, so the session comes from logging in yourself once:

```bash
npm run login
```

This opens a Chromium window (separate from any other browser you have open). Sign in there
with your RAVN account (SSO/email), and the script detects the session cookie and saves it to
`.session/session.json` (gitignored, never committed or shared).

When the session expires you'll see an error telling you to run `npm run login` again.

## Using it with Claude Code

```bash
claude mcp add --scope user testpilot -- node "$(pwd)/dist/index.js"
```

`--scope user` makes it available in every project, not just the repo you ran it from. If you
change the code, rebuild so the registered server picks up the changes:

```bash
npm run build
```

## Available tools

| Tool | What it does |
|---|---|
| `list_projects` | Lists the Test Pilot projects you have access to |
| `list_features` | Lists a project's features, so you don't invent a new one |
| `list_labels` | Lists the organization's labels (read-only, see Limitations) |
| `search_test_cases` | Searches existing TCs by text, feature, type, or status |
| `get_test_case` | Reads a full TC, including its steps |
| `create_test_case` | Creates a new TC, always as `DRAFT` and `ai_generated: true` |
| `update_test_case` | Updates fields on an existing TC (GET + merge + PUT internally) |
| `list_suites` | Lists a project's test suites |
| `create_suite` | Creates a new suite (a named group of test cases to run together) |
| `set_suite_test_cases` | Replaces a suite's full test case list, in order |
| `create_test_run` | Creates an execution for a suite; snapshots its test cases as NOT_RUN results |
| `get_test_run` | Reads an execution and every result in it |
| `record_result` | Records PASSED/FAILED/BLOCKED for one test case in a run, by TC-<n> or id |
| `complete_test_run` | Marks an execution COMPLETED (fails if anything is still NOT_RUN) |

All test-case and execution-result tools accept either the internal id or the visible
`TC-<n>`/sequential-id label — both get resolved to what the API actually needs.

### Test case format

`create_test_case` and `update_test_case` validate:

- `title`: `Area - Module - Action - Scenario` (at least 4 segments separated by ` - `)
- `description`: must start with `Covers...` or `Verifies...`
- `preconditions`: `Role: X | State: Y | Location: Z`
- `steps`: at least one, each with `action` and `expectedResult`
- `priority`: `LOW` | `MEDIUM` | `HIGH` | `CRITICAL`
- `type`: `FUNCTIONAL` | `NEGATIVE` | `EDGE_CASE` | `INTEGRATION` | `PERFORMANCE` | `SECURITY` |
  `USABILITY` | `ACCESSIBILITY` (edge cases get their own real type — no need for a label
  workaround)
- `labels`: optional, by name (resolved to ids via `list_labels`); the label must already exist

`status`, `aiGenerated`, and `automationStatus` are not parameters of `create_test_case`: every
TC is always created `DRAFT` / `true` / `NOT_AUTOMATED`. `update_test_case` won't let you move a
TC to `READY` or `MAINTENANCE` — those transitions are done by a human QA in the Test Pilot UI.

## Known limitations / confirmed API bugs (not this MCP)

- **Confirmed bug: a partial `PUT` silently resets `type` and `aiGenerated` to their schema
  defaults.** `testCaseUpdateSchema` is `testCaseCreateSchema.partial()` in the TestPilot source,
  but zod's `.partial()` only makes fields optional — it does not strip their `.default(...)`.
  `type` defaults to `FUNCTIONAL` and `aiGenerated` to `false` on the create schema, so a PUT that
  omits them gets those fields reset even though the caller never touched them. The route already
  works around this for `automationStatus` (see its comment in
  `src/lib/validations/test-case.ts`) but not for `type` or `aiGenerated`. `update_test_case`
  works around it by fetching the current test case and always sending every field back.
- **Creating a new label requires the org ADMIN role.** Labels themselves *can* be assigned on
  create/update — the field is `labelIds` (an array of label ids), not `labels`.
- The `/ai/generate`, `/ai/improve`, and `/ai/suggest-gaps` endpoints exist but cost money per
  call — they're intentionally not exposed as tools here, so nothing gets spent without an
  explicit decision.
- Legacy data can have `description`/`preconditions` set to `null` or steps missing
  `expectedResult` — the read-side types account for that, but a *new* TC must always follow the
  full format.
- `search_test_cases`' text filter only matches against `title` (case-insensitive contains), not
  `description`.

## Structure

```
src/
  session.ts            reads/writes the session cookie in .session/session.json
  login.ts              interactive login script (Playwright, separate window)
  types.ts               Test Pilot resource types
  schemas.ts             Zod validation for the test case format
  testpilot-client.ts     HTTP client: resolves names to ids, does GET+merge+PUT
  index.ts               MCP server, registers the tools
```
