/**
 * Single source of truth for Jarvis error codes.
 *
 * Historically the codebase threw `Error("some_code")` and mapped it to an HTTP
 * status in two near-identical regex ladders inside `app.ts`. That made the wire
 * contract impossible to review and let new codes silently become HTTP 500.
 *
 * Rules:
 * - A code listed here is a public contract and may be returned to clients.
 * - A code not listed here never reaches the client; it becomes `request_failed`.
 * - Never derive a status from an arbitrary message at call sites. Add a code.
 */

/** Codes that are safe to return verbatim, with their HTTP status. */
const STATUS_BY_CODE: Readonly<Record<string, number>> = {
  // --- 400: the request itself is wrong -------------------------------------
  capability_invalid: 400,
  conversation_required: 400,
  custom_range_requires_from_to: 400,
  invalid_invite: 400,
  invalid_media: 400,
  invalid_message_type: 400,
  invalid_pairing_code: 400,
  invalid_thumbnail: 400,
  invalid_time_range: 400,
  invalid_usage: 400,
  artifact_network_forbidden: 400,
  artifact_too_large: 400,
  artifact_unsafe_source: 400,
  mcp_tool_invalid: 400,
  media_validation_error: 400,
  media_invalid_base64: 400,
  path_outside_allowed_root: 400,
  question_answer_invalid: 400,
  schedule_time_required: 400,
  validation_error: 400,
  hermes_tool_arguments_invalid: 400,

  // --- 401: identity is missing or stale ------------------------------------
  unauthorized: 401,
  invalid_credentials: 401,
  invalid_session: 401,
  session_replayed: 401,
  user_login_required: 401,
  hermes_context_invalid: 401,
  oidc_invalid_state: 401,
  oidc_invalid_browser_state: 401,

  // --- 403: identity is fine, permission is not -----------------------------
  forbidden: 403,
  admin_required: 403,
  agent_not_owned: 403,
  agent_operation_forbidden: 403,
  agent_required: 403,
  approval_cannot_elevate_permissions: 403,
  approval_required: 403,
  cannot_change_own_role: 403,
  device_required: 403,
  hermes_capability_not_allowed: 403,
  hermes_household_forbidden: 403,
  hermes_scope_forbidden: 403,
  mcp_capability_forbidden: 403,
  node_capability_unavailable: 403,

  // --- 404 ----------------------------------------------------------------
  agent_not_found: 404,
  conversation_not_found: 404,
  node_not_found: 404,
  not_found: 404,
  run_not_found: 404,
  user_not_found: 404,
  user_not_in_household: 404,

  // --- 409: conflicts with current durable state ----------------------------
  bootstrap_already_completed: 409,
  conversation_busy: 409,
  delegation_depth_exceeded: 409,
  device_owned_by_another_user: 409,
  id_reused: 409,
  id_reused_with_different_request: 409,
  invalid_activity_transition: 409,
  invalid_core_parent: 409,
  invalid_event_sequence: 409,
  invalid_parent: 409,
  invalid_run_state: 409,
  invite_already_used: 409,
  last_admin: 409,
  question_answer_conflict: 409,
  question_not_pending: 409,
  registration_closed: 409,
  approval_not_pending: 409,

  // --- 413 ----------------------------------------------------------------
  payload_too_large: 413,
  provider_frame_too_large: 413,

  // --- 429 ----------------------------------------------------------------
  rate_limited: 429,

  // --- 500 ----------------------------------------------------------------
  internal_error: 500,
  request_failed: 500,

  // --- 502: an upstream answered badly -------------------------------------
  deepseek_stream_error: 502,
  home_assistant_invalid_response: 502,
  hermes_empty_response: 502,
  hermes_invalid_event: 502,
  hermes_returned_unhandled_tool_calls: 502,
  hermes_run_id_missing: 502,
  hermes_title_missing: 502,
  hermes_tool_round_limit: 502,
  invalid_response: 502,
  oidc_discovery_failed: 502,
  oidc_discovery_invalid: 502,
  oidc_subject_missing: 502,
  oidc_token_exchange_failed: 502,
  oidc_userinfo_failed: 502,
  oidc_access_token_missing: 502,

  // --- 503: a dependency is unavailable or unconfigured ---------------------
  agent_unavailable: 503,
  hermes_not_configured: 503,
  hermes_profile_key_missing: 503,
  home_assistant_not_configured: 503,
  immich_not_configured: 503,
  integration_credentials_corrupt: 503,
  integration_credentials_key_invalid: 503,
  integration_credentials_key_missing: 503,
  node_bridge_disconnected: 503,
  node_bridge_unavailable: 503,
  oidc_not_configured: 503,
  runtime_unavailable: 503,
  task_executor_unavailable: 503,
  unavailable: 503,
  worker_controller_not_configured: 503,
  deepseek_credentials_or_model_missing: 503,

  // --- 504 ----------------------------------------------------------------
  node_invoke_timeout: 504,
};

