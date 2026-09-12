import { readFile, writeFile, rename, chmod } from "node:fs/promises";
import { createInterface } from "node:readline/promises";

// Password is read from stdin, never arguments, logs or persistent configuration.
const path = process.env.CASAOS_SESSION_FILE ?? ".local/m3-private/casaos-session.json";
const session = JSON.parse(await readFile(path, "utf8"));
const input = createInterface({ input: process.stdin, output: process.stdout, terminal: false });
const password = await input.question("CasaOS password (stdin): ");
input.close();
try {
  const response = await fetch(new URL("/v1/users/login", session.base_url), {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(15000),
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: session.username, password }),
  });
  if (!response.ok) throw Error(`Login rejected (${response.status})`);
  const result = await response.json();
  const token = result.data?.token;
  if (!token?.access_token || !token?.refresh_token) throw Error("Login returned an invalid token response");
  const tmp = `${path}.pending`;
  await writeFile(tmp, JSON.stringify({ base_url: session.base_url, username: session.username, token }, null, 2), { mode: 0o600 });
  await chmod(tmp, 0o600);
  await rename(tmp, path);
  console.log("CasaOS login succeeded; private session updated. Password not persisted.");
} catch (error) {
  console.error(error.message?.startsWith("Login") ? error.message : "CasaOS login failed; existing session preserved.");
  process.exitCode = 1;
}
