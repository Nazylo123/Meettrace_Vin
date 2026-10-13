/**
 * Public entry point for the AI layer.
 * The route handler imports from "@/lib/ai", never from individual providers.
 *
 * Provider selection is driven by the LLM_PROVIDER env var (default: "openrouter").
 * Tests can override via _resetProviderForTests + setting LLM_PROVIDER.
 */

export {
  getProvider,
  analyzeTranscript,
  extractJson,
  LlmError,
  _resetProviderForTests,
  type LlmProvider,
  type ProviderName,
  type ChatMessage,
  type ProviderOptions,
} from "./provider";
