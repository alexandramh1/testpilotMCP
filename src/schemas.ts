import { z } from "zod";

// Format rules from the Test Pilot export conventions (title, description,
// preconditions). Enforced here so a malformed TC fails fast with a
// structured error instead of landing silently in Test Pilot. The API
// itself accepts a looser shape (description/preconditions are optional,
// steps don't require expectedResult) — this is a stricter convention layer
// on top, deliberately.

const PRIORITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
const TYPES = [
  "FUNCTIONAL",
  "NEGATIVE",
  "EDGE_CASE",
  "INTEGRATION",
  "PERFORMANCE",
  "SECURITY",
  "USABILITY",
  "ACCESSIBILITY",
] as const;

const titleSchema = z
  .string()
  .refine(
    (v) => v.split(" - ").length >= 4,
    "title debe seguir el formato 'Area - Module - Action - Scenario'"
  );

const descriptionSchema = z
  .string()
  .refine(
    (v) => v.startsWith("Covers") || v.startsWith("Verifies"),
    "description debe empezar con 'Covers...' o 'Verifies...'"
  );

const preconditionsSchema = z
  .string()
  .regex(
    /^Role:.+\|\s*State:.+\|\s*Location:.+$/,
    "preconditions debe seguir el formato 'Role: X | State: Y | Location: Z'"
  );

const stepInputSchema = z.object({
  action: z.string().min(1),
  expectedResult: z.string().min(1),
});

export const createTestCaseInputSchema = z.object({
  project: z.string().min(1).describe("Nombre o slug del proyecto en Test Pilot"),
  feature: z.string().min(1).describe("Nombre exacto de un feature existente (ver list_features)"),
  title: titleSchema,
  description: descriptionSchema,
  preconditions: preconditionsSchema,
  steps: z.array(stepInputSchema).min(1),
  expectedResult: z.string().min(1),
  priority: z.enum(PRIORITIES).default("MEDIUM"),
  type: z.enum(TYPES),
  labels: z
    .array(z.string())
    .optional()
    .describe("Nombres de labels ya existentes (ver list_labels)"),
});

export const updateTestCaseInputSchema = z.object({
  project: z.string().min(1),
  testCaseId: z.string().min(1),
  title: titleSchema.optional(),
  description: descriptionSchema.optional(),
  preconditions: preconditionsSchema.optional(),
  steps: z.array(stepInputSchema).min(1).optional(),
  expectedResult: z.string().min(1).optional(),
  priority: z.enum(PRIORITIES).optional(),
  type: z.enum(TYPES).optional(),
  status: z
    .enum(["DRAFT", "DEPRECATED"])
    .optional()
    .describe(
      "READY y MAINTENANCE no están permitidos acá: esas transiciones las hace la QA humana en la UI"
    ),
  labels: z
    .array(z.string())
    .optional()
    .describe("Reemplaza el set completo de labels del TC. Mandar [] los borra todos."),
});

export const searchTestCasesInputSchema = z.object({
  project: z.string().min(1),
  query: z.string().optional().describe("Texto libre para buscar en el title (no busca en description)"),
  feature: z.string().optional(),
  type: z.enum(TYPES).optional(),
  status: z.enum(["DRAFT", "READY", "DEPRECATED", "MAINTENANCE"]).optional(),
  page: z.number().int().positive().optional(),
});

export const getTestCaseInputSchema = z.object({
  project: z.string().min(1),
  testCaseId: z.string().min(1),
});

export const listFeaturesInputSchema = z.object({
  project: z.string().min(1),
});

export const listSuitesInputSchema = z.object({
  project: z.string().min(1),
});

export const createSuiteInputSchema = z.object({
  project: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  releaseTag: z.string().optional(),
});

export const setSuiteTestCasesInputSchema = z.object({
  project: z.string().min(1),
  suite: z.string().min(1).describe("Nombre de una suite existente (ver list_suites) o recién creada con create_suite"),
  testCaseIds: z
    .array(z.string().min(1))
    .describe("IDs de test case (TC-<n> o el id interno) en el orden en que deben ejecutarse. Reemplaza el set completo."),
});

export const createTestRunInputSchema = z.object({
  project: z.string().min(1),
  suite: z.string().min(1),
  name: z.string().optional(),
  environment: z.string().optional().describe("Ej. 'staging'"),
  buildVersion: z.string().optional(),
});

export const getTestRunInputSchema = z.object({
  project: z.string().min(1),
  executionId: z.string().min(1),
});

export const recordResultInputSchema = z.object({
  project: z.string().min(1),
  executionId: z.string().min(1),
  testCaseId: z
    .string()
    .min(1)
    .describe("TC-<n> o el id interno del test case dentro de esta ejecución (no el resultId)"),
  result: z.enum(["PASSED", "FAILED", "BLOCKED"]),
  defectLink: z.string().optional(),
  comments: z.string().optional().describe("Evidencia: lo observado, con el dato citado, nunca solo 'funciona'/'no funciona'"),
});

export const completeTestRunInputSchema = z.object({
  project: z.string().min(1),
  executionId: z.string().min(1),
});
