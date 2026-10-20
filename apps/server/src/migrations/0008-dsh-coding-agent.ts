export const sql = `
-- Coding tasks default to DeepSeek Harness. The runtime is registered when
-- DSH_ENABLED=1 (or DSH_BIN is configured); installations without it simply
-- report the coding agent as unavailable instead of dispatching to a missing
-- Codex runtime.
UPDATE agent_definitions
SET runtime_type='dsh', updated_at=now()
WHERE id='coding-agent' AND runtime_type='codex';
`;
