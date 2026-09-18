export function sandboxDocument(source: string) {
  const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'">`;
  if (/<head\b/i.test(source)) return source.replace(/<head\b[^>]*>/i, (head) => `${head}${csp}`);
  if (/<html\b/i.test(source)) return source.replace(/<html\b[^>]*>/i, (html) => `${html}<head>${csp}</head>`);
  return `<!doctype html><html><head>${csp}</head><body>${source}</body></html>`;
}

export function validateArtifactSource(source: string) {
  if (source.length > 2_000_000) throw Error("artifact_too_large");
  if (/<iframe\b|<object\b|<embed\b|\bimportScripts\s*\(|\beval\s*\(|\bnew\s+Function\s*\(|\b(?:javascript|vbscript):/i.test(source)) throw Error("artifact_unsafe_source");
  if (/(?:https?:|data:text\/html)\/\//i.test(source) || /\b(?:fetch|WebSocket|XMLHttpRequest)\s*\(/.test(source)) throw Error("artifact_network_forbidden");
  return source;
}
