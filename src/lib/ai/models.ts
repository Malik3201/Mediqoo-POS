import AiModelRegistry from "@/models/AiModelRegistry";

export interface ModelSnap {
  id: string;
  provider_model_id: string;
  enabled: boolean;
  availability: "unknown" | "available" | "unavailable";
  is_default: boolean;
  is_complex_default: boolean;
  is_fallback: boolean;
  supports_tools: boolean;
  max_output_tokens: number;
  usage_policy: "all_queries" | "simple_only" | "complex_only" | "fallback_only";
}

/**
 * Starting registry covering current Groq production tool-capable chat models.
 * Availability is verified against the live Groq account via "Test" or "Verify with Groq",
 * and a 404/model error at request time marks a model unavailable so it is skipped.
 */
export const SEED_MODELS = [
  {
    model_name: "GPT-OSS 20B (Fast)",
    provider_model_id: "openai/gpt-oss-20b",
    is_default: true,
    is_complex_default: false,
    is_fallback: true,
    supports_tools: true,
    supports_structured_json: true,
    context_window: 131072,
    max_output_tokens: 2048,
    usage_policy: "all_queries",
  },
  {
    model_name: "GPT-OSS 120B (Reasoning)",
    provider_model_id: "openai/gpt-oss-120b",
    is_default: false,
    is_complex_default: true,
    is_fallback: true,
    supports_tools: true,
    supports_structured_json: true,
    context_window: 131072,
    max_output_tokens: 2048,
    usage_policy: "all_queries",
  },
  {
    model_name: "Qwen 3.8 27B",
    provider_model_id: "qwen/qwen3.8-27b",
    is_default: false,
    is_complex_default: false,
    is_fallback: true,
    supports_tools: true,
    supports_structured_json: true,
    context_window: 131072,
    max_output_tokens: 2048,
    usage_policy: "all_queries",
  },
];

const NON_CHAT_MODEL_RE = /whisper|orpheus|guard|safeguard|tts|embed|vision-preview|playai/i;

export function isToolCapableChatModelId(modelId: string): boolean {
  if (!modelId || NON_CHAT_MODEL_RE.test(modelId)) return false;
  return /gpt-oss|qwen|llama-3|deepseek|mixtral|gemma/i.test(modelId);
}

export async function seedModelsIfEmpty() {
  for (const m of SEED_MODELS) {
    await AiModelRegistry.updateOne(
      { provider_model_id: m.provider_model_id },
      { $setOnInsert: m },
      { upsert: true }
    );
  }
  // Self-heal false tool_use_failed / "Tool choice is none" errors and remove unused legacy disabled seed rows
  try {
    await AiModelRegistry.updateMany(
      { last_error: { $regex: /Tool choice is none|tool_use_failed|Failed to call a function/i } },
      { $set: { availability: "available", last_error: null } }
    );
    await AiModelRegistry.deleteMany({
      provider_model_id: { $in: ["llama-3.1-8b-instant", "llama-3.3-70b-versatile"] },
      enabled: false,
      total_requests: { $in: [0, null] },
    });
    await AiModelRegistry.updateMany(
      { enabled: false, last_error: { $ne: null } },
      { $set: { last_error: null } }
    );
  } catch {
    /* best effort self-heal */
  }
}

/**
 * Synchronises the model registry with the list of model IDs returned by Groq's GET /models.
 * Marks available models as "available", unavailable ones as "unavailable", auto-registers
 * any new tool-capable chat models, and ensures valid default/complex/fallback flags.
 */
