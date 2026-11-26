import fs from "fs";
import path from "path";

export interface MasterCatalogItem {
  master_catalog_id: string;
  master_catalog_name: string;
  brand_name?: string;
  generic_name?: string;
  strength?: string;
  dosage_form?: string;
  manufacturer?: string;
  pack_size?: number;
  pack_unit?: string;
  barcode?: string;
}

let cachedItems: MasterCatalogItem[] | null = null;

export function loadMasterCatalogItems(): MasterCatalogItem[] {
  if (cachedItems) return cachedItems;

  const candidatePaths = [
    path.join(process.cwd(), "src/data/pk-medicines.json"),
    path.join(process.cwd(), "aivrasol-admin-nextjs/src/data/pk-medicines.json"),
    path.resolve(process.cwd(), "../aivrasol-pos/src/data/pk-medicines.json"),
  ];

  let filePath: string | null = null;
  for (const p of candidatePaths) {
    if (fs.existsSync(p)) {
      filePath = p;
      break;
    }
  }

  if (!filePath) {
    console.warn("[MasterCatalog] pk-medicines.json not found in candidate paths:", candidatePaths);
    return [];
  }

  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw);

    const items: MasterCatalogItem[] = [];

    if (parsed.format === "aivrasol-master-v2-compact" && parsed.dicts && Array.isArray(parsed.items)) {
      const d = parsed.dicts;
      const rawList: any[] = parsed.items;

      for (let i = 0; i < rawList.length; i++) {
        const t = rawList[i];
        const idOrIcode = t[0];
        const isNum = typeof idOrIcode === "number";
        const id = isNum ? `ABZ-ITEM-${idOrIcode}` : String(idOrIcode);
        const brandName = String(t[1] || "").trim();
        const originalName = t[2] === 0 ? brandName : String(t[2] || brandName).trim();
        const genericName = t[3] >= 0 ? d.genericName[t[3]] : undefined;
        const strength = t[4] >= 0 ? d.strength[t[4]] : undefined;
        const rawForm = t[5] >= 0 ? d.dosageForm[t[5]] : "Tablet";
        const manufacturer = t[7] >= 0 && d.manufacturer ? d.manufacturer[t[7]] : undefined;
        const packUnits = typeof t[11] === "number" && t[11] > 0 ? t[11] : 1;
        const baseUnit = t[10] >= 0 && d.baseUnit ? d.baseUnit[t[10]] : "Tablet";
        const barcode = t[26] && t[26] !== 0 ? String(t[26]) : undefined;

        items.push({
          master_catalog_id: id,
          master_catalog_name: originalName || brandName,
          brand_name: brandName || undefined,
          generic_name: genericName || undefined,
          strength: strength || undefined,
          dosage_form: rawForm || undefined,
          manufacturer: manufacturer || undefined,
          pack_size: packUnits,
          pack_unit: baseUnit,
          barcode,
        });
      }
    } else if (Array.isArray(parsed)) {
      for (const r of parsed) {
        items.push({
          master_catalog_id: String(r.id || r.code || ""),
          master_catalog_name: String(r.originalName || r.name || r.brandName || ""),
          brand_name: r.brandName || r.brand,
          generic_name: r.genericName || r.generic,
          strength: r.strength,
          dosage_form: r.dosageForm || r.dosage_form,
          manufacturer: r.manufacturer,
          pack_size: r.packUnits || r.pack_size || 1,
          pack_unit: r.baseUnit || r.pack_unit || "Tablet",
          barcode: r.barcode,
        });
      }
    }

    cachedItems = items;
    return items;
  } catch (err) {
    console.error("[MasterCatalog] Failed to parse pk-medicines.json:", err);
    return [];
  }
}

