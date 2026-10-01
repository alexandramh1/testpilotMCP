import { loadSessionCookie, TestPilotAuthError } from "./session.js";
import type {
  Execution,
  ExecutionResultValue,
  Feature,
  Label,
  Organization,
  Project,
  Suite,
  TestCase,
  TestStep,
} from "./types.js";

const BASE_URL = "https://test-pilot-management-tool.vercel.app";
const API_URL = `${BASE_URL}/api`;

export class TestPilotApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = "TestPilotApiError";
  }
}

export class TestPilotNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TestPilotNotFoundError";
  }
}

async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const cookie = loadSessionCookie();
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      Cookie: cookie,
      ...init.headers,
    },
  });

  if (res.status === 401) {
    throw new TestPilotAuthError(
      "La sesión de Test Pilot expiró o es inválida. Corré `npm run login` de nuevo."
    );
  }

  const text = await res.text();
  const body = text ? JSON.parse(text) : undefined;

  if (!res.ok) {
    throw new TestPilotApiError(
      `Test Pilot devolvió ${res.status} para ${path}`,
      res.status,
      body
    );
  }

  return body as T;
}

// The org and project catalog rarely changes within a run, so we cache them
// in memory for the lifetime of the MCP process rather than re-fetching on
// every tool call.
let organizationCache: Organization | null = null;
let projectsCache: Project[] | null = null;

export class TestPilotClient {
  async getOrganization(): Promise<Organization> {
    if (organizationCache) return organizationCache;
    const orgs = await apiFetch<Organization[]>("/organizations");
    if (orgs.length === 0) {
      throw new TestPilotNotFoundError("Tu usuario no pertenece a ninguna organización en Test Pilot.");
    }
    organizationCache = orgs[0];
    return organizationCache;
  }

  async listProjects(): Promise<Project[]> {
    if (projectsCache) return projectsCache;
    const org = await this.getOrganization();
    projectsCache = await apiFetch<Project[]>(`/projects?organizationId=${org.id}`);
    return projectsCache;
  }

  async resolveProject(nameOrSlug: string): Promise<Project> {
    const projects = await this.listProjects();
    const match = projects.find(
      (p) =>
        p.slug.toLowerCase() === nameOrSlug.toLowerCase() ||
        p.name.toLowerCase() === nameOrSlug.toLowerCase()
    );
    if (!match) {
      const available = projects.map((p) => p.name).join(", ");
      throw new TestPilotNotFoundError(
        `No existe un proyecto '${nameOrSlug}' en Test Pilot. Proyectos disponibles: ${available}`
      );
    }
    return match;
  }

  async listFeatures(projectId: string): Promise<Feature[]> {
    const result = await apiFetch<{ features: Feature[]; pagination: unknown }>(
      `/features?projectId=${projectId}`
    );
    return result.features;
  }

  async resolveFeature(projectId: string, name: string): Promise<Feature> {
    const features = await this.listFeatures(projectId);
    const match = features.find((f) => f.name.toLowerCase() === name.toLowerCase());
    if (!match) {
      throw new TestPilotNotFoundError(
        `No existe el feature '${name}' en este proyecto. Usá list_features para ver los valores válidos ` +
          "antes de inventar uno nuevo."
      );
    }
    return match;
  }

  async listLabels(): Promise<Label[]> {
    const org = await this.getOrganization();
    const { labels } = await apiFetch<{ labels: Label[] }>(
      `/labels?organizationId=${org.id}`
    );
    return labels;
  }

  async resolveLabelIds(names: string[]): Promise<string[]> {
    if (names.length === 0) return [];
    const labels = await this.listLabels();
    const missing: string[] = [];
    const ids: string[] = [];
    for (const name of names) {
      const match = labels.find((l) => l.name.toLowerCase() === name.toLowerCase());
      if (match) {
        ids.push(match.id);
      } else {
        missing.push(name);
      }
    }
    if (missing.length > 0) {
      throw new TestPilotNotFoundError(
        `Los labels ${missing.join(", ")} no existen todavía. Un admin de la organización los tiene que ` +
          "crear primero (crear labels requiere rol ADMIN)."
      );
    }
    return ids;
  }

