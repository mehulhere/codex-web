import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { isLoopbackHost } from "./network.js";

const DEFAULT_SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;
const DEFAULT_COOKIE_NAME = "farfield_session";
const DEFAULT_REMOTE_DEBUG_ENABLED = false;
const DEFAULT_COOKIE_SECURE = false;
const MAX_LOGIN_ATTEMPTS = 8;
const LOGIN_WINDOW_MS = 10 * 60 * 1000;
const LOGIN_BLOCK_MS = 15 * 60 * 1000;
const MAX_SESSION_RENEWAL_INTERVAL_MS = 60_000;

const BooleanStringSchema = z
  .enum(["0", "1", "false", "true"])
  .transform((value) => value === "1" || value === "true");

const SessionTtlSchema = z.coerce
  .number()
  .int()
  .positive()
  .max(60 * 60 * 24 * 30);

const CookieNameSchema = z
  .string()
  .trim()
  .min(1)
  .regex(/^[A-Za-z0-9_.-]+$/);

const AuthEnvSchema = z
  .object({
    FARFIELD_AUTH_PIN: z.string().trim().optional(),
    FARFIELD_SESSION_TTL_SECONDS: SessionTtlSchema.default(DEFAULT_SESSION_TTL_SECONDS),
    FARFIELD_REMOTE_DEBUG_ENABLED: BooleanStringSchema.default(
      DEFAULT_REMOTE_DEBUG_ENABLED ? "1" : "0"
    ),
    FARFIELD_AUTH_COOKIE_NAME: CookieNameSchema.default(DEFAULT_COOKIE_NAME),
    FARFIELD_AUTH_COOKIE_SECURE: BooleanStringSchema.default(
      DEFAULT_COOKIE_SECURE ? "1" : "0"
    )
  })
  .strict();

const StoredSessionSchema = z
  .object({
    sessionDigest: z.string().regex(/^[a-f0-9]{64}$/),
    expiresAtMs: z.number().int().positive()
  })
  .strict();

const SessionStoreSchema = z
  .object({
    version: z.literal(1),
    sessions: z.array(StoredSessionSchema)
  })
  .strict();

type SessionRecord = z.infer<typeof StoredSessionSchema>;

export type AuthErrorCode = "AUTH_REQUIRED" | "AUTH_INVALID" | "AUTH_EXPIRED";

interface LoginAttemptRecord {
  firstFailureAtMs: number;
  failureCount: number;
  blockedUntilMs: number;
}

export interface AuthConfig {
  requiresAuth: boolean;
  sessionTtlSeconds: number;
  remoteDebugEnabled: boolean;
  cookieName: string;
  cookieSecure: boolean;
}

export interface AuthSessionState {
  authenticated: boolean;
  expiresAt: string | null;
  reason: "none" | "missing" | "invalid" | "expired";
}

export interface AuthRequirementResult {
  ok: boolean;
  code: AuthErrorCode | null;
  error: string | null;
  clearCookie: boolean;
  expiresAt: string | null;
  setCookie: string | null;
  sessionKey: string | null;
}

export interface LoginResult {
  ok: boolean;
  code: AuthErrorCode | null;
  error: string | null;
  expiresAt: string | null;
  setCookie: string | null;
}

interface SessionLookupResult {
  status: AuthSessionState;
  sessionId: string | null;
}

function readCookieValue(cookieHeader: string | undefined, cookieName: string): string | null {
  if (!cookieHeader) {
    return null;
  }

  const cookieParts = cookieHeader.split(";");
  for (const cookiePart of cookieParts) {
    const trimmed = cookiePart.trim();
    if (!trimmed) {
      continue;
    }
    const equalsIndex = trimmed.indexOf("=");
    if (equalsIndex <= 0) {
      continue;
    }
    const key = trimmed.slice(0, equalsIndex);
    if (key !== cookieName) {
      continue;
    }

    const rawValue = trimmed.slice(equalsIndex + 1);
    try {
      return decodeURIComponent(rawValue);
    } catch {
      return rawValue;
    }
  }

  return null;
}

