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
 * Suggested starting registry. These are NOT assumed to exist: availability starts "unknown",
 * gets verified against the live Groq account via "Verify with Groq", and a 404/model error at
 * request time marks a model unavailable so it is never silently routed to again.
 */
const SEED_MODELS = [
  {
    model_name: "Llama 3.1 8B Instant",
    provider_model_id: "llama-3.1-8b-instant",
    is_default: true,
    is_complex_default: false,
    is_fallback: false,
    context_window: 131072,
    max_output_tokens: 1024,
    usage_policy: "all_queries",
  },
  {
    model_name: "Llama 3.3 70B Versatile",
    provider_model_id: "llama-3.3-70b-versatile",
    is_default: false,
    is_complex_default: true,
    is_fallback: true,
    context_window: 131072,
    max_output_tokens: 2048,
    usage_policy: "all_queries",
  },
];

export async function seedModelsIfEmpty() {
  const count = await AiModelRegistry.estimatedDocumentCount();
  if (count > 0) return;
  for (const m of SEED_MODELS) {
    await AiModelRegistry.updateOne({ provider_model_id: m.provider_model_id }, { $setOnInsert: m }, { upsert: true });
  }
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

  const wantComplex =
    input.modelPolicy === "full_featured" ? true : input.modelPolicy === "fast_only" ? false : input.complexity === "complex" && input.advancedCopilot;

  const policyOk = (m: ModelSnap) =>
    m.usage_policy === "all_queries" ||
    (wantComplex ? m.usage_policy === "complex_only" : m.usage_policy === "simple_only");

  const primaryPool = candidates.filter(policyOk);
  let primary: ModelSnap | undefined;
  if (wantComplex) {
    primary = primaryPool.find((m) => m.is_complex_default) || primaryPool.find((m) => m.is_default) || primaryPool[0];
  } else {
    primary = primaryPool.find((m) => m.is_default) || primaryPool[0];
  }
  if (!primary) primary = candidates.find((m) => m.usage_policy !== "fallback_only") || candidates[0];

  const chain: ModelSnap[] = [primary];
  for (const m of candidates.filter((c) => c.is_fallback)) {
    if (!chain.includes(m)) chain.push(m);
  }
  for (const m of candidates) {
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

