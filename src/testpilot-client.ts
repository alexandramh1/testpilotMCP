import { loadSessionCookie, TestPilotAuthError } from "./session.js";
import type {
  Feature,
  Label,
  Organization,
  Project,
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

  // Read-only for now: confirmed 2026-09-24 that POST /test-cases does not
  // persist `labels` (valid or invalid ids are silently dropped). Kept here
  // so list_labels can still answer "what labels exist", but nothing in
  // create/update writes labels until the API supports it.
  async listLabels(): Promise<Label[]> {
    const org = await this.getOrganization();
    const { labels } = await apiFetch<{ labels: Label[] }>(
      `/labels?organizationId=${org.id}`
    );
    return labels;
  }

  async searchTestCases(
    projectId: string,
    filters: { query?: string; featureId?: string; type?: string; status?: string; page?: number }
  ): Promise<TestCase[]> {
    const params = new URLSearchParams({ projectId });
    if (filters.query) params.set("query", filters.query);
    if (filters.featureId) params.set("featureId", filters.featureId);
    if (filters.type) params.set("type", filters.type);
    if (filters.status) params.set("status", filters.status);
    if (filters.page) params.set("page", String(filters.page));
    const result = await apiFetch<{ testCases: TestCase[]; pagination: unknown }>(
      `/test-cases?${params}`
    );
    return result.testCases;
  }

  async getTestCase(projectId: string, testCaseId: string): Promise<TestCase> {
    return apiFetch<TestCase>(`/test-cases/${testCaseId}?projectId=${projectId}`);
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
      priority: "HIGH" | "MEDIUM" | "LOW";
      type: "FUNCTIONAL" | "NEGATIVE" | "INTEGRATION" | "SECURITY";
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
      }),
    });
  }

  // The API's PUT replaces the whole test case, so an update must fetch the
  // current TC, merge only the changed fields on top, and send the full
  // object back — otherwise untouched fields get wiped.
  async updateTestCase(
    projectId: string,
    testCaseId: string,
    patch: {
      featureId?: string;
      title?: string;
      description?: string;
      preconditions?: string;
      steps?: Array<{ action: string; expectedResult: string }>;
      expectedResult?: string;
      priority?: "HIGH" | "MEDIUM" | "LOW";
      type?: "FUNCTIONAL" | "NEGATIVE" | "INTEGRATION" | "SECURITY";
      status?: "DRAFT" | "DEPRECATED";
    }
  ): Promise<TestCase> {
    const current = await this.getTestCase(projectId, testCaseId);
    const steps: TestStep[] | undefined = patch.steps?.map((s, i) => ({
      action: s.action,
      expectedResult: s.expectedResult,
      stepNumber: i + 1,
    }));
    const merged = {
      ...current,
      ...patch,
      steps: steps ?? current.steps,
    };
    return apiFetch<TestCase>(`/test-cases/${testCaseId}?projectId=${projectId}`, {
      method: "PUT",
      body: JSON.stringify(merged),
    });
  }
}
