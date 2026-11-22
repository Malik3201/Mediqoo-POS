import type { WhatsAppConnectionStatus, WhatsAppProviderId } from "@/models/WhatsAppIntegration";
import { scrubWhatsAppSecrets } from "./crypto";

export interface SendMessageParams {
  recipientDigits: string;
  message: string;
}

export interface ProviderSendResult {
  ok: boolean;
  providerMessageId?: string | null;
  transient?: boolean;
  disconnected?: boolean;
  errorCode?: string;
  errorMessage?: string;
  httpStatus?: number;
}

export interface ProviderStatusResult {
  ok: boolean;
  connectionStatus: WhatsAppConnectionStatus;
  rawState?: string | null;
  senderNumber?: string | null;
  transient?: boolean;
  errorCode?: string;
  errorMessage?: string;
}

export interface ProviderQrResult {
  ok: boolean;
  alreadyConnected?: boolean;
  qrBase64?: string | null;
  connectionStatus: WhatsAppConnectionStatus;
  errorCode?: string;
  errorMessage?: string;
}

export interface ProviderNumberCheckResult {
  ok: boolean;
  existsWhatsapp?: boolean;
  transient?: boolean;
  errorCode?: string;
  errorMessage?: string;
}

/**
 * Future-proof provider abstraction.
 * GREEN-API is the first implementation; future providers (e.g. Meta Cloud API)
 * can implement this interface without modifying any business/alert logic.
 */
export interface WhatsAppProvider {
  readonly providerName: WhatsAppProviderId;
  sendMessage(params: SendMessageParams): Promise<ProviderSendResult>;
  getStatus(): Promise<ProviderStatusResult>;
  requestQr?(): Promise<ProviderQrResult>;
  checkNumber?(phoneDigits: string): Promise<ProviderNumberCheckResult>;
}

export interface GreenApiCredentials {
  apiUrl: string;
  instanceId: string;
  apiToken: string;
}

const PROVIDER_TIMEOUT_MS = 18_000;

function extractDigitsFromWid(wid: unknown): string | null {
  if (typeof wid !== "string" || !wid.trim()) return null;
  const base = wid.split("@")[0].split(":")[0];
  const digits = base.replace(/[^0-9]/g, "");
  return digits.length >= 8 && digits.length <= 15 ? digits : null;
}

export function mapGreenStateToConnectionStatus(rawState: string | null | undefined): WhatsAppConnectionStatus {
  const s = String(rawState || "").trim().toLowerCase();
  if (s === "authorized") return "connected";
  if (s === "notauthorized") return "waiting_for_qr";
  if (s === "starting") return "connecting";
  if (s === "blocked" || s === "sleepmode") return "disconnected";
  if (s === "yellowcard") return "error";
  return "disconnected";
}

function classifyHttpError(
  status: number,
  detail: string
): { transient: boolean; disconnected: boolean; code: string; message: string } {
  const lower = detail.toLowerCase();
  if (
    (status === 400 || status === 401 || status === 403) &&
    (lower.includes("not authorized") || lower.includes("notauthorized") || lower.includes("disconnected"))
  ) {
    return {
      transient: true,
      disconnected: true,
      code: "INSTANCE_DISCONNECTED",
      message: "WhatsApp sender is disconnected. Reconnect via QR code.",
    };
  }
  if (status === 401 || status === 403) {
    return {
      transient: false,
      disconnected: false,
      code: "INVALID_CREDENTIALS",
      message: "WhatsApp provider credentials were rejected. Check Instance ID and API Token.",
    };
  }
  if (status === 404) {
    return {
      transient: false,
      disconnected: false,
      code: "INSTANCE_NOT_FOUND",
      message: "WhatsApp instance was not found. Verify API URL and Instance ID.",
    };
  }
  if (status === 466) {
    return {
      transient: false,
      disconnected: false,
      code: "PLAN_QUOTA_EXCEEDED",
      message: "GREEN-API Developer plan chat/quota limit reached (maximum 3 chats on free plan).",
    };
  }
  if (status === 429) {
    return {
      transient: true,
      disconnected: false,
      code: "RATE_LIMITED",
      message: "WhatsApp provider rate limit reached. Delivery will retry automatically.",
    };
  }
  if (status === 400) {
    if (lower.includes("not authorized") || lower.includes("notauthorized") || lower.includes("disconnected")) {
      return {
        transient: true,
        disconnected: true,
        code: "INSTANCE_DISCONNECTED",
        message: "WhatsApp sender is disconnected. Reconnect via QR code.",
      };
    }
    return {
      transient: false,
      disconnected: false,
      code: "INVALID_RECIPIENT_OR_REQUEST",
      message: detail || "Invalid WhatsApp number or request parameters.",
    };
  }
  if (status >= 500) {
    return {
      transient: true,
      disconnected: false,
      code: `PROVIDER_HTTP_${status}`,
      message: "WhatsApp provider is temporarily unavailable. Delivery will retry automatically.",
    };
  }
  return {
    transient: status === 408 || status === 425,
    disconnected: false,
    code: `PROVIDER_HTTP_${status}`,
    message: detail || `WhatsApp provider returned HTTP ${status}.`,
  };
}