function encodeCookieValue(value: string): string {
  return encodeURIComponent(value);
}

function secureCookieSuffix(secure: boolean): string {
  return secure ? "; Secure" : "";
}

function formatSetCookie(
  cookieName: string,
  value: string,
  maxAgeSeconds: number,
  secure: boolean
): string {
  return `${cookieName}=${encodeCookieValue(value)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${String(maxAgeSeconds)}${secureCookieSuffix(secure)}`;
}

function formatClearCookie(cookieName: string, secure: boolean): string {
  return `${cookieName}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secureCookieSuffix(secure)}`;
}

function hashableBuffer(value: string): Buffer {
  return Buffer.from(value, "utf8");
}

function pinsMatch(expected: string, provided: string): boolean {
  const expectedBuffer = hashableBuffer(expected);
  const providedBuffer = hashableBuffer(provided);
  if (expectedBuffer.length !== providedBuffer.length) {
    return false;
  }
  return timingSafeEqual(expectedBuffer, providedBuffer);
}

function digestSessionId(sessionId: string): string {
  return createHash("sha256").update(sessionId, "utf8").digest("hex");
}

function toIsoTime(timestampMs: number): string {
  return new Date(timestampMs).toISOString();
}

function nowMs(): number {
  return Date.now();
}

function resolveSessionStatePath(): string {
  const stateHome = process.env["XDG_STATE_HOME"]?.trim();
  const baseDirectory = stateHome ? path.resolve(stateHome) : path.join(os.homedir(), ".local", "state");
  return path.join(baseDirectory, "codex-mobile", "sessions.json");
}

export class AuthService {
  private readonly config: AuthConfig;
  private readonly pin: string | null;
  private readonly sessionStatePath: string;
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly loginAttempts = new Map<string, LoginAttemptRecord>();

  public constructor(host: string) {
    const parsed = AuthEnvSchema.parse({
      FARFIELD_AUTH_PIN: process.env["FARFIELD_AUTH_PIN"],
      FARFIELD_SESSION_TTL_SECONDS: process.env["FARFIELD_SESSION_TTL_SECONDS"],
      FARFIELD_REMOTE_DEBUG_ENABLED: process.env["FARFIELD_REMOTE_DEBUG_ENABLED"],
      FARFIELD_AUTH_COOKIE_NAME: process.env["FARFIELD_AUTH_COOKIE_NAME"],
      FARFIELD_AUTH_COOKIE_SECURE: process.env["FARFIELD_AUTH_COOKIE_SECURE"]
    });

    const pin = parsed.FARFIELD_AUTH_PIN ?? null;
    const requiresAuth = pin !== null && pin.length > 0;

    if (!isLoopbackHost(host) && !requiresAuth) {
      throw new Error("FARFIELD_AUTH_PIN is required when HOST is not loopback");
    }

    this.config = {
      requiresAuth,
      sessionTtlSeconds: parsed.FARFIELD_SESSION_TTL_SECONDS,
      remoteDebugEnabled: parsed.FARFIELD_REMOTE_DEBUG_ENABLED,
      cookieName: parsed.FARFIELD_AUTH_COOKIE_NAME,
      cookieSecure: parsed.FARFIELD_AUTH_COOKIE_SECURE
    };
    this.pin = pin;
    this.sessionStatePath = resolveSessionStatePath();

    if (requiresAuth) {
      this.loadSessions();
    }
  }

  public getConfig(): AuthConfig {
    return this.config;
  }

  public getClearCookieHeader(): string {
    return formatClearCookie(this.config.cookieName, this.config.cookieSecure);
  }

  public getSessionState(cookieHeader: string | undefined): AuthSessionState {
    if (!this.config.requiresAuth) {
      return {
        authenticated: true,
        expiresAt: null,
        reason: "none"
      };
    }

    return this.lookupSession(cookieHeader, nowMs(), false).status;
  }

