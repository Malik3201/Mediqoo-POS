export type VoucherSetupType = "none" | "installation" | "lifetime";

export const VOUCHER_TERMS_TITLE =
  "Client Acknowledgment, Satisfaction & Pricing Confidentiality Notice";

export const VOUCHER_SATISFACTION_TERM =
  "1. Software Demonstration, Satisfaction & Non-Refundable Policy: This installation and software activation has been completed following a full demonstration of AivraSol Pharmacy POS and the client's complete satisfaction with its features and operational workflow. All installation, onboarding, setup, and licensing charges paid or agreed under this voucher are final and non-refundable.";

export const VOUCHER_CONFIDENTIALITY_TERM =
  "2. Confidentiality of Agreed Pricing: The commercial terms, installation fees, and licensing charges recorded in this document have been extended respectfully as a customized arrangement for your pharmacy. Accordingly, it is obligating upon the client to treat these agreed AivraSol POS charges as strictly confidential and refrain from disclosing or circulating them in the market or with any third party.";

export interface VoucherHeaderMeta {
  title: string;
  subtitle: string;
  isActivation: boolean;
  setupType: VoucherSetupType;
}

export function getVoucherHeaderMeta(voucher: any): VoucherHeaderMeta {
  const setupType: VoucherSetupType =
    voucher?.setup_snapshot?.setup_type ||
    (voucher?.action === "lifetime_activation"
      ? "lifetime"
      : voucher?.action === "installation_activation"
      ? "installation"
      : Number(voucher?.financial_snapshot?.lifetime_charge || 0) > 0
      ? "lifetime"
      : Number(voucher?.financial_snapshot?.installation_charge || 0) > 0
      ? "installation"
      : "none");

  const isActivation =
    voucher?.voucher_category === "activation" ||
    voucher?.action === "installation_activation" ||
    voucher?.action === "lifetime_activation" ||
    voucher?.action === "billing_activation" ||
    setupType !== "none";

  const recurringEnabled = Boolean(voucher?.setup_snapshot?.recurring_enabled);

  if (setupType === "lifetime" && !recurringEnabled) {
    return {
      title: "AivraSol Lifetime License Sale & Payment Voucher",
      subtitle: "Official Lifetime Software Settlement & Activation Confirmation",
      isActivation: true,
      setupType,
    };
  }

  if (setupType === "installation" && recurringEnabled) {
    return {
      title: "AivraSol Installation & Billing Activation Voucher",
      subtitle: "Official Installation Receipt & Recurring Billing Schedule",
      isActivation: true,
      setupType,
    };
  }

  if (setupType === "installation") {
    return {
      title: "AivraSol Software Installation Payment Voucher",
      subtitle: "Official One-Time Installation & Activation Confirmation",
      isActivation: true,
      setupType,
    };
  }

  if (isActivation) {
    return {
      title: "AivraSol License Billing & Activation Voucher",
      subtitle: "Official Billing Setup & Subscription Schedule Confirmation",
      isActivation: true,
      setupType,
    };
  }

  return {
    title: "AivraSol Subscription & License Renewal Voucher",
    subtitle: "Official Payment & License Extension Confirmation",
    isActivation: false,
    setupType: "none",
  };
}

export function hasAcceptanceTerms(voucher: any): boolean {
  if (!voucher) return false;
  if (voucher.setup_snapshot?.include_acceptance_terms === true) return true;
  if (voucher.setup_snapshot?.include_acceptance_terms === false) return false;
  return (
    voucher.voucher_category === "activation" ||
    voucher.action === "installation_activation" ||
    voucher.action === "lifetime_activation" ||
    voucher.action === "billing_activation" ||
    Number(voucher.financial_snapshot?.installation_charge || 0) > 0 ||
    Number(voucher.financial_snapshot?.lifetime_charge || 0) > 0
  );
}

export function formatRecurringPlanSummary(voucher: any): string {
  const setup = voucher?.setup_snapshot;
  const lic = voucher?.license_snapshot || {};
  const currency = voucher?.financial_snapshot?.currency || voucher?.currency || "PKR";

  if (setup && !setup.recurring_enabled) {
    return setup.setup_type === "lifetime"
      ? "Lifetime License (No Recurring Billing)"
      : "One-Time Setup Only (No Recurring Billing)";
  }

  if (setup?.recurring_enabled) {
    if (setup.recurring_model === "per_invoice") {
      return `Pay Per Invoice (${currency} ${Number(setup.recurring_rate_per_invoice || 1).toLocaleString()}/invoice)`;
    }
    const cycleUnit = setup.recurring_cycle === "yearly" ? "yr" : "mo";
    const cycleLabel = setup.recurring_cycle === "yearly" ? "Yearly" : "Monthly";
    return `Fixed ${cycleLabel} (${currency} ${Number(setup.recurring_amount || 0).toLocaleString()}/${cycleUnit})`;
  }

  return (
    lic.plan_label ||
    (lic.billing_model === "per_invoice" ? "Pay Per Invoice" : "Fixed Subscription")
  );
}

