export type Priority = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type TestType =
  | "FUNCTIONAL"
  | "NEGATIVE"
  | "EDGE_CASE"
  | "INTEGRATION"
  | "PERFORMANCE"
  | "SECURITY"
  | "USABILITY"
  | "ACCESSIBILITY";

export type TestStatus = "DRAFT" | "READY" | "DEPRECATED" | "MAINTENANCE";

export type AutomationStatus =
  | "NOT_AUTOMATED"
  | "TO_BE_AUTOMATED"
  | "AUTOMATED"
  | "CANNOT_BE_AUTOMATED";

export interface TestStep {
  action: string;
  stepNumber: number;
  // Legacy test cases created before this convention was enforced can be
  // missing a per-step expected result (confirmed against the sandbox
  // project's seed data, and the server schema itself makes it optional).
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
  // Legacy test cases can have these unset entirely; the server schema
  // itself makes both optional.
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
