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
      "Complete guide to AivraSol POS software features, screens, exact UI buttons, step-by-step instructions, keyboard shortcuts, and recommended pharmacy workflows. Call this ONLY when the user asks HOW to do something or asks for steps/instructions. If the user asks you to DO or PERFORM an action (add, update, purchase, receive, pay), call propose_pos_action instead!",
    parameters: {
      type: "object",
      properties: {
        topic: {
          type: "string",
          maxLength: 60,
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
          enum: [
            "dashboard", "billing", "master", "products", "products:expiry", "products:dead",
            "purchases", "purchases:smart", "returns", "customers", "suppliers",
            "prescriptions", "narcotics", "cashbook", "cash-drawer",
            "reports", "daily-closing", "reports:money", "reports:staff",
            "printing", "settings",
          ],
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
      "Prepare an interactive in-chat Approval Card for ANY POS operation requested by the user: record a purchase/GRN stock receipt (including auto-creating the supplier or product if needed), add items to the billing cart, receive customer khata payment, record supplier payment, add expense or income, cash drawer cash-in/cash-out/open/close, save daily closing, add/update customer, add/update supplier, add/update product (name, generic, selling price, cost price, stock qty, reorder level, rack location), or open customer/supplier ledger. Always call this tool whenever the user asks to perform, add, update, buy/purchase, receive, or pay anything!",
    parameters: {
      type: "object",
      properties: {
        action_type: {
          type: "string",
          enum: [
            "record_purchase",
            "add_to_billing_cart",
            "receive_customer_payment",
            "record_supplier_payment",
            "add_expense",
            "add_income",
            "cash_drawer_movement",
            "close_cash_drawer",
            "save_daily_closing",
            "add_customer",
            "update_customer",
            "add_supplier",
            "update_supplier",
            "update_product",
            "add_product",
            "open_customer_ledger",
            "open_supplier_ledger",
          ],
        },
        target_name: { type: "string", minLength: 1, maxLength: 100 },
        name: { type: "string", maxLength: 100 },
        supplier_name: { type: "string", maxLength: 100 },
        product_name: { type: "string", maxLength: 100 },
        customer_name: { type: "string", maxLength: 100 },
        amount: { type: "number", minimum: 0, maximum: 100000000 },
        paid_amount: { type: "number", minimum: 0, maximum: 100000000 },
        method: { type: "string", enum: ["cash", "bank", "cheque", "other"] },
        category: { type: "string", maxLength: 60 },
        price: { type: "number", minimum: 0, maximum: 10000000 },
        cost: { type: "number", minimum: 0, maximum: 10000000 },
        stock_qty: { type: "number", minimum: 0, maximum: 10000000 },
        free_qty: { type: "number", minimum: 0, maximum: 1000000 },
        reorder_level: { type: "number", minimum: 0, maximum: 1000000 },
        phone: { type: "string", maxLength: 40 },
        address: { type: "string", maxLength: 160 },
        unit: { type: "string", maxLength: 24 },
        generic: { type: "string", maxLength: 100 },
        location: { type: "string", maxLength: 60 },
        batch_no: { type: "string", maxLength: 40 },
        expiry: { type: "string", maxLength: 20 },
        note: { type: "string", maxLength: 200 },
      },
      required: ["action_type"],
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

const ACTION_TYPE_ALIASES: Record<string, string> = {
  purchase: "record_purchase",
  add_purchase: "record_purchase",
  create_purchase: "record_purchase",
  receive_stock: "record_purchase",
  create_grn: "record_purchase",
  purchase_stock: "record_purchase",
  buy_stock: "record_purchase",
  add_to_cart: "add_to_billing_cart",
  prepare_bill: "add_to_billing_cart",
  create_bill: "add_to_billing_cart",
  billing: "add_to_billing_cart",
  create_product: "add_product",
  new_product: "add_product",
  edit_product: "update_product",
  adjust_stock: "update_product",
  update_stock: "update_product",
  change_price: "update_product",
  create_customer: "add_customer",
  new_customer: "add_customer",
  edit_customer: "update_customer",
  create_supplier: "add_supplier",
  new_supplier: "add_supplier",
  edit_supplier: "update_supplier",
  customer_payment: "receive_customer_payment",
  receive_payment: "receive_customer_payment",
  khata_payment: "receive_customer_payment",
  supplier_payment: "record_supplier_payment",
  pay_supplier: "record_supplier_payment",
  record_expense: "add_expense",
  expense: "add_expense",
  record_income: "add_income",
  income: "add_income",
  open_drawer: "cash_drawer_movement",
  cash_in: "cash_drawer_movement",
  cash_out: "cash_drawer_movement",
  close_drawer: "close_cash_drawer",
  daily_closing: "save_daily_closing",
};

function normalizeToolArgs(name: string, raw: unknown): void {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return;
  const a = raw as Record<string, any>;

  if (typeof a.limit === "number" || (typeof a.limit === "string" && a.limit.trim() !== "")) {
    const n = Number(a.limit);
    if (Number.isFinite(n)) a.limit = Math.max(1, Math.min(20, Math.round(n)));
  }

  if (name === "get_sales_trend" || name === "get_staff_activity") {
    if (a.days !== undefined) {
      const d = Number(a.days);
      if (Number.isFinite(d)) a.days = d <= 10 ? 7 : d <= 21 ? 14 : 30;
    }
  }

  if (name === "get_smart_purchase_plan" && a.coverage_days !== undefined) {
    const c = Number(a.coverage_days);
    if (Number.isFinite(c)) a.coverage_days = c <= 22 ? 15 : c <= 37 ? 30 : 45;
  }

  if (name === "get_inventory_status") {
    const f = String(a.filter || "").toLowerCase().trim();
    if (!["low_stock", "out_of_stock", "expiring", "dead_stock", "overstock"].includes(f)) {
      a.filter = f.includes("out") || f.includes("zero") ? "out_of_stock" : f.includes("expir") ? "expiring" : f.includes("dead") ? "dead_stock" : f.includes("over") ? "overstock" : "low_stock";
    }
  }

  if (name === "get_product_info" || name === "get_supplier_price_comparison") {
    if (!a.query) {
      const q = a.name || a.product_name || a.medicine_name || a.product || a.medicine;
      if (typeof q === "string" && q.trim()) a.query = q.trim();
    }
  }

  if (name === "get_customer_balances" || name === "get_supplier_dues" || name === "get_recent_sales") {
    if (!a.query) {
      const q = a.name || a.customer_name || a.supplier_name || a.customer || a.supplier;
      if (typeof q === "string" && q.trim()) a.query = q.trim();
    }
  }

  if (name === "propose_pos_action") {
    const rawType = String(a.action_type || a.action || a.type || "").toLowerCase().trim();
    if (ACTION_TYPE_ALIASES[rawType]) {
      a.action_type = ACTION_TYPE_ALIASES[rawType];
      if (!a.category && (rawType === "open_drawer" || rawType === "cash_in" || rawType === "cash_out")) {
        a.category = rawType;
      }
    }
    if (!a.supplier_name && typeof a.supplier === "string" && a.supplier.trim()) a.supplier_name = a.supplier.trim();
    if (!a.product_name) {
      const pn = a.medicine_name || a.product || a.medicine || (a.action_type === "record_purchase" ? a.name : undefined);
      if (typeof pn === "string" && pn.trim()) a.product_name = pn.trim();
    }
    if (!a.customer_name && typeof a.customer === "string" && a.customer.trim()) a.customer_name = a.customer.trim();
    if (!a.target_name || typeof a.target_name !== "string" || !a.target_name.trim()) {
      const fallbackTarget =
        a.product_name ||
        a.name ||
        a.customer_name ||
        a.supplier_name ||
        a.category ||
        a.note ||
        "default";
      a.target_name = String(fallbackTarget).trim().slice(0, 100);
    }
    if (a.stock_qty === undefined) {
      const q = a.qty ?? a.quantity ?? a.stock ?? a.tabs ?? a.units;
      if (q !== undefined && q !== null && String(q).trim() !== "") a.stock_qty = Number(q);
    }
    if (a.cost === undefined) {
      const c = a.cost_price ?? a.purchase_price ?? a.unit_cost ?? a.rate;
      if (c !== undefined && c !== null && String(c).trim() !== "") a.cost = Number(c);
    }
    if (a.price === undefined) {
      const p = a.selling_price ?? a.sale_price ?? a.retail_price ?? a.mrp;
      if (p !== undefined && p !== null && String(p).trim() !== "") a.price = Number(p);
    }
    if (a.paid_amount === undefined && a.paid !== undefined && a.paid !== null && String(a.paid).trim() !== "") {
      a.paid_amount = Number(a.paid);
    }
    if (a.free_qty === undefined) {
      const f = a.bonus ?? a.foc ?? a.free;
      if (f !== undefined && f !== null && String(f).trim() !== "") a.free_qty = Number(f);
    }
    if (!a.generic) {
      const g = a.generic_name || a.formula || a.genric;
      if (typeof g === "string" && g.trim()) a.generic = g.trim();
    }
    if (!a.batch_no && typeof a.batch === "string" && a.batch.trim()) a.batch_no = a.batch.trim();
    if (!a.expiry && typeof a.expiry_date === "string" && a.expiry_date.trim()) a.expiry = a.expiry_date.trim();
  }
}

/** Validates model-produced tool arguments. Returns an error string or null when valid. */
export function validateToolArguments(name: string, args: unknown): string | null {
  const t = BY_NAME.get(name);
  if (!t) return `unknown tool ${name}`;
  normalizeToolArgs(name, args);
  return checkType(t.parameters, args ?? {}, "arguments");
}

