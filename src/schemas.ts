import { z } from "zod";

// Format rules from the Test Pilot export conventions (title, description,
// preconditions). Enforced here so a malformed TC fails fast with a
// structured error instead of landing silently in Test Pilot.

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
  priority: z.enum(["HIGH", "MEDIUM", "LOW"]).default("MEDIUM"),
  type: z.enum(["FUNCTIONAL", "NEGATIVE", "INTEGRATION", "SECURITY"]),
  // NOTA: la API de Test Pilot no persiste `labels` en POST /test-cases
  // todavía (confirmado 2026-09-24: ids válidos o inválidos se ignoran en
  // silencio y el TC queda con labels: []). No se expone acá hasta que la
  // API lo soporte; usar list_labels solo para consulta.
});

export const updateTestCaseInputSchema = z.object({
  project: z.string().min(1),
  testCaseId: z.string().min(1),
  title: titleSchema.optional(),
  description: descriptionSchema.optional(),
  preconditions: preconditionsSchema.optional(),
  steps: z.array(stepInputSchema).min(1).optional(),
  expectedResult: z.string().min(1).optional(),
  priority: z.enum(["HIGH", "MEDIUM", "LOW"]).optional(),
  type: z.enum(["FUNCTIONAL", "NEGATIVE", "INTEGRATION", "SECURITY"]).optional(),
  status: z
    .enum(["DRAFT", "DEPRECATED"])
    .optional()
    .describe("READY no está permitido acá: solo la QA humana promueve un TC a READY en la UI"),
});

export const searchTestCasesInputSchema = z.object({
  project: z.string().min(1),
  query: z.string().optional().describe("Texto libre para buscar en title/description"),
  feature: z.string().optional(),
  type: z.enum(["FUNCTIONAL", "NEGATIVE", "INTEGRATION", "SECURITY"]).optional(),
  status: z.enum(["DRAFT", "READY", "DEPRECATED"]).optional(),
  page: z.number().int().positive().optional(),
});

export const getTestCaseInputSchema = z.object({
  project: z.string().min(1),
  testCaseId: z.string().min(1),
});

export const listFeaturesInputSchema = z.object({
  project: z.string().min(1),
});
