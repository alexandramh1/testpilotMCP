import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SESSION_DIR = join(PROJECT_ROOT, ".session");
const SESSION_FILE = join(SESSION_DIR, "session.json");

interface StoredSession {
  cookie: string;
  capturedAt: string;
}

export class TestPilotAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TestPilotAuthError";
  }
}

export function saveSession(cookie: string): void {
  if (!existsSync(SESSION_DIR)) {
    mkdirSync(SESSION_DIR, { recursive: true });
  }
  const stored: StoredSession = { cookie, capturedAt: new Date().toISOString() };
  writeFileSync(SESSION_FILE, JSON.stringify(stored, null, 2), "utf8");
}

export function loadSessionCookie(): string {
  if (!existsSync(SESSION_FILE)) {
    throw new TestPilotAuthError(
      "No hay sesión guardada. Corré `npm run login` en testpilot-mcp para iniciar sesión en TestPilot y guardar la cookie."
    );
  }
  const stored = JSON.parse(readFileSync(SESSION_FILE, "utf8")) as StoredSession;
  return stored.cookie;
}
