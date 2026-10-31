import { ApiClient } from "./api-client";
import { SessionManager } from "../auth/session";

const ledgerBaseUrl = process.env.NEXT_PUBLIC_LEDGER_API_URL ?? "http://localhost:3000";
const securityBaseUrl = process.env.NEXT_PUBLIC_SECURITY_API_URL ?? "http://localhost:3200";

/** The one browser session, shared by both service clients (security-service verifies the same
 *  ledger-issued access token against ledger-service's public key). */
export const session = new SessionManager({ ledgerBaseUrl });

export const ledgerApi = new ApiClient({ baseUrl: ledgerBaseUrl, auth: session });
export const securityApi = new ApiClient({ baseUrl: securityBaseUrl, auth: session });
