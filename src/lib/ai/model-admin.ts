import AiModelRegistry from "@/models/AiModelRegistry";

export const MODEL_FIELDS = [
  "model_name",
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