  public requireSession(cookieHeader: string | undefined): AuthRequirementResult {
    if (!this.config.requiresAuth) {
      return {
        ok: true,
        code: null,
        error: null,
        clearCookie: false,
        expiresAt: null,
        setCookie: null,
        sessionKey: "local"
      };
    }

    const lookup = this.lookupSession(cookieHeader, nowMs(), true);
    if (lookup.status.authenticated && lookup.sessionId) {
      return {
        ok: true,
        code: null,
        error: null,
        clearCookie: false,
        expiresAt: lookup.status.expiresAt,
        setCookie: formatSetCookie(
          this.config.cookieName,
          lookup.sessionId,
          this.config.sessionTtlSeconds,
          this.config.cookieSecure
        ),
        sessionKey: digestSessionId(lookup.sessionId)
      };
    }

    if (lookup.status.reason === "expired") {
      return {
        ok: false,
        code: "AUTH_EXPIRED",
        error: "Session expired. Enter your PIN again.",
        clearCookie: true,
        expiresAt: null,
        setCookie: null,
        sessionKey: null
      };
    }

    if (lookup.status.reason === "invalid") {
      return {
        ok: false,
        code: "AUTH_INVALID",
        error: "Session is invalid. Enter your PIN again.",
        clearCookie: true,
        expiresAt: null,
        setCookie: null,
        sessionKey: null
      };
    }

    return {
      ok: false,
      code: "AUTH_REQUIRED",
      error: "Authentication is required.",
      clearCookie: false,
      expiresAt: null,
      setCookie: null,
      sessionKey: null
    };
  }

  public login(pin: string, remoteAddress: string): LoginResult {
    if (!this.config.requiresAuth) {
      return {
        ok: true,
        code: null,
        error: null,
        expiresAt: null,
        setCookie: null
      };
    }

    const currentTime = nowMs();
    if (this.pruneExpired(currentTime)) {
      this.persistSessions();
    }

    const remoteKey = remoteAddress.trim() || "unknown";
    const maybeAttempt = this.loginAttempts.get(remoteKey);
    if (maybeAttempt && maybeAttempt.blockedUntilMs > currentTime) {
      const waitSeconds = Math.ceil((maybeAttempt.blockedUntilMs - currentTime) / 1000);
      return {
        ok: false,
        code: "AUTH_INVALID",
        error: `Too many failed attempts. Try again in ${String(waitSeconds)} seconds.`,
        expiresAt: null,
        setCookie: null
      };
    }

    if (!this.pin || !pinsMatch(this.pin, pin)) {
      this.recordLoginFailure(remoteKey, currentTime);
      return {
        ok: false,
        code: "AUTH_INVALID",
        error: "PIN is incorrect.",
        expiresAt: null,
        setCookie: null
      };
    }

    this.loginAttempts.delete(remoteKey);

    const sessionId = randomUUID();
    const sessionDigest = digestSessionId(sessionId);
    const expiresAtMs = currentTime + this.config.sessionTtlSeconds * 1000;
    this.sessions.set(sessionDigest, {
      sessionDigest,
      expiresAtMs
    });
    this.persistSessions();

    return {
      ok: true,
      code: null,
      error: null,
      expiresAt: toIsoTime(expiresAtMs),
      setCookie: formatSetCookie(
        this.config.cookieName,
        sessionId,
        this.config.sessionTtlSeconds,
        this.config.cookieSecure
      )
    };
  }

  public logout(cookieHeader: string | undefined): string {
    const sessionId = readCookieValue(cookieHeader, this.config.cookieName);
    if (sessionId && this.sessions.delete(digestSessionId(sessionId))) {
      this.persistSessions();
    }
    return this.getClearCookieHeader();
  }

  private ensureSessionDirectory(): void {
    const directory = path.dirname(this.sessionStatePath);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    chmodSync(directory, 0o700);
  }

  private loadSessions(): void {
    this.ensureSessionDirectory();
    if (!existsSync(this.sessionStatePath)) {
      return;
    }

    chmodSync(this.sessionStatePath, 0o600);
    const document = SessionStoreSchema.parse(
      JSON.parse(readFileSync(this.sessionStatePath, "utf8"))
    );
    for (const session of document.sessions) {
      this.sessions.set(session.sessionDigest, session);
    }

    if (this.pruneExpired(nowMs())) {
      this.persistSessions();
    }
  }

