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
        const manufacturer = t[8] >= 0 && d.manufacturer ? d.manufacturer[t[8]] : undefined;
        const packUnits = typeof t[11] === "number" && t[11] > 0 ? t[11] : 1;
        const baseUnit = t[10] >= 0 && d.baseUnit ? d.baseUnit[t[10]] : "Tablet";
        const barcode = typeof t[27] === "string" ? t[27] : undefined;

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

  const results: MasterCatalogItem[] = [];
  for (const item of items) {
    const nameMatch = item.master_catalog_name.toLowerCase().includes(q);
    const genMatch = item.generic_name?.toLowerCase().includes(q);
    const brandMatch = item.brand_name?.toLowerCase().includes(q);
    const idMatch = item.master_catalog_id.toLowerCase().includes(q);

    if (nameMatch || genMatch || brandMatch || idMatch) {
      results.push(item);
      if (results.length >= limit) break;
    }
  }

  return results;
}