/** Prefix rules for families of codes that are defined at runtime. */
const STATUS_BY_PREFIX: ReadonlyArray<readonly [string, number]> = [
  ["integration_credentials_key_", 503],
  ["runtime_unavailable:", 503],
  ["hermes_run_http_", 502],
  ["hermes_run_status_http_", 502],
  ["hermes_run_stop_http_", 502],
  ["hermes_run_events_http_", 502],
  ["hermes_model_options_http_", 502],
  ["hermes_skills_http_", 502],
  ["hermes_capabilities_http_", 502],
  ["hermes_title_http_", 502],
  ["hermes_http_", 502],
  ["hermes_session_messages_http_", 502],
  ["hermes_dashboard_", 503],
  ["home_assistant_", 502],
  ["immich_", 502],
  ["integration_http_", 502],
  ["node_", 502],
];

export function isKnownErrorCode(code: string): boolean {
  return code in STATUS_BY_CODE || STATUS_BY_PREFIX.some(([prefix]) => code.startsWith(prefix));
}

export function statusForCode(code: string): number {
  const direct = STATUS_BY_CODE[code];
  if (direct !== undefined) return direct;
  for (const [prefix, status] of STATUS_BY_PREFIX) if (code.startsWith(prefix)) return status;
  return 500;
}

/**
 * Application error carrying a stable, client-safe code.
 * `detail` is only serialized when the code is a known contract code.
 */
export class AppError extends Error {
  readonly code: string;
  readonly status: number;
  readonly detail?: Record<string, unknown>;
  constructor(code: string, options: { status?: number; detail?: Record<string, unknown>; cause?: unknown } = {}) {
    super(code, { cause: options.cause });
    this.name = "AppError";
    this.code = code;
    this.status = options.status ?? statusForCode(code);
    this.detail = options.detail;
  }
}

/** Convenience constructors used by new code; keeps call sites declarative. */
export const fail = {
  badRequest: (code: string, detail?: Record<string, unknown>) => new AppError(code, { detail }),
  unauthorized: (code = "unauthorized") => new AppError(code),
  forbidden: (code = "forbidden") => new AppError(code),
  notFound: (code = "not_found") => new AppError(code),
  conflict: (code: string) => new AppError(code),
  unavailable: (code: string) => new AppError(code),
  upstream: (code: string, cause?: unknown) => new AppError(code, { cause }),
};

export type ErrorBody = {
  error: string;
  issues?: unknown;
  detail?: Record<string, unknown>;
  /** Actionable guidance for the model, e.g. "confirm the run time first". */
  message?: string;
};

type ZodLikeError = { name?: string; issues?: unknown };

function isZodError(error: unknown): error is ZodLikeError {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as ZodLikeError).name === "ZodError" &&
    Array.isArray((error as ZodLikeError).issues)
  );
}

/**
 * Map any thrown value to a wire-safe response. This is the only function allowed
 * to decide an HTTP status for a thrown error.
 */
export function toErrorResponse(error: unknown): { status: number; body: ErrorBody } {
  if (isZodError(error)) {
    return { status: 400, body: { error: "validation_error", issues: error.issues } };
  }
  if (error instanceof AppError) {
    // An unregistered code is a programming error, not a public contract. Never
    // let it reach the client just because it was wrapped in AppError.
    if (!isKnownErrorCode(error.code)) {
      return { status: 500, body: { error: "request_failed" } };
    }
    return {
      status: error.status,
      body: { error: error.code, ...(error.detail ? { detail: error.detail } : {}) },
    };
  }
  const statusCode = (error as { statusCode?: unknown } | null)?.statusCode;
  if (statusCode === 413) return { status: 413, body: { error: "payload_too_large" } };
  if (error instanceof Error) {
    // Legacy call sites throw bare Error(code) or Error("code: guidance"). Preserve
    // the contract for known codes only; everything else stays opaque.
    const [code, ...rest] = error.message.split(": ");
    if (code && isKnownErrorCode(code)) {
      const guidance = rest.join(": ").trim();
      return {
        status: statusForCode(code),
        body: { error: code, ...(guidance ? { message: guidance } : {}) },
      };
    }
  }
  return { status: 500, body: { error: "request_failed" } };
}