  // The API's search only matches against `title` (case-insensitive
  // contains), not description.
  async searchTestCases(
    projectId: string,
    filters: {
      search?: string;
      featureId?: string;
      type?: string;
      status?: string;
      page?: number;
      limit?: number;
    }
  ): Promise<TestCase[]> {
    const params = new URLSearchParams({ projectId });
    if (filters.search) params.set("search", filters.search);
    if (filters.featureId) params.set("featureId", filters.featureId);
    if (filters.type) params.set("type", filters.type);
    if (filters.status) params.set("status", filters.status);
    if (filters.page) params.set("page", String(filters.page));
    if (filters.limit) params.set("limit", String(filters.limit));
    const result = await apiFetch<{ testCases: TestCase[]; pagination: unknown }>(
      `/test-cases?${params}`
    );
    return result.testCases;
  }

  // Agents and humans both refer to a test case by its visible label
  // ("TC-952", the sequentialId), never by the internal cuid the API
  // actually keys on. get_test_case/update_test_case take whatever the
  // caller has on hand and resolve it themselves instead of 404ing on a
  // perfectly valid-looking reference.
  async resolveTestCaseId(projectId: string, idOrLabel: string): Promise<string> {
    const match = idOrLabel.match(/^(?:TC-)?(\d+)$/i);
    if (!match) return idOrLabel;
    const sequentialId = Number(match[1]);
    const testCases = await this.searchTestCases(projectId, { limit: 500 });
    const found = testCases.find((tc) => tc.sequentialId === sequentialId);
    if (!found) {
      throw new TestPilotNotFoundError(
        `No existe el test case ${idOrLabel} en este proyecto.`
      );
    }
    return found.id;
  }

  async getTestCase(projectId: string, testCaseId: string): Promise<TestCase> {
    const id = await this.resolveTestCaseId(projectId, testCaseId);
    return apiFetch<TestCase>(`/test-cases/${id}?projectId=${projectId}`);
  }

  async createTestCase(
    projectId: string,
    payload: {
      featureId: string;
      title: string;
      description: string;
      preconditions: string;
      steps: Array<{ action: string; expectedResult: string }>;
      expectedResult: string;
      priority: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
      type: string;
      labelIds: string[];
    }
  ): Promise<TestCase> {
    const steps: TestStep[] = payload.steps.map((s, i) => ({
      action: s.action,
      expectedResult: s.expectedResult,
      stepNumber: i + 1,
    }));
    return apiFetch<TestCase>(`/test-cases?projectId=${projectId}`, {
      method: "POST",
      body: JSON.stringify({
        featureId: payload.featureId,
        title: payload.title,
        description: payload.description,
        preconditions: payload.preconditions,
        steps,
        expectedResult: payload.expectedResult,
        priority: payload.priority,
        type: payload.type,
        // Fixed per the Test Pilot conventions: agents always create DRAFT,
        // ai_generated=true, not automated yet. Never exposed as inputs so
        // an agent can't accidentally publish a TC as READY.
        status: "DRAFT",
        aiGenerated: true,
        automationStatus: "NOT_AUTOMATED",
        ...(payload.labelIds.length > 0 && { labelIds: payload.labelIds }),
      }),
    });
  }

  // PUT /test-cases/{id} is validated against testCaseUpdateSchema, which
  // is testCaseCreateSchema.partial() — but zod's .partial() only makes
  // fields optional, it does NOT strip their .default(). `type`, `status`,
  // and `aiGenerated` all have a .default() on the create schema, so a
  // request that omits them gets them silently reset to that default
  // (confirmed live: sending only `{ priority: "HIGH" }` reset an
  // EDGE_CASE/aiGenerated:true test case to FUNCTIONAL/aiGenerated:false).
  // The route's own comment only worked around this for automationStatus.
  // Until that's fixed upstream, always GET the current test case first and
  // merge the patch on top before sending the PUT.
  async updateTestCase(
    projectId: string,
    testCaseId: string,
    patch: {
      title?: string;
      description?: string;
      preconditions?: string;
      steps?: Array<{ action: string; expectedResult: string }>;
      expectedResult?: string;
      priority?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
      type?: string;
      status?: "DRAFT" | "DEPRECATED";
      labelIds?: string[];
    }
  ): Promise<TestCase> {
    const current = await this.getTestCase(projectId, testCaseId);
    const steps: TestStep[] | undefined = patch.steps?.map((s, i) => ({
      action: s.action,
      expectedResult: s.expectedResult,
      stepNumber: i + 1,
    }));
    const merged = {
      title: patch.title ?? current.title,
      description: patch.description ?? current.description ?? undefined,
      preconditions: patch.preconditions ?? current.preconditions ?? undefined,
      steps: steps ?? current.steps,
      expectedResult: patch.expectedResult ?? current.expectedResult,
      priority: patch.priority ?? current.priority,
      type: patch.type ?? current.type,
      status: patch.status ?? current.status,
      aiGenerated: current.aiGenerated,
      automationStatus: current.automationStatus,
      ...(patch.labelIds !== undefined
        ? { labelIds: patch.labelIds }
        : { labelIds: current.labels.map((l) => l.id) }),
    };
    return apiFetch<TestCase>(`/test-cases/${current.id}?projectId=${projectId}`, {
      method: "PUT",
      body: JSON.stringify(merged),
    });
  }

