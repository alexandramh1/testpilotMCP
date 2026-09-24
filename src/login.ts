import { chromium } from "playwright";
import { saveSession } from "./session.js";

const BASE_URL = "https://test-pilot-management-tool.vercel.app";
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;

async function main() {
  console.log("Abriendo el navegador. Iniciá sesión en TestPilot manualmente (SSO/email).");
  console.log("Este script espera hasta 5 minutos a que termines el login.");

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(BASE_URL);

  // Auth.js v5 names this cookie __Secure-authjs.session-token over HTTPS
  // in production; the plain authjs.session-token name from the API docs
  // is what you'd see locally over HTTP.
  const isSessionCookie = (name: string) => name.endsWith("authjs.session-token");

  const deadline = Date.now() + LOGIN_TIMEOUT_MS;
  let loggedIn = false;
  while (Date.now() < deadline) {
    const cookies = await context.cookies(BASE_URL);
    const sessionCookie = cookies.find((c) => isSessionCookie(c.name));
    if (sessionCookie) {
      loggedIn = true;
      break;
    }
    await page.waitForTimeout(2000);
  }

  if (!loggedIn) {
    await browser.close();
    throw new Error("No se detectó login dentro del tiempo límite. Corré `npm run login` de nuevo.");
  }

  const cookies = await context.cookies(BASE_URL);
  const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  saveSession(cookieHeader);

  console.log("Sesión guardada en .session/session.json");
  await browser.close();
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
