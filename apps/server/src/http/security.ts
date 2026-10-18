import type { FastifyInstance } from "fastify";

/**
 * Security response headers for the Jarvis shell.
 *
 * Scope decisions:
 * - Only the Jarvis-owned HTML/API surface is hardened. The Hermes dashboard is
 *   proxied byte-for-byte under `/hermes-dashboard` and ships its own policy; a
 *   strict CSP here would break a third-party UI we do not control.
 * - `script-src`/`style-src` still allow inline code because compiled workspace
 *   artifacts are rendered as `srcDoc` iframes, and a `srcDoc` document inherits
 *   the embedding policy. Moving artifacts to their own route with an explicit
 *   policy is tracked in the refactor plan (P5); only then can `'unsafe-inline'`
 *   be dropped.
 * - `frame-ancestors 'none'` plus `X-Frame-Options: DENY` stops clickjacking of
 *   the authenticated shell without affecting our own `srcDoc` artifacts
 *   (which are embedded by us, not embedding us).
 */

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'none'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "font-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self' 'unsafe-inline'",
  "connect-src 'self'",
].join("; ");

const PERMISSIONS_POLICY = [
  "camera=()",
  "microphone=()",
  "geolocation=()",
  "payment=()",
  "usb=()",
].join(", ");

/** Paths that must not receive the shell policy. */
function exempt(url: string): boolean {
  return (
    url.startsWith("/hermes-dashboard") ||
    url.startsWith("/assets/") ||
    url.startsWith("/fonts-terminal/") ||
    url.startsWith("/api/media/") ||
    url.startsWith("/app-icons/") ||
    url.startsWith("/artwork/")
  );
}

export function registerSecurityHeaders(app: FastifyInstance) {
  app.addHook("onSend", async (req, reply, payload) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Referrer-Policy", "strict-origin-when-cross-origin");
    reply.header("X-Frame-Options", "DENY");
    reply.header("Permissions-Policy", PERMISSIONS_POLICY);
    reply.header("Cross-Origin-Opener-Policy", "same-origin");
    // Only assert HSTS when the request actually arrived over TLS; otherwise the
    // header is ignored by browsers and misleads operators behind a proxy.
    if (req.protocol === "https") {
      reply.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    }
    if (!exempt(req.url) && !reply.hasHeader("content-security-policy")) {
      reply.header("Content-Security-Policy", CONTENT_SECURITY_POLICY);
    }
    return payload;
  });
}

export { CONTENT_SECURITY_POLICY };
