export type Priority = "HIGH" | "MEDIUM" | "LOW";
export type TestType = "FUNCTIONAL" | "NEGATIVE" | "INTEGRATION" | "SECURITY";
export type TestStatus = "DRAFT" | "READY" | "DEPRECATED";
export type AutomationStatus = "NOT_AUTOMATED" | "AUTOMATED";

export interface TestStep {
  action: string;
  stepNumber: number;
  // Legacy test cases created before this convention was enforced can be
  // missing a per-step expected result (confirmed 2026-09-24 against the
  // sandbox project's seed data).
  expectedResult?: string | null;
}

export interface Label {
  id: string;
  name: string;
  color: string;
}

export interface Feature {
  id: string;
  name: string;
  status?: string;
}

export interface Project {
  id: string;
  name: string;
  slug: string;
  organizationId: string;
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
}

export interface TestCase {
  id: string;
  sequentialId: number;
  title: string;
  // Legacy test cases can have these unset entirely, matching the export
  // findings in the workflow plan (many rows had empty preconditions).
  description: string | null;
  preconditions: string | null;
  steps: TestStep[];
  priority: Priority;
  type: TestType;
  status: TestStatus;
  automationStatus: AutomationStatus;
  automationRef: string | null;
  expectedResult: string;
  featureId: string;
  version: number;
  aiGenerated: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  feature?: Feature;
  labels: Label[];
}
