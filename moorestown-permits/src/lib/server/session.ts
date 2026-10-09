/**
 * Demo identity, until real auth (magic-link email for homeowners, a staff
 * role) replaces it.
 *
 * - Applicants get a random id in a signed, httpOnly cookie. "My applications"
 *   shows what that browser submitted.
 * - Staff sign in with STAFF_ACCESS_KEY and get a signed cookie. Without a key
 *   the console is open in development and closed in production.
 */
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { cookies } from "next/headers";
import { dataDir } from "./store.ts";

const APPLICANT_COOKIE = "mp_applicant";
const STAFF_COOKIE = "mp_staff";
const YEAR = 60 * 60 * 24 * 365;
const SHIFT = 60 * 60 * 12;

let secret: string | null = null;
/** SESSION_SECRET, or a random one saved next to the data so restarts keep sessions. */
function getSecret(): string {
  if (secret) return secret;
  if (process.env.SESSION_SECRET) return (secret = process.env.SESSION_SECRET);
  const file = path.join(dataDir(), "session-secret");
  try {
    secret = fs.readFileSync(file, "utf8").trim();
  } catch {
    secret = randomBytes(32).toString("hex");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, secret, { mode: 0o600 });
  }
  return secret;
}

const sign = (v: string) => createHmac("sha256", getSecret()).update(v).digest("base64url");

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function unsign(token: string | undefined): string | null {
  if (!token) return null;
  const i = token.lastIndexOf(".");
  if (i < 1) return null;
  const v = token.slice(0, i);
  return safeEqual(token.slice(i + 1), sign(v)) ? v : null;
}

const cookieOpts = (maxAge: number) => ({
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge,
});

/** The applicant id for this browser; with `create`, issues one if missing. */
export async function applicantId(create: true): Promise<string>;
export async function applicantId(create?: false): Promise<string | null>;
export async function applicantId(create = false): Promise<string | null> {
  const jar = await cookies();
  const id = unsign(jar.get(APPLICANT_COOKIE)?.value);
  if (id || !create) return id;
  const fresh = randomUUID();
  jar.set(APPLICANT_COOKIE, `${fresh}.${sign(fresh)}`, cookieOpts(YEAR));
  return fresh;
}

/* ---------- Staff ---------- */

const staffKey = () => process.env.STAFF_ACCESS_KEY || "";

export type StaffMode = "key" | "open" | "closed";
/** "key": sign in with STAFF_ACCESS_KEY. "open": no key, development. "closed": no key, production. */
export const staffMode = (): StaffMode => (staffKey() ? "key" : process.env.NODE_ENV === "production" ? "closed" : "open");

// The cookie value is tied to the key, so changing the key signs everyone out.
const staffToken = () => sign("staff:" + createHmac("sha256", "staff").update(staffKey()).digest("base64url"));

export async function isStaff(): Promise<boolean> {
  const mode = staffMode();
  if (mode !== "key") return mode === "open";
  const v = (await cookies()).get(STAFF_COOKIE)?.value;
  return !!v && safeEqual(v, staffToken());
}

export async function staffSignIn(key: string): Promise<boolean> {
  if (staffMode() !== "key" || !safeEqual(key, staffKey())) return false;
  (await cookies()).set(STAFF_COOKIE, staffToken(), cookieOpts(SHIFT));
  return true;
}

export async function staffSignOut(): Promise<void> {
  (await cookies()).delete(STAFF_COOKIE);
}
