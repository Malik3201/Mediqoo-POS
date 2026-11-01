/**
 * Allow-listed AI tool contracts (names + JSON schemas). The gateway owns these; the POS only
 * executes tools whose names appear here. Arguments returned by the model are validated here
 * before they ever reach a device. There is NO tool for SQL, JS, shell, files, network or any
 * direct database mutation, and no Level-4 (commit) tool exists.
 */

export type ToolLevel = 1 | 2 | 3;
export type OperatorRole = "admin" | "manager" | "senior-cashier" | "cashier" | "none";

interface ToolDef {
  name: string;
  level: ToolLevel;
  description: string;
  parameters: { type: "object"; properties: Record<string, any>; required?: string[]; additionalProperties: false };
  /** Roles allowed to use this tool. Omitted = every role. */
  roles?: OperatorRole[];
  /** Needs the pharmacy's Advanced Copilot entitlement. */
  advanced?: boolean;
  /** Needs the purchase-preparation entitlement. */
  purchase?: boolean;
}

const DATE_PROP = {
  type: "string",
  description: 'Either "today", "yesterday", or a calendar date YYYY-MM-DD. Default today.',
  pattern: "^(today|yesterday|\\d{4}-\\d{2}-\\d{2})$",
};

export const TOOL_DEFS: ToolDef[] = [
  {
    name: "get_sales_summary",
    level: 1,
    description: "Net sales, invoice count, returns, discounts, gross profit and margin for one day.",
    parameters: { type: "object", properties: { date: DATE_PROP }, additionalProperties: false },
  },
  {
    name: "get_sales_trend",
    level: 1,
    description: "Daily net sales for the last N days with change vs the previous period. Use to explain why sales moved.",
    parameters: { type: "object", properties: { days: { type: "integer", enum: [7, 14, 30] } }, additionalProperties: false },
  },
  {
    name: "get_daily_closing",
    level: 1,
    description: "Existing Daily Closing totals (sales, cash in/out, expected vs counted cash) for a day.",
    parameters: { type: "object", properties: { date: DATE_PROP }, additionalProperties: false },
  },
  {
    name: "get_cash_drawer_summary",
    level: 1,
    description: "Current cash drawer: opening cash, cash in/out and expected cash now.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_inventory_status",
    level: 1,
    description: "Product lists by inventory condition (bounded).",
    parameters: {
      type: "object",
      properties: {
        filter: { type: "string", enum: ["low_stock", "out_of_stock", "expiring", "dead_stock", "overstock"] },
        limit: { type: "integer", minimum: 1, maximum: 20 },
      },
      required: ["filter"],
      additionalProperties: false,
    },
  },
  {
    name: "get_product_info",
    level: 1,
    description: "Stock, price, nearest expiry and sales velocity for one product matched by name/code.",
    parameters: {
      type: "object",
      properties: { query: { type: "string", minLength: 1, maxLength: 80 } },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "get_customer_balances",
    level: 1,
    description:
      "Customer outstanding credit/khata balances with last payment date, days since last payment, and last credit bill date. Optional name/phone query or inactive_days filter (e.g. 180 for customers who have not paid in the last 6 months).",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", maxLength: 80 },
        inactive_days: { type: "integer", minimum: 1, maximum: 3650 },
        limit: { type: "integer", minimum: 1, maximum: 20 },
      },
      additionalProperties: false,
    },
    roles: ["admin", "manager", "senior-cashier", "none"],
  },
  {
    name: "get_supplier_dues",
    level: 1,
    description: "Supplier payables (what the pharmacy owes) with last payment date, days since last payment, and last purchase date.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", maxLength: 80 },
        limit: { type: "integer", minimum: 1, maximum: 20 },
      },
      additionalProperties: false,
    },
    roles: ["admin", "manager", "none"],
  },
  {
    name: "get_supplier_price_comparison",
    level: 1,
    description: "Compare normalised per-base-unit purchase cost of a product across suppliers.",
    parameters: {
      type: "object",
      properties: { query: { type: "string", minLength: 1, maxLength: 80 } },
      required: ["query"],
      additionalProperties: false,
    },
    roles: ["admin", "manager", "none"],
    advanced: true,
  },
  {
    name: "get_recent_sales",
    level: 1,
    description:
      "Most recent sales invoices/bills recorded in the POS (invoice number, date/time, customer name, payment method, total amount and items sold). Use when asked about the last sale, recent bills, or latest customer transactions.",
    parameters: {
      type: "object",
      properties: {
        limit: { type: "integer", minimum: 1, maximum: 20 },
        query: { type: "string", maxLength: 80 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "get_recent_purchases",
    level: 1,
    description:
      "Most recent purchase bills (GRNs / stock receipts) added in the POS, ordered newest first (bill number, date, supplier name, total amount, paid amount, and medicines/quantities received). Use whenever the user asks which purchase was added last time, recent purchases, or what stock was bought recently.",
    parameters: {
      type: "object",
      properties: {
        limit: { type: "integer", minimum: 1, maximum: 20 },
        supplier: { type: "string", maxLength: 80 },
      },
      additionalProperties: false,
    },
    roles: ["admin", "manager", "senior-cashier", "none"],
  },
  {
    name: "get_smart_purchase_plan",
    level: 1,
    description: "Run the existing Smart Purchase engine: items likely to run out, suggested quantities, supplier-wise plan and estimated cost. Use only when the user wants reorder suggestions or a purchase plan/order list to buy.",
    parameters: {
      type: "object",
      properties: {
        coverage_days: { type: "integer", enum: [15, 30, 45] },
        supplier: { type: "string", maxLength: 80 },
        runout_days: { type: "integer", minimum: 1, maximum: 90 },
      },
      additionalProperties: false,
    },
    roles: ["admin", "manager", "none"],
    advanced: true,
  },
  {
    name: "get_money_overview",
    level: 1,
    description: "Capital overview: money in stock, receivables, payables, dead stock value.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    roles: ["admin", "manager", "none"],
    advanced: true,
  },
  {
    name: "get_staff_activity",
    level: 1,
    description: "Recorded operator activity (discounts, returns, anomalies) with evidence only. Never accuse; report facts.",
    parameters: { type: "object", properties: { days: { type: "integer", enum: [7, 14, 30] } }, additionalProperties: false },
    roles: ["admin", "manager"],
    advanced: true,
  },
  {
    name: "get_pos_software_guide",
    level: 1,
    description:
      "Complete guide to AivraSol POS software features, screens, exact UI buttons, step-by-step instructions, keyboard shortcuts, and recommended pharmacy workflows. Call this whenever the user asks how to do something in the software, how a feature works, or what steps to follow.",
    parameters: {
      type: "object",
      properties: {
        topic: {
          type: "string",
          enum: [
            "overview",
            "billing",
            "returns",
            "products_inventory",
            "expiry_dead_stock",
            "purchases_grn",
            "smart_purchase",
            "customers_khata",
            "suppliers",
            "cash_drawer",
            "cashbook_expenses",
            "daily_closing",
            "reports_insights",
            "settings_users_sync",
          ],
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "open_screen",
    level: 2,
    description: "Navigate the POS to an existing screen so the user can see the full report.",
    parameters: {
      type: "object",
      properties: {
        screen: {
          type: "string",
          enum: ["dashboard", "billing", "products", "purchases", "customers", "reports", "cashbook", "suppliers", "daily-closing", "cash-drawer"],
        },
      },
      required: ["screen"],
      additionalProperties: false,
    },
  },
  {
    name: "propose_pos_action",
    level: 3,
    description:
      "Prepare an interactive in-chat Approval Card for any POS operation requested by the user (receive customer khata payment, record supplier payment, add expense or income, cash drawer cash-in/cash-out/open, add/update customer, add/update supplier, or add/update product price/stock/reorder level). The action executes ONLY when the user clicks Approve in the chat, and then automatically opens the relevant page and section.",
    parameters: {
      type: "object",
      properties: {
        action_type: {
          type: "string",
          enum: [
            "receive_customer_payment",
            "record_supplier_payment",
            "add_expense",
            "add_income",
            "cash_drawer_movement",
            "add_customer",
            "update_customer",
            "add_supplier",
            "update_supplier",
            "update_product",
            "add_product",
          ],
        },
        target_name: { type: "string", minLength: 1, maxLength: 100 },
        amount: { type: "number", minimum: 0, maximum: 100000000 },
        method: { type: "string", enum: ["cash", "bank", "cheque", "other"] },
        category: { type: "string", maxLength: 60 },
        price: { type: "number", minimum: 0, maximum: 10000000 },
        cost: { type: "number", minimum: 0, maximum: 10000000 },
        stock_qty: { type: "number", minimum: 0, maximum: 10000000 },
        reorder_level: { type: "number", minimum: 0, maximum: 1000000 },
        phone: { type: "string", maxLength: 40 },
        address: { type: "string", maxLength: 160 },
        unit: { type: "string", maxLength: 24 },
        generic: { type: "string", maxLength: 100 },
        location: { type: "string", maxLength: 60 },
        note: { type: "string", maxLength: 200 },
      },
      required: ["action_type", "target_name"],
      additionalProperties: false,
    },
  },
  {
    name: "prepare_purchase_draft",
    level: 3,
    description:
      "Prepare an EDITABLE, non-posted purchase draft from a smart purchase plan. Never receives stock or changes costs/balances; the user must review and save it.",
    parameters: {
      type: "object",
      properties: {
        plan_id: { type: "string", maxLength: 80 },
        items: {
          type: "array",
          maxItems: 60,
          items: {
            type: "object",
            properties: {
              product_id: { type: "string", maxLength: 80 },
              quantity: { type: "number", exclusiveMinimum: 0, maximum: 1000000 },
              supplier_id: { type: "string", maxLength: 80 },
            },
            required: ["product_id", "quantity"],
            additionalProperties: false,
          },
        },
      },
      additionalProperties: false,
    },
    roles: ["admin", "manager", "none"],
    advanced: true,
    purchase: true,
  },
];

const BY_NAME = new Map(TOOL_DEFS.map((t) => [t.name, t]));

export function isKnownTool(name: string): boolean {
  return BY_NAME.has(name);
}

export function getToolLevel(name: string): ToolLevel | null {
  return BY_NAME.get(name)?.level ?? null;
}

export interface ToolAccess {
  role: OperatorRole;
  advancedCopilot: boolean;
  purchasePreparation: boolean;
}

/** Filters the POS-declared tool names to those this pharmacy + role may use. Unknown names are dropped. */
export function allowedToolNames(requested: string[], access: ToolAccess): string[] {
  const out: string[] = [];
  for (const n of requested) {
    const t = BY_NAME.get(n);
    if (!t) continue;
    if (t.roles && !t.roles.includes(access.role)) continue;
    if (t.advanced && !access.advancedCopilot) continue;
    if (t.purchase && !access.purchasePreparation) continue;
    if (!out.includes(n)) out.push(n);
  }
  return out;
}

/** OpenAI-style tool specs for the provider (stable ordering = stable prompt-cache prefix). */
export function providerToolSpecs(names: string[]) {
  return TOOL_DEFS.filter((t) => names.includes(t.name)).map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}

function checkType(schema: any, value: any, path: string): string | null {
  if (schema.type === "string") {
    if (typeof value !== "string") return `${path} must be a string`;
    if (schema.minLength !== undefined && value.length < schema.minLength) return `${path} too short`;
    if (schema.maxLength !== undefined && value.length > schema.maxLength) return `${path} too long`;
    if (schema.enum && !schema.enum.includes(value)) return `${path} not allowed`;
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) return `${path} has invalid format`;
    return null;
  }
  if (schema.type === "integer" || schema.type === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)) return `${path} must be a number`;
    if (schema.type === "integer" && !Number.isInteger(value)) return `${path} must be an integer`;
    if (schema.enum && !schema.enum.includes(value)) return `${path} not allowed`;
    if (schema.minimum !== undefined && value < schema.minimum) return `${path} too small`;
    if (schema.maximum !== undefined && value > schema.maximum) return `${path} too large`;
    if (schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum) return `${path} too small`;
    return null;
  }
  if (schema.type === "array") {
    if (!Array.isArray(value)) return `${path} must be an array`;
    if (schema.maxItems !== undefined && value.length > schema.maxItems) return `${path} too many items`;
    for (let i = 0; i < value.length; i++) {
      const e = checkType(schema.items, value[i], `${path}[${i}]`);
      if (e) return e;
    }
    return null;
  }
  if (schema.type === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value)) return `${path} must be an object`;
    const props = schema.properties || {};
    const requiredSet = new Set<string>(schema.required || []);
    for (const k of Object.keys(value)) {
      if (!(k in props)) {
        delete (value as any)[k];
        continue;
      }
      const v = (value as any)[k];
      // Strip null/undefined or empty optional strings that LLMs often emit for unused optional fields
      if (v === null || v === undefined || (!requiredSet.has(k) && v === "")) {
        delete (value as any)[k];
        continue;
      }
      if ((props[k]?.type === "integer" || props[k]?.type === "number") && typeof v === "string" && v.trim() !== "") {
        const coerced = Number(v);
        if (Number.isFinite(coerced)) (value as any)[k] = coerced;
      }
    }
    for (const r of requiredSet) {
      if (!(r in value)) return `${path}.${r} is required`;
    }
    for (const [k, v] of Object.entries(value)) {
      const e = checkType(props[k], v, `${path}.${k}`);
      if (e) return e;
    }
    return null;
  }
  return null;
}

/** Validates model-produced tool arguments. Returns an error string or null when valid. */
export function validateToolArguments(name: string, args: unknown): string | null {
  const t = BY_NAME.get(name);
  if (!t) return `unknown tool ${name}`;
  return checkType(t.parameters, args ?? {}, "arguments");
}