export function searchMasterCatalog(query: string, limit = 20): MasterCatalogItem[] {
  const items = loadMasterCatalogItems();
  const q = query.trim().toLowerCase();
  if (!q) return items.slice(0, limit);

  const tokens = q
    .replace(/[^a-z0-9./%+\s-]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);

  const scored: Array<{ item: MasterCatalogItem; score: number }> = [];
  for (const item of items) {
    const nameL = item.master_catalog_name.toLowerCase();
    const brandL = (item.brand_name || "").toLowerCase();
    const genL = (item.generic_name || "").toLowerCase();
    const idL = item.master_catalog_id.toLowerCase();
    const combined = `${nameL} ${brandL} ${genL} ${item.strength || ""} ${item.dosage_form || ""} ${idL}`.toLowerCase();

    let score = 0;
    if (nameL === q || idL === q) score = 100;
    else if (nameL.startsWith(q)) score = 90;
    else if (nameL.includes(q)) score = 75;
    else if (brandL.includes(q) || genL.includes(q) || idL.includes(q)) score = 60;
    else if (tokens.length > 1 && tokens.every((t) => combined.includes(t))) {
      score = nameL.startsWith(tokens[0]) ? 70 : 55;
    }

    if (score > 0) {
      scored.push({ item, score });
    }
  }

  scored.sort((a, b) => b.score - a.score || a.item.master_catalog_name.length - b.item.master_catalog_name.length);
  return scored.slice(0, limit).map((s) => s.item);
}