  private persistSessions(): void {
    this.ensureSessionDirectory();
    const document = SessionStoreSchema.parse({
      version: 1,
      sessions: [...this.sessions.values()]
    });
    const temporaryPath = `${this.sessionStatePath}.${String(process.pid)}.${randomUUID()}.tmp`;

    try {
      writeFileSync(temporaryPath, `${JSON.stringify(document)}\n`, {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600
      });
      renameSync(temporaryPath, this.sessionStatePath);
      chmodSync(this.sessionStatePath, 0o600);
    } finally {
      if (existsSync(temporaryPath)) {
        unlinkSync(temporaryPath);
      }
    }
  }

  private pruneExpired(currentTime: number): boolean {
    let sessionsChanged = false;
    for (const [sessionDigest, session] of this.sessions.entries()) {
      if (session.expiresAtMs <= currentTime) {
        this.sessions.delete(sessionDigest);
        sessionsChanged = true;
      }
    }

    for (const [address, attempt] of this.loginAttempts.entries()) {
      const staleWindow =
        attempt.blockedUntilMs <= currentTime &&
        currentTime - attempt.firstFailureAtMs > LOGIN_WINDOW_MS;
      if (staleWindow) {
        this.loginAttempts.delete(address);
      }
    }
    return sessionsChanged;
  }

  private lookupSession(
    cookieHeader: string | undefined,
    currentTime: number,
    refresh: boolean
  ): SessionLookupResult {
    const sessionId = readCookieValue(cookieHeader, this.config.cookieName);
    if (!sessionId) {
      return {
        status: {
          authenticated: false,
          expiresAt: null,
          reason: "missing"
        },
        sessionId: null
      };
    }

    const sessionDigest = digestSessionId(sessionId);
    const session = this.sessions.get(sessionDigest);
    if (!session) {
      return {
        status: {
          authenticated: false,
          expiresAt: null,
          reason: "invalid"
        },
        sessionId: null
      };
    }

    if (session.expiresAtMs <= currentTime) {
      this.sessions.delete(sessionDigest);
      this.persistSessions();
      return {
        status: {
          authenticated: false,
          expiresAt: null,
          reason: "expired"
        },
        sessionId: null
      };
    }

    const ttlMs = this.config.sessionTtlSeconds * 1000;
    const renewalIntervalMs = Math.min(MAX_SESSION_RENEWAL_INTERVAL_MS, ttlMs / 2);
    const shouldRenew = refresh && currentTime - (session.expiresAtMs - ttlMs) >= renewalIntervalMs;
    const expiresAtMs = shouldRenew
      ? currentTime + this.config.sessionTtlSeconds * 1000
      : session.expiresAtMs;
    if (shouldRenew) {
      this.sessions.set(sessionDigest, {
        sessionDigest,
        expiresAtMs
      });
      this.persistSessions();
    }

    return {
      status: {
        authenticated: true,
        expiresAt: toIsoTime(expiresAtMs),
        reason: "none"
      },
      sessionId
    };
  }

  private recordLoginFailure(remoteAddress: string, currentTime: number): void {
    const current = this.loginAttempts.get(remoteAddress);
    if (!current) {
      this.loginAttempts.set(remoteAddress, {
        firstFailureAtMs: currentTime,
        failureCount: 1,
        blockedUntilMs: 0
      });
      return;
    }

    const isOutsideWindow = currentTime - current.firstFailureAtMs > LOGIN_WINDOW_MS;
    const nextFailureCount = isOutsideWindow ? 1 : current.failureCount + 1;
    const nextFirstFailureAtMs = isOutsideWindow ? currentTime : current.firstFailureAtMs;
    const blockedUntilMs =
      nextFailureCount >= MAX_LOGIN_ATTEMPTS
        ? currentTime + LOGIN_BLOCK_MS
        : current.blockedUntilMs;

    this.loginAttempts.set(remoteAddress, {
      firstFailureAtMs: nextFirstFailureAtMs,
      failureCount: nextFailureCount,
      blockedUntilMs
    });
  }
}
