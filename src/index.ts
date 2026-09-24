import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { TestPilotClient } from "./testpilot-client.js";
import {
  createTestCaseInputSchema,
  getTestCaseInputSchema,
  listFeaturesInputSchema,
  searchTestCasesInputSchema,
  updateTestCaseInputSchema,
} from "./schemas.js";

const client = new TestPilotClient();

const server = new McpServer({ name: "testpilot-mcp", version: "0.1.0" });

function textResult(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

function errorResult(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return { content: [{ type: "text" as const, text: `Error: ${message}` }], isError: true };
}

server.tool(
  "list_projects",
  "Lista los proyectos de Test Pilot disponibles para tu cuenta, con su id y slug.",
  {},
  async () => {
    try {
      return textResult(await client.listProjects());
    } catch (err) {
      return errorResult(err);
    }
  }
);

server.tool(
  "list_features",
  "Lista los features existentes de un proyecto, para elegir uno real en vez de inventar uno nuevo.",
  listFeaturesInputSchema.shape,
  async ({ project }) => {
    try {
      const p = await client.resolveProject(project);
      return textResult(await client.listFeatures(p.id));
    } catch (err) {
      return errorResult(err);
    }
  }
);

server.tool(
  "list_labels",
  "Lista los labels existentes en la organización. Solo lectura: crear labels requiere rol ADMIN " +
    "en Test Pilot, y hoy la API no permite asignar labels a un test case desde create/update.",
  {},
  async () => {
    try {
      return textResult(await client.listLabels());
    } catch (err) {
      return errorResult(err);
    }
  }
);

server.tool(
  "search_test_cases",
  "Busca test cases existentes en un proyecto por texto, feature, tipo o status. " +
    "Usalo antes de crear un TC nuevo para evitar duplicados.",
  searchTestCasesInputSchema.shape,
  async ({ project, query, feature, type, status, page }) => {
    try {
      const p = await client.resolveProject(project);
      const featureId = feature ? (await client.resolveFeature(p.id, feature)).id : undefined;
      return textResult(
        await client.searchTestCases(p.id, { query, featureId, type, status, page })
      );
    } catch (err) {
      return errorResult(err);
    }
  }
);

server.tool(
  "get_test_case",
  "Lee un test case completo por id, incluyendo sus steps.",
  getTestCaseInputSchema.shape,
  async ({ project, testCaseId }) => {
    try {
      const p = await client.resolveProject(project);
      return textResult(await client.getTestCase(p.id, testCaseId));
    } catch (err) {
      return errorResult(err);
    }
  }
);

server.tool(
  "create_test_case",
  "Crea un test case en Test Pilot siguiendo el formato acordado (title 'Area - Module - Action - " +
    "Scenario', description que arranca con 'Covers'/'Verifies', preconditions 'Role: X | State: Y | " +
    "Location: Z'). Siempre se crea como DRAFT y ai_generated=true; el feature debe existir ya " +
    "(usá list_features primero).",
  createTestCaseInputSchema.shape,
  async (input) => {
    try {
      const p = await client.resolveProject(input.project);
      const feature = await client.resolveFeature(p.id, input.feature);
      const created = await client.createTestCase(p.id, {
        featureId: feature.id,
        title: input.title,
        description: input.description,
        preconditions: input.preconditions,
        steps: input.steps,
        expectedResult: input.expectedResult,
        priority: input.priority,
        type: input.type,
      });
      return textResult(created);
    } catch (err) {
      return errorResult(err);
    }
  }
);

server.tool(
  "update_test_case",
  "Actualiza campos de un test case existente (GET + merge + PUT internamente, porque la API " +
    "reemplaza el TC entero). No permite promover un TC a status READY: eso lo hace la QA humana " +
    "en la UI.",
  updateTestCaseInputSchema.shape,
  async ({ project, testCaseId, ...patch }) => {
    try {
      const p = await client.resolveProject(project);
      const updated = await client.updateTestCase(p.id, testCaseId, {
        title: patch.title,
        description: patch.description,
        preconditions: patch.preconditions,
        steps: patch.steps,
        expectedResult: patch.expectedResult,
        priority: patch.priority,
        type: patch.type,
        status: patch.status,
      });
      return textResult(updated);
    } catch (err) {
      return errorResult(err);
    }
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