/**
 * Isolated GREEN-API HTTP client.
 * Never logs or leaks `apiToken`.
 */
export class GreenApiProvider implements WhatsAppProvider {
  readonly providerName: WhatsAppProviderId = "green-api";
  private readonly apiUrl: string;
  private readonly instanceId: string;
  private readonly apiToken: string;

  constructor(creds: GreenApiCredentials) {
    this.apiUrl = creds.apiUrl.replace(/\/+$/, "");
    this.instanceId = creds.instanceId.trim();
    this.apiToken = creds.apiToken.trim();
  }

  private buildUrl(method: string): string {
    return `${this.apiUrl}/waInstance${encodeURIComponent(this.instanceId)}/${method}/${encodeURIComponent(this.apiToken)}`;
  }

  private async requestJson(
    method: string,
    httpMethod: "GET" | "POST",
    body?: Record<string, unknown>
  ): Promise<{ ok: boolean; status: number; data: any; errorText?: string; networkError?: boolean }> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(new Error("timeout")), PROVIDER_TIMEOUT_MS);
    try {
      const res = await fetch(this.buildUrl(method), {
        method: httpMethod,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        signal: ctrl.signal,
        cache: "no-store",
      });
      const text = await res.text().catch(() => "");
      let data: any = null;
      if (text) {
        try {
          data = JSON.parse(text);
        } catch {
          data = null;
        }
      }
      const rawDetail =
        (data && typeof data === "object" && (data.message || data.error || data.correspondentMessage)) ||
        text.slice(0, 200);
      const safeDetail = scrubWhatsAppSecrets(String(rawDetail || ""), this.apiToken);
      return {
        ok: res.ok,
        status: res.status,
        data,
        errorText: res.ok ? undefined : safeDetail,
      };
    } catch (err: any) {
      const msg = scrubWhatsAppSecrets(String(err?.message || "Network timeout"), this.apiToken);
      return {
        ok: false,
        status: 0,
        data: null,
        errorText: msg.includes("timeout") || ctrl.signal.aborted
          ? "WhatsApp provider request timed out."
          : `Could not reach WhatsApp provider: ${msg}`,
        networkError: true,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  async sendMessage(params: SendMessageParams): Promise<ProviderSendResult> {
    const digits = params.recipientDigits.replace(/[^0-9]/g, "");
    if (digits.length < 8 || digits.length > 15) {
      return {
        ok: false,
        transient: false,
        errorCode: "INVALID_RECIPIENT",
        errorMessage: "Recipient phone number is invalid.",
      };
    }

    const res = await this.requestJson("sendMessage", "POST", {
      chatId: `${digits}@c.us`,
      message: params.message,
    });

    if (res.networkError) {
      return {
        ok: false,
        transient: true,
        errorCode: "NETWORK_ERROR",
        errorMessage: res.errorText || "Network error reaching WhatsApp provider.",
      };
    }

    if (!res.ok) {
      const classified = classifyHttpError(res.status, res.errorText || "");
      return {
        ok: false,
        transient: classified.transient,
        disconnected: classified.disconnected,
        errorCode: classified.code,
        errorMessage: classified.message,
        httpStatus: res.status,
      };
    }

    const idMessage =
      res.data && typeof res.data.idMessage === "string" && res.data.idMessage.trim()
        ? res.data.idMessage.trim()
        : null;

    if (!idMessage) {
      return {
        ok: false,
        transient: true,
        errorCode: "MISSING_MESSAGE_ID",
        errorMessage: "Provider did not return a message acknowledgement ID.",
        httpStatus: res.status,
      };
    }

    return {
      ok: true,
      providerMessageId: idMessage,
      httpStatus: res.status,
    };
  }

  async getStatus(): Promise<ProviderStatusResult> {
    const res = await this.requestJson("getStateInstance", "GET");
    if (res.networkError) {
      return {
        ok: false,
        connectionStatus: "error",
        transient: true,
        errorCode: "NETWORK_ERROR",
        errorMessage: res.errorText || "Could not check WhatsApp connection status.",
      };
    }
    if (!res.ok) {
      const classified = classifyHttpError(res.status, res.errorText || "");
      return {
        ok: false,
        connectionStatus: classified.disconnected ? "disconnected" : "error",
        transient: classified.transient,
        errorCode: classified.code,
        errorMessage: classified.message,
      };
    }

    const rawState = typeof res.data?.stateInstance === "string" ? res.data.stateInstance : null;
    const connectionStatus = mapGreenStateToConnectionStatus(rawState);

    let senderNumber: string | null = null;
    if (connectionStatus === "connected") {
      // Best-effort read of connected WhatsApp sender number (wid)
      const settingsRes = await this.requestJson("getSettings", "GET");
      if (settingsRes.ok && settingsRes.data) {
        senderNumber = extractDigitsFromWid(settingsRes.data.wid);
      }
    }

    return {
      ok: true,
      connectionStatus,
      rawState,
      senderNumber,
    };
  }

  async requestQr(): Promise<ProviderQrResult> {
    const res = await this.requestJson("qr", "GET");
    if (res.networkError) {
      return {
        ok: false,
        connectionStatus: "error",
        errorCode: "NETWORK_ERROR",
        errorMessage: res.errorText || "Could not request QR code from WhatsApp provider.",
      };
    }
    if (!res.ok) {
      const classified = classifyHttpError(res.status, res.errorText || "");
      return {
        ok: false,
        connectionStatus: "error",
        errorCode: classified.code,
        errorMessage: classified.message,
      };
    }

    const type = String(res.data?.type || "").trim();
    const message = typeof res.data?.message === "string" ? res.data.message.trim() : "";

    if (type === "alreadyLogged") {
      return {
        ok: true,
        alreadyConnected: true,
        qrBase64: null,
        connectionStatus: "connected",
      };
    }

    if (type === "qrCode" && message) {
      return {
        ok: true,
        alreadyConnected: false,
        qrBase64: message,
        connectionStatus: "waiting_for_qr",
      };
    }

    return {
      ok: false,
      connectionStatus: "error",
      errorCode: "QR_UNAVAILABLE",
      errorMessage: scrubWhatsAppSecrets(
        message || "QR code is not available right now. Please try again in a few seconds.",
        this.apiToken
      ),
    };
  }

  async checkNumber(phoneDigits: string): Promise<ProviderNumberCheckResult> {
    const digits = phoneDigits.replace(/[^0-9]/g, "");
    const numericPhone = Number(digits);
    if (!digits || !Number.isFinite(numericPhone)) {
      return {
        ok: false,
        transient: false,
        errorCode: "INVALID_PHONE",
        errorMessage: "Phone number must contain valid digits.",
      };
    }

    const res = await this.requestJson("checkWhatsapp", "POST", {
      phoneNumber: numericPhone,
    });

    if (res.networkError) {
      return {
        ok: false,
        transient: true,
        errorCode: "NETWORK_ERROR",
        errorMessage: res.errorText || "Could not verify WhatsApp number right now.",
      };
    }

    if (!res.ok) {
      const classified = classifyHttpError(res.status, res.errorText || "");
      return {
        ok: false,
        transient: classified.transient,
        errorCode: classified.code,
        errorMessage: classified.message,
      };
    }

    return {
      ok: true,
      existsWhatsapp: Boolean(res.data?.existsWhatsapp),
    };
  }
}

export function createWhatsAppProvider(
  provider: WhatsAppProviderId,
  creds: GreenApiCredentials
): WhatsAppProvider {
  if (provider === "green-api") {
    return new GreenApiProvider(creds);
  }
  throw new Error(`Unsupported WhatsApp provider: ${provider}`);
}
