import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const fixturesDir = fileURLToPath(new URL("../fixtures", import.meta.url));

const contentTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
};

// Mirrors the team's Laravel seeded-admin convention so the login defaults get exercised.
const VALID_USER = "admin2x";
const VALID_PASS = "secret";
const SESSION_COOKIE = "a11y_session=ok";

export interface FixtureServer {
  url: string;
  close: () => Promise<void>;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function redirect(res: ServerResponse, location: string, setCookie?: string): void {
  const headers: Record<string, string> = { location };
  if (setCookie) headers["set-cookie"] = `${setCookie}; Path=/; HttpOnly`;
  res.writeHead(302, headers);
  res.end();
}

async function serveStatic(res: ServerResponse, urlPath: string): Promise<void> {
  try {
    const path = normalize(join(fixturesDir, urlPath));
    if (!path.startsWith(fixturesDir)) {
      res.writeHead(403);
      res.end("forbidden");
      return;
    }
    const body = await readFile(path);
    res.writeHead(200, { "content-type": contentTypes[extname(path)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end("not found");
  }
}

export async function serveFixtures(): Promise<FixtureServer> {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://fixtures.invalid");

    // Auth routes: a login form posts here; /secure.html is cookie-gated.
    if (req.method === "POST" && url.pathname === "/login") {
      const params = new URLSearchParams(await readBody(req));
      if (params.get("email") === VALID_USER && params.get("password") === VALID_PASS) {
        redirect(res, "/secure.html", SESSION_COOKIE);
      } else {
        redirect(res, "/login.html");
      }
      return;
    }
    if (url.pathname === "/secure.html" && !(req.headers.cookie ?? "").includes(SESSION_COOKIE)) {
      redirect(res, "/login.html");
      return;
    }
    if (url.pathname === "/forbidden.html") {
      res.writeHead(403, { "content-type": "text/html; charset=utf-8" });
      res.end("<!doctype html><html lang=\"en\"><head><title>403</title></head><body><h1>Forbidden</h1></body></html>");
      return;
    }

    await serveStatic(res, url.pathname);
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("fixture server has no port");
  }

  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}