  async listSuites(projectId: string): Promise<Suite[]> {
    const result = await apiFetch<{ suites: Suite[]; pagination: unknown }>(
      `/suites?projectId=${projectId}`
    );
    return result.suites;
  }

  async resolveSuite(projectId: string, name: string): Promise<Suite> {
    const suites = await this.listSuites(projectId);
    const match = suites.find((s) => s.name.toLowerCase() === name.toLowerCase());
    if (!match) {
      throw new TestPilotNotFoundError(
        `No existe la suite '${name}' en este proyecto. Usá list_suites para ver las existentes, ` +
          "o create_suite para crear una nueva."
      );
    }
    return match;
  }

  async createSuite(
    projectId: string,
    payload: { name: string; description?: string; releaseTag?: string }
  ): Promise<Suite> {
    return apiFetch<Suite>(`/suites?projectId=${projectId}`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  // Replaces the suite's full test case list (order = the array order).
  async setSuiteTestCases(
    projectId: string,
    suiteId: string,
    testCaseIds: string[]
  ): Promise<void> {
    await apiFetch(`/suites/${suiteId}/test-cases?projectId=${projectId}`, {
      method: "PUT",
      body: JSON.stringify({ testCaseIds }),
    });
  }

  // Creating an execution snapshots every test case currently in the suite
  // into NOT_RUN results — add test cases to the suite first.
  async createTestRun(
    projectId: string,
    payload: { suiteId: string; name?: string; environment?: string; buildVersion?: string }
  ): Promise<Execution> {
    return apiFetch<Execution>(`/executions?projectId=${projectId}`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  async getTestRun(projectId: string, executionId: string): Promise<Execution> {
    return apiFetch<Execution>(`/executions/${executionId}?projectId=${projectId}`);
  }

  // record_result identifies a test case the way a human/agent naturally
  // would (TC-<n> or the internal id), not by the execution-result row id
  // the API actually keys on — resolve it from the execution's own results.
  async resolveResultId(
    projectId: string,
    executionId: string,
    testCaseIdOrLabel: string
  ): Promise<string> {
    const testCaseId = await this.resolveTestCaseId(projectId, testCaseIdOrLabel);
    const execution = await this.getTestRun(projectId, executionId);
    const found = execution.results.find((r) => r.testCaseId === testCaseId);
    if (!found) {
      throw new TestPilotNotFoundError(
        `El test case ${testCaseIdOrLabel} no está en la ejecución ${executionId}. ` +
          "Agregalo a la suite con set_suite_test_cases antes de crear la ejecución."
      );
    }
    return found.id;
  }

  // resultId (not testCaseId) identifies which row to update — get it from
  // getTestRun's results[].id, matched by results[].testCaseId.
  async recordResult(
    projectId: string,
    executionId: string,
    payload: {
      resultId: string;
      result: ExecutionResultValue;
      defectLink?: string;
      comments?: string;
    }
  ): Promise<void> {
    await apiFetch(`/executions/${executionId}/results?projectId=${projectId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
  }

  // Server refuses to complete an execution while any result is still
  // NOT_RUN, so a caller can rely on this as the "did everything get run"
  // check rather than counting results itself.
  async completeTestRun(projectId: string, executionId: string): Promise<Execution> {
    return apiFetch<Execution>(`/executions/${executionId}?projectId=${projectId}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "COMPLETED" }),
    });
  }
}
