import AiModelRegistry from "@/models/AiModelRegistry";

export const MODEL_FIELDS = [
  "model_name",
  "provider",
  "enabled",
  "is_default",
  "is_complex_default",
  "is_fallback",
  "context_window",
  "supports_tools",
  "supports_structured_json",
  "max_output_tokens",
  "usage_policy",
  "cost_per_million_input_usd",
  "cost_per_million_output_usd",
] as const;

export function pickModelFields(body: any): Record<string, any> {
  const out: Record<string, any> = {};
  for (const f of MODEL_FIELDS) if (body[f] !== undefined) out[f] = body[f];
  if (out.provider !== undefined && !["groq", "custom"].includes(out.provider)) delete out.provider;
  if (out.max_output_tokens !== undefined) out.max_output_tokens = Math.min(8192, Math.max(64, Math.round(Number(out.max_output_tokens) || 1024)));
  if (out.context_window !== undefined) out.context_window = Math.max(1024, Math.round(Number(out.context_window) || 8192));
  if (out.usage_policy && !["all_queries", "simple_only", "complex_only", "fallback_only"].includes(out.usage_policy)) delete out.usage_policy;
  for (const f of ["cost_per_million_input_usd", "cost_per_million_output_usd"]) {
    if (out[f] !== undefined) out[f] = Math.max(0, Number(out[f]) || 0);
  }
  return out;
}

/** Enforces: at most one default and one complex-default model. */
export async function enforceSingleDefaults(id: string, fields: Record<string, any>) {
  if (fields.is_default === true) await AiModelRegistry.updateMany({ id: { $ne: id } }, { $set: { is_default: false } });
  if (fields.is_complex_default === true) await AiModelRegistry.updateMany({ id: { $ne: id } }, { $set: { is_complex_default: false } });
}

/**
 * Ensures a model configured on a Universal / Custom API credential exists in `AiModelRegistry`
 * as an enabled, tool-capable `"custom"` model, and optionally promotes it to the active primary
 * (both default & complex default) model immediately.
 */
export async function upsertCustomModelForCredential(opts: {
  modelId: string;
  providerLabel?: string | null;
  setAsPrimary?: boolean;
}) {
  const modelId = opts.modelId.trim();
  const label = (opts.providerLabel || "").trim();
  const displayName =
    label && !modelId.toLowerCase().includes(label.toLowerCase()) ? `${label} · ${modelId}` : modelId;

  let doc: any = await AiModelRegistry.findOne({ provider_model_id: modelId });
  if (!doc) {
    doc = await AiModelRegistry.create({
      model_name: displayName,
      provider_model_id: modelId,
      provider: "custom",
      enabled: true,
      availability: "available",
      is_default: !!opts.setAsPrimary,
      is_complex_default: !!opts.setAsPrimary,
      is_fallback: true,
      context_window: 128000,
      supports_tools: true,
      supports_structured_json: true,
      max_output_tokens: 2048,
      usage_policy: "all_queries",
    });
  } else {
    doc.enabled = true;
    doc.availability = "available";
    doc.supports_tools = true;
    doc.last_error = null;
    if (opts.setAsPrimary) {
      doc.is_default = true;
      doc.is_complex_default = true;
      doc.is_fallback = true;
      doc.usage_policy = "all_queries";
    }
    await doc.save();
  }

  if (opts.setAsPrimary) {
    await enforceSingleDefaults(doc.id, { is_default: true, is_complex_default: true });
  }
  return doc;
}

