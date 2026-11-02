import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import connectToDatabase from "@/lib/db";
import PortalUser, { type IPortalUser, type PortalUserRole } from "@/models/PortalUser";

const COOKIE_NAME = "portal_token";
const JWT_ALG = "HS256";

function getSecret(): Uint8Array {
  const secret = process.env.PORTAL_JWT_SECRET;
  if (!secret) {
    throw new Error(
      "PORTAL_JWT_SECRET environment variable is not set. " +
      "Generate one with: openssl rand -hex 32"
    );
  }
  return new TextEncoder().encode(secret);
}

export interface PortalTokenPayload extends JWTPayload {
  portalUserId: string;
  clientId: string;    // cached for quick access — always revalidated against DB
  role: PortalUserRole;
}

/**
 * Signs a portal JWT and returns the signed token string.
 * Call this after successful login or password setup.
 * Token expires in 7 days.
 */
export async function signPortalToken(user: IPortalUser): Promise<string> {
  const payload: PortalTokenPayload = {
    portalUserId: user.id,
    clientId: user.client_id,
    role: user.role,
  };

  return new SignJWT(payload)
    .setProtectedHeader({ alg: JWT_ALG })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(getSecret());
}

/**
 * Sets the portal JWT as an httpOnly cookie in the response.
 */
export function setPortalCookie(res: NextResponse, token: string): NextResponse {
  res.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 7, // 7 days
    path: "/",
  });
  return res;
}

/**
 * Clears the portal cookie.
 */
export function clearPortalCookie(res: NextResponse): NextResponse {
  res.cookies.set(COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 0,
    path: "/",
  });
  return res;
}

/**
 * Verifies the portal JWT from the request cookie.
 * Returns the decoded payload or null if invalid/missing.
 * Used in middleware (Edge Runtime) — does NOT touch MongoDB.
 */
export async function verifyPortalTokenFromRequest(
  req: NextRequest
): Promise<PortalTokenPayload | null> {
  try {
    const token = req.cookies.get(COOKIE_NAME)?.value;
    if (!token) return null;
    const { payload } = await jwtVerify(token, getSecret());
    return payload as PortalTokenPayload;
  } catch {
    return null;
  }
}

/**
 * FULL portal session validation for API routes.
 *
 * Per correction #4: JWT is NOT the sole authorization source.
 * Every protected portal API must:
 *  1. Verify JWT signature
 *  2. Load PortalUser from DB
 *  3. Confirm user exists
 *  4. Confirm status === "active" (disable takes effect immediately)
 *  5. Confirm client_id matches JWT (prevents tampering)
 *  6. Use DB role for current authorization (role change takes effect immediately)
 *
 * Returns the current PortalUser document on success.
 * Throws a typed error on failure — callers convert to JSON 401/403.
 */
export async function requirePortalSession(req: NextRequest): Promise<IPortalUser>;
export async function requirePortalSession(): Promise<{
  session: IPortalUser;
  errorResponse: NextResponse | null;
}>;
export async function requirePortalSession(
  req?: NextRequest
): Promise<
  | IPortalUser
  | {
      session: IPortalUser;
      errorResponse: NextResponse | null;
    }
> {
  const validateToken = async (token?: string): Promise<IPortalUser> => {
    if (!token) {
      throw new PortalAuthError("missing_token", 401, "Authentication required");
    }

    let payload: PortalTokenPayload;
    try {
      const { payload: p } = await jwtVerify(token, getSecret());
      payload = p as PortalTokenPayload;
    } catch {
      throw new PortalAuthError("invalid_token", 401, "Invalid or expired session");
    }

    await connectToDatabase();

    // Load current user state from DB — do NOT trust JWT fields for authorization
    const user = await PortalUser.findOne({ id: payload.portalUserId })
      .select("+password_hash") // needed to check password_hash exists
      .lean<IPortalUser & { password_hash?: string }>();

    if (!user) {
      throw new PortalAuthError("user_not_found", 401, "Account not found");
    }

    if (user.status !== "active") {
      throw new PortalAuthError(
        "account_disabled",
        403,
        "Your account has been disabled. Please contact your administrator."
      );
    }

    // Sanity check: client_id in DB must match JWT (detects token tampering)
    if (user.client_id !== payload.clientId) {
      throw new PortalAuthError("client_mismatch", 403, "Session identity mismatch");
    }

    // Return the full current user — callers use user.client_id and user.role
    return user as IPortalUser;
  };

  if (req) {
    const token = req.cookies.get(COOKIE_NAME)?.value;
    return validateToken(token);
  }

  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(COOKIE_NAME)?.value;
    const session = await validateToken(token);
    return { session, errorResponse: null };
  } catch (err: any) {
    if (err instanceof PortalAuthError) {
      return {
        session: null as unknown as IPortalUser,
        errorResponse: portalAuthErrorResponse(err),
      };
    }
    return {
      session: null as unknown as IPortalUser,
      errorResponse: NextResponse.json(
        { error: "internal_error", message: "Authentication failed" },
        { status: 500 }
      ),
    };
  }
}

/**
 * Typed error class for portal authentication failures.
 * API routes catch this and return appropriate JSON responses.
 */
export class PortalAuthError extends Error {
  constructor(
    public readonly code: string,
    public readonly httpStatus: 401 | 403,
    message: string
  ) {
    super(message);
    this.name = "PortalAuthError";
  }
}

/**
 * Helper: converts PortalAuthError to a JSON NextResponse.
 * Use in API route catch blocks.
 */
export function portalAuthErrorResponse(err: PortalAuthError): NextResponse {
  return NextResponse.json(
    { error: err.code, message: err.message },
    { status: err.httpStatus }
  );
}
