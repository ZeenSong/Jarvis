import { readFile, writeFile, rename, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";

export function loginOnly(value) {
  const tokens = value?.tokens;
  if (
    !tokens ||
    !["id_token", "access_token", "refresh_token"].every(
      (k) => typeof tokens[k] === "string" && tokens[k].length > 0,
    )
  )
    throw Error("codex_login_unavailable");
  return {
    tokens: Object.fromEntries(
      ["id_token", "access_token", "refresh_token", "account_id"]
        .filter((k) => typeof tokens[k] === "string")
        .map((k) => [k, tokens[k]]),
    ),
    last_refresh:
      typeof value.last_refresh === "string" ? value.last_refresh : undefined,
  };
}

export async function persistLogin(source, target) {
  const encoded = JSON.stringify(
    loginOnly(JSON.parse(await readFile(source, "utf8"))),
  );
  try {
    if ((await readFile(target, "utf8")) === encoded) return;
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  const temporary = target + "." + randomUUID() + ".next";
  try {
    await writeFile(temporary, encoded, { mode: 0o600, flag: "wx" });
    await rename(temporary, target);
  } finally {
    await rm(temporary, { force: true });
  }
}