export async function syncModelsWithProviderList(availableIds: string[]): Promise<{
  verified: number;
  missing: string[];
}> {
  await seedModelsIfEmpty();
  const set = new Set(availableIds);

  for (const id of availableIds) {
    if (!isToolCapableChatModelId(id)) continue;
    await AiModelRegistry.updateOne(
      { provider_model_id: id },
      {
        $setOnInsert: {
          model_name: id,
          provider_model_id: id,
          enabled: true,
          is_default: false,
          is_complex_default: false,
          is_fallback: true,
          supports_tools: true,
          supports_structured_json: true,
          context_window: 131072,
          max_output_tokens: 2048,
          usage_policy: "all_queries",
        },
      },
      { upsert: true }
    );
  }

  const models: any[] = await AiModelRegistry.find({});
  let verified = 0;
  const missing: string[] = [];
  const now = new Date();

  for (const m of models) {
    if (set.has(m.provider_model_id)) {
      m.availability = "available";
      m.last_verified_at = now;
      m.last_error = null;
      verified += 1;
      await m.save();
    } else {
      missing.push(m.provider_model_id);
      if (!m.total_requests) {
        await AiModelRegistry.deleteOne({ _id: m._id });
      } else {
        m.availability = "unavailable";
        m.enabled = false;
        m.last_verified_at = now;
        m.last_error = null;
        await m.save();
      }
    }
  }

  // Ensure an available, enabled model is selected as default & complex default
  const activeAvailable = models.filter((m) => m.enabled && m.availability === "available" && m.supports_tools);
  if (activeAvailable.length > 0) {
    const hasDefault = activeAvailable.some((m) => m.is_default);
    if (!hasDefault) {
      const preferredFast =
        activeAvailable.find((m) => m.provider_model_id === "openai/gpt-oss-20b") ||
        activeAvailable.find((m) => m.provider_model_id === "llama-3.1-8b-instant") ||
        activeAvailable.find((m) => m.provider_model_id === "qwen/qwen3.8-27b") ||
        activeAvailable[0];
      await AiModelRegistry.updateMany({}, { $set: { is_default: false } });
      await AiModelRegistry.updateOne({ provider_model_id: preferredFast.provider_model_id }, { $set: { is_default: true } });
    }
    const hasComplex = activeAvailable.some((m) => m.is_complex_default);
    if (!hasComplex) {
      const preferredComplex =
        activeAvailable.find((m) => m.provider_model_id === "openai/gpt-oss-120b") ||
        activeAvailable.find((m) => m.provider_model_id === "llama-3.3-70b-versatile") ||
        activeAvailable.find((m) => m.provider_model_id === "qwen/qwen3.8-27b") ||
        activeAvailable[0];
      await AiModelRegistry.updateMany({}, { $set: { is_complex_default: false } });
      await AiModelRegistry.updateOne({ provider_model_id: preferredComplex.provider_model_id }, { $set: { is_complex_default: true } });
    }
  }

  return { verified, missing };
}

export interface ModelSelectionInput {
  complexity: "simple" | "complex";
  needsTools: boolean;
  allowedModels: string[];
  modelPolicy: "auto" | "fast_only" | "full_featured";
  advancedCopilot: boolean;
}

/**
 * Ordered model chain [primary, ...fallbacks] (max 3). Models without the required tool
 * capability are never selected for tool workflows; unavailable/disabled models are skipped.
 */
export function selectModelChain(models: ModelSnap[], input: ModelSelectionInput): ModelSnap[] {
  const candidates = models.filter(
    (m) =>
      m.enabled &&
      m.availability !== "unavailable" &&
      (!input.needsTools || m.supports_tools) &&
      (input.allowedModels.length === 0 || input.allowedModels.includes(m.provider_model_id))
  );
  if (candidates.length === 0) return [];

  // Prefer verified "available" models ahead of "unknown" ones
  const sortedCandidates = [...candidates].sort((a, b) => {
    const scoreA = a.availability === "available" ? 0 : 1;
    const scoreB = b.availability === "available" ? 0 : 1;
    return scoreA - scoreB;
  });

  const wantComplex =
    input.modelPolicy === "full_featured"
      ? true
      : input.modelPolicy === "fast_only"
        ? false
        : input.complexity === "complex" || input.advancedCopilot;

  const policyOk = (m: ModelSnap) =>
    m.usage_policy === "all_queries" ||
    (wantComplex ? m.usage_policy === "complex_only" : m.usage_policy === "simple_only");

  const primaryPool = sortedCandidates.filter(policyOk);
  let primary: ModelSnap | undefined;
  if (wantComplex) {
    primary = primaryPool.find((m) => m.is_complex_default) || primaryPool.find((m) => m.is_default) || primaryPool[0];
  } else {
    primary = primaryPool.find((m) => m.is_default) || primaryPool[0];
  }
  if (!primary) primary = sortedCandidates.find((m) => m.usage_policy !== "fallback_only") || sortedCandidates[0];

  const chain: ModelSnap[] = [primary];
  for (const m of sortedCandidates.filter((c) => c.is_fallback)) {
    if (!chain.includes(m)) chain.push(m);
  }
  for (const m of sortedCandidates) {
    if (chain.length >= 3) break;
    if (!chain.includes(m)) chain.push(m);
  }
  return chain.slice(0, 3);
}

export async function loadModelSnaps(): Promise<ModelSnap[]> {
  await seedModelsIfEmpty();
  const docs: any[] = await AiModelRegistry.find({}).lean();
  return docs.map((d) => ({
    id: d.id,
    provider_model_id: d.provider_model_id,
    enabled: d.enabled,
    availability: d.availability || "unknown",
    is_default: d.is_default,
    is_complex_default: d.is_complex_default,
    is_fallback: d.is_fallback,
    supports_tools: d.supports_tools,
    max_output_tokens: d.max_output_tokens,
    usage_policy: d.usage_policy,
  }));
}