function normalizeLookupName(raw: string): string {
  return String(raw || "")
    .toLowerCase()
    .replace(/\.[a-z0-9]{2,5}$/i, "")
    .replace(/[_\-]+/g, " ")
    .replace(/[^a-z0-9./%+\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Clinical-safe canonical key for filename -> Master Catalog matching:
 * - Strips pack counts: (20), (5), (5 S), (10's), 10s, 1x5, pack/box/strip
 * - Normalizes dosage form abbreviations (tab/tabs/tablet -> tablet, cap -> capsule, inj -> injection, syp -> syrup, susp -> suspension)
 * - Normalizes strength spacing & metric units (50 mg -> 50mg, 2m tab -> 2mg tablet, 1gm/1g -> 1000mg, 0.5g -> 500mg)
 * - Preserves ALL clinical discriminators (strength, dosage form, Forte/DS/Plus/Advance/CF/XR/SR/H)!
 */
function normalizeClinicalLookupKey(raw: string): string {
  let s = String(raw || "")
    .toLowerCase()
    .replace(/\.[a-z0-9]{2,5}$/i, "")
    // Strip parenthesized pack counts: (20), (5), (5 S), (10's), (1x5)
    .replace(/\(\s*\d+\s*(?:['’`]?s|tabs?|caps?|amps?|vials?|x\s*\d+)?\s*\)/gi, " ")
    .replace(/\b\d+\s*[x×]\s*\d+\b/gi, " ")
    .replace(/[_\-]+/g, " ")
    .replace(/[^a-z0-9./%+\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // Normalize metric grams -> mg
  s = s.replace(/\b(\d+(?:\.\d+)?)\s*(?:gm|gms|gram|grams|g)\b/gi, (_m, n) => {
    const val = parseFloat(n);
    return Number.isFinite(val) && val > 0 ? `${Math.round(val * 1000 * 100) / 100}mg` : _m;
  });
  // Normalize spaced strengths: "50 mg" -> "50mg", "60 ml" -> "60ml", "100 mcg" -> "100mcg"
  s = s.replace(/\b(\d+(?:\.\d+)?)\s+(mg|ml|mcg|iu|%)\b/gi, "$1$2");
  // Normalize shorthand "2m tab" -> "2mg tab"
  s = s.replace(
    /\b(\d+(?:\.\d+)?)\s*m\b(?=\s*(?:tab|tabs|tablet|tablets|cap|caps|capsule|capsules|inj|injection|syp|syrup|susp|suspension|drops))/gi,
    "$1mg"
  );
  // Normalize dosage forms
  s = s
    .replace(/\b(tablets|tablet|tabs|tab|caplets|caplet)\b/gi, "tablet")
    .replace(/\b(capsules|capsule|caps|cap)\b/gi, "capsule")
    .replace(/\b(injections|injection|inj|ampoule|ampoules|amp|vial|vials)\b/gi, "injection")
    .replace(/\b(syrups|syrup|syp)\b/gi, "syrup")
    .replace(/\b(suspensions|suspension|susp)\b/gi, "suspension")
    .replace(/\b(ointments|ointment|oint)\b/gi, "ointment")
    .replace(/\b(creams|cream|cr)\b/gi, "cream")
    .replace(/\b(drops|drop|drp)\b/gi, "drops")
    .replace(/\b(sachets|sachet|sach)\b/gi, "sachet")
    .replace(/\bfort\b/gi, "forte");

  // Strip pack tokens & non-clinical filler words
  s = s
    .replace(/\b\d+\s*['’`]?s\b/gi, " ")
    .replace(/\b(pack|box|bottle|strip|blister|hcl|hydrochloride)\b/gi, " ")
    .replace(/\s+\b\d{1,3}\b\s*$/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // Order-normalize tokens (brand words first, then strengths/volumes, then dosage forms)
  // so "ESEGROW 60ML SUSPENSION" and "ESEGROW SUSP 60ML" always produce the exact same clinical key!
  const tokens = s.split(" ").filter(Boolean);
  const brandToks: string[] = [];
  const strengthToks: string[] = [];
  const formToks: string[] = [];
  const formSet = new Set([
    "tablet",
    "capsule",
    "injection",
    "syrup",
    "suspension",
    "ointment",
    "cream",
    "drops",
    "sachet",
    "gel",
    "lotion",
    "inhaler",
  ]);
  for (const t of tokens) {
    if (formSet.has(t)) formToks.push(t);
    else if (/^\d+(?:\.\d+)?(?:\/\d+(?:\.\d+)?)?(?:mg|ml|mcg|iu|%|mg\/5ml|mg\/ml)$/i.test(t)) strengthToks.push(t);
    else brandToks.push(t);
  }
  return [...brandToks, ...strengthToks.sort(), ...formToks.sort()].join(" ").trim();
}

function extractPrimaryBrandToken(clinicalKey: string): string {
  const toks = clinicalKey
    .replace(/[^a-z0-9\s]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !/^\d/.test(t));
  return toks[0] || "";
}

function extractStrengthToken(clinicalKey: string): string | null {
  const m = clinicalKey.match(/\b(\d+(?:\.\d+)?(?:\/\d+(?:\.\d+)?)?(?:mg|mcg|iu|%|mg\/5ml|mg\/ml))\b/i);
  return m ? m[1].toLowerCase() : null;
}

function extractDosageToken(clinicalKey: string): string | null {
  const m = clinicalKey.match(/\b(tablet|capsule|injection|syrup|suspension|ointment|cream|drops|sachet|gel|lotion|inhaler)\b/i);
  return m ? m[1].toLowerCase() : null;
}

let catalogIndexCache: {
  byId: Map<string, MasterCatalogItem>;
  byNormName: Map<string, MasterCatalogItem>;
  byClinicalKey: Map<string, MasterCatalogItem[]>;
  byBrandRoot: Map<string, Array<{ item: MasterCatalogItem; clinicalKey: string; tokens: Set<string>; strength: string | null; form: string | null }>>;
} | null = null;

function getCatalogIndex() {
  if (catalogIndexCache) return catalogIndexCache;
  const items = loadMasterCatalogItems();
  const byId = new Map<string, MasterCatalogItem>();
  const byNormName = new Map<string, MasterCatalogItem>();
  const byClinicalKey = new Map<string, MasterCatalogItem[]>();
  const byBrandRoot = new Map<
    string,
    Array<{ item: MasterCatalogItem; clinicalKey: string; tokens: Set<string>; strength: string | null; form: string | null }>
  >();

  for (const it of items) {
    if (it.master_catalog_id) {
      byId.set(it.master_catalog_id.toUpperCase(), it);
    }
    const n1 = normalizeLookupName(it.master_catalog_name);
    if (n1 && !byNormName.has(n1)) byNormName.set(n1, it);
    if (it.brand_name) {
      const n2 = normalizeLookupName(it.brand_name);
      if (n2 && !byNormName.has(n2)) byNormName.set(n2, it);
    }

    const ck = normalizeClinicalLookupKey(it.master_catalog_name);
    if (ck) {
      const bucket = byClinicalKey.get(ck);
      if (bucket) bucket.push(it);
      else byClinicalKey.set(ck, [it]);

      // Also index without trailing bottle volume (e.g. "esegrow suspension 60ml" -> "esegrow suspension")
      const ckNoVol = ck.replace(/\b\d+(?:\.\d+)?ml\b/gi, "").replace(/\s+/g, " ").trim();
      if (ckNoVol && ckNoVol !== ck) {
        const b2 = byClinicalKey.get(ckNoVol);
        if (b2) b2.push(it);
        else byClinicalKey.set(ckNoVol, [it]);
      }

      const root = extractPrimaryBrandToken(ck);
      if (root && root.length >= 2) {
        const entry = {
          item: it,
          clinicalKey: ck,
          tokens: new Set(ck.split(" ").filter(Boolean)),
          strength: extractStrengthToken(ck) || (it.strength ? extractStrengthToken(normalizeClinicalLookupKey(it.strength)) : null),
          form: extractDosageToken(ck) || (it.dosage_form ? extractDosageToken(normalizeClinicalLookupKey(it.dosage_form)) : null),
        };
        const rList = byBrandRoot.get(root);
        if (rList) rList.push(entry);
        else byBrandRoot.set(root, [entry]);
        // Also index by 4-char prefix for typo tolerance (e.g. "losa" -> "losaan")
        if (root.length >= 4) {
          const pref = `__p_${root.slice(0, 4)}`;
          const pList = byBrandRoot.get(pref);
          if (pList) pList.push(entry);
          else byBrandRoot.set(pref, [entry]);
        }
      }
    }
  }
  catalogIndexCache = { byId, byNormName, byClinicalKey, byBrandRoot };
  return catalogIndexCache;
}

function findTopCatalogSuggestions(rawName: string, limit = 5): MasterCatalogItem[] {
  const { byBrandRoot } = getCatalogIndex();
  const ck = normalizeClinicalLookupKey(rawName);
  if (!ck) return [];

  const root = extractPrimaryBrandToken(ck);
  const queryTokens = ck.split(" ").filter(Boolean);
  const queryStrength = extractStrengthToken(ck);
  const queryForm = extractDosageToken(ck);

  const poolMap = new Map<string, { item: MasterCatalogItem; clinicalKey: string; tokens: Set<string>; strength: string | null; form: string | null }>();
  if (root) {
    for (const c of byBrandRoot.get(root) || []) poolMap.set(c.item.master_catalog_id, c);
    if (root.length >= 4) {
      for (const c of byBrandRoot.get(`__p_${root.slice(0, 4)}`) || []) {
        poolMap.set(c.item.master_catalog_id, c);
      }
    }
  }
  for (const t of queryTokens.slice(1, 3)) {
    if (t.length >= 4 && !/^\d/.test(t)) {
      for (const c of byBrandRoot.get(t) || []) poolMap.set(c.item.master_catalog_id, c);
    }
  }

  const scored: Array<{ item: MasterCatalogItem; score: number }> = [];
  for (const cand of poolMap.values()) {
    let score = 0;
    let overlap = 0;
    for (const qt of queryTokens) {
      if (cand.tokens.has(qt)) {
        overlap++;
        score += qt === root ? 35 : 15;
      } else if (qt.length >= 4 && cand.clinicalKey.includes(qt.slice(0, 4))) {
        score += 8;
      }
    }
    if (overlap === 0 && score < 8) continue;

    if (queryStrength && cand.strength) {
      score += queryStrength === cand.strength ? 30 : -25;
    }
    if (queryForm && cand.form) {
      score += queryForm === cand.form ? 20 : -15;
    }
    // Bonus for tighter length match
    score -= Math.abs(cand.tokens.size - queryTokens.length) * 3;
    if (score > 10) {
      scored.push({ item: cand.item, score });
    }
  }

  scored.sort((a, b) => b.score - a.score || a.item.master_catalog_name.length - b.item.master_catalog_name.length);
  return scored.slice(0, limit).map((s) => s.item);
}

export interface BulkFilenameResolveInput {
  filename: string;
  manifest_master_id?: string | null;
  manifest_name?: string | null;
}

export interface BulkFilenameResolveResult {
  filename: string;
  matched: boolean;
  match_via: "manifest_id" | "filename_id" | "exact_name" | "manifest_name" | "smart_clinical_name" | "none";
  item: MasterCatalogItem | null;
  suggestions?: MasterCatalogItem[];
}

export function resolveMasterCatalogBulkFilenames(
  entries: BulkFilenameResolveInput[]
): BulkFilenameResolveResult[] {
  const { byId, byNormName, byClinicalKey } = getCatalogIndex();

  return entries.map((entry) => {
    const rawFile = String(entry.filename || "").trim();
    const baseName = rawFile.split(/[\\/]/).pop() || rawFile;
    const stem = baseName.replace(/\.[^.]+$/, "");

    // 1. Explicit manifest master_catalog_id
    if (entry.manifest_master_id?.trim()) {
      const hit = byId.get(entry.manifest_master_id.trim().toUpperCase());
      if (hit) {
        return { filename: rawFile, matched: true, match_via: "manifest_id", item: hit };
      }
    }

    // 2. Leading ABZ-ITEM-12345 (or pk-...) prefix before "__" or entire stem
    const idPrefixMatch = stem.match(/^((?:ABZ-ITEM|PK|MED)-[A-Z0-9-]+)(?:__|$)/i);
    if (idPrefixMatch) {
      const hit = byId.get(idPrefixMatch[1].toUpperCase());
      if (hit) {
        return { filename: rawFile, matched: true, match_via: "filename_id", item: hit };
      }
    }

    // 3. After "__" portion or whole filename matched against normalized master_catalog_name
    const namePart = stem.includes("__") ? stem.split("__").slice(1).join(" ") : stem;
    const normFile = normalizeLookupName(namePart);
    if (normFile) {
      const hit = byNormName.get(normFile);
      if (hit) {
        return { filename: rawFile, matched: true, match_via: "exact_name", item: hit };
      }
    }

    // 4. Fallback to manifest exact_name
    if (entry.manifest_name?.trim()) {
      const hit = byNormName.get(normalizeLookupName(entry.manifest_name));
      if (hit) {
        return { filename: rawFile, matched: true, match_via: "manifest_name", item: hit };
      }
    }

    // 5. Clinical-safe normalized match (handles pack counts like (20)/(5 S), extra spaces,
    //    TAB/TABLET, INJ/INJECTION, CAP/CAPSULE, 50 MG/50MG, 2M/2MG, HCL, etc. — ONLY when unambiguous!)
    const tryClinicalKeys = [
      normalizeClinicalLookupKey(namePart),
      entry.manifest_name ? normalizeClinicalLookupKey(entry.manifest_name) : "",
    ].filter(Boolean);

    for (const ck of tryClinicalKeys) {
      const hits = byClinicalKey.get(ck);
      if (hits && hits.length >= 1) {
        // Every hit in this bucket shares the EXACT same brand + strength + dosage form + variant
        // (multiple entries only occur for pack-size variants like "AMKAY 25MG INJ" vs "AMKAY 25MG INJ (5)").
        // Pick the cleanest canonical entry (shortest name / exact pack-free name).
        const sorted = [...hits].sort(
          (a, b) => a.master_catalog_name.length - b.master_catalog_name.length
        );
        return { filename: rawFile, matched: true, match_via: "smart_clinical_name", item: sorted[0] };
      }
      // Also try stripping bottle volume if exact key had 0 hits (only if unambiguous single match)
      const ckNoVol = ck.replace(/\b\d+(?:\.\d+)?ml\b/gi, "").replace(/\s+/g, " ").trim();
      if (ckNoVol && ckNoVol !== ck) {
        const vHits = byClinicalKey.get(ckNoVol);
        if (vHits && vHits.length === 1) {
          return { filename: rawFile, matched: true, match_via: "smart_clinical_name", item: vHits[0] };
        }
      }
    }

    // 6. Unmatched -> return top 5 smart Master Catalog suggestions for 1-click manual review!
    const suggestions = findTopCatalogSuggestions(namePart || entry.manifest_name || stem, 5);
    return {
      filename: rawFile,
      matched: false,
      match_via: "none",
      item: null,
      suggestions,
    };
  });
}

