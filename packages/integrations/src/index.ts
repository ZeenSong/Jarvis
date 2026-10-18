export { compileManifest, integrationManifestSchema, operationSchema, httpAuthSchema } from "./manifest.js";
export type {
  CompiledManifest,
  HttpAuth,
  HttpOperation,
  HttpTransport,
  IntegrationManifest,
  IntegrationTransport,
  ToolPolicy,
} from "./manifest.js";
export { IntegrationRegistry } from "./registry.js";
export type { AppDescriptor, ConnectionDescriptor, MediaDescriptor, ResolvedCredential } from "./registry.js";
export { builtinManifests, classifyTool, isDenied, manifestCapabilities, matchToolPattern, matchesAny } from "./builtins.js";
export { appRecipes, buildRecipeManifest, recipeCredential, recipeFor, recipeIsAutomatic, recipeMcpEndpoint } from "./recipes.js";
export type { AppRecipe, RecipeAuth, RecipeOperation } from "./recipes.js";
export { callHttpOperation, clearHttpSessions, httpBase, probeHttp } from "./http.js";
export type { HttpCallResult } from "./http.js";
export { callMcpTool, listMcpTools } from "./mcp-http.js";
export type { McpCallResult, McpTool } from "./mcp-http.js";
