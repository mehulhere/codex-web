import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { AuthService } from "../src/auth.js";

const ENV_KEYS = [
  "FARFIELD_AUTH_PIN",
  "FARFIELD_SESSION_TTL_SECONDS",
  "FARFIELD_REMOTE_DEBUG_ENABLED",
  "FARFIELD_AUTH_COOKIE_NAME",
  "FARFIELD_AUTH_COOKIE_SECURE",
  "XDG_STATE_HOME"
] as const;

function clearAuthEnv(): void {
  for (const key of ENV_KEYS) {
    delete process.env[key];
  }
}

function cookieHeaderFromSetCookie(setCookie: string, cookieName: string): string {
  const [firstSegment] = setCookie.split(";");
  const [name, rawValue] = firstSegment.split("=");
  if (name !== cookieName) {
    throw new Error("Unexpected cookie name");
  }
  return `${name}=${rawValue}`;
}

describe("AuthService", () => {
  const originalEnv = { ...process.env };
  let stateHome = "";

  beforeEach(() => {
    process.env = { ...originalEnv };
    clearAuthEnv();
    stateHome = mkdtempSync(path.join(os.tmpdir(), "farfield-auth-"));
    process.env["XDG_STATE_HOME"] = stateHome;
    vi.restoreAllMocks();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    rmSync(stateHome, { recursive: true, force: true });
  });

  it("requires FARFIELD_AUTH_PIN for non-loopback host", () => {
    expect(() => new AuthService("0.0.0.0")).toThrowError(
      /FARFIELD_AUTH_PIN is required/
    );
  });

  it("allows loopback host without auth pin", () => {
    const service = new AuthService("127.0.0.1");
    expect(service.getConfig().requiresAuth).toBe(false);
    expect(service.requireSession(undefined).ok).toBe(true);
  });

  it("creates and validates a session on successful login", () => {
    process.env["FARFIELD_AUTH_PIN"] = "1234";
    const service = new AuthService("0.0.0.0");

    const login = service.login("1234", "100.64.0.5");
    expect(login.ok).toBe(true);
    expect(login.setCookie).toBeTruthy();

    const cookieName = service.getConfig().cookieName;
    const cookieHeader = cookieHeaderFromSetCookie(login.setCookie ?? "", cookieName);
    const requirement = service.requireSession(cookieHeader);
    expect(requirement.ok).toBe(true);
    expect(requirement.expiresAt).toBeTruthy();
    expect(requirement.setCookie).toContain("Max-Age=604800");
    expect(requirement.sessionKey).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("persists digested sessions privately across service restarts", () => {
    process.env["FARFIELD_AUTH_PIN"] = "1234";
    const firstService = new AuthService("0.0.0.0");
    const login = firstService.login("1234", "100.64.0.5");
    const cookieName = firstService.getConfig().cookieName;
    const cookieHeader = cookieHeaderFromSetCookie(login.setCookie ?? "", cookieName);
    const rawSessionId = cookieHeader.slice(cookieHeader.indexOf("=") + 1);

    const secondService = new AuthService("0.0.0.0");
    expect(secondService.requireSession(cookieHeader).ok).toBe(true);

    const stateDirectory = path.join(stateHome, "codex-mobile");
    const statePath = path.join(stateDirectory, "sessions.json");
    const storedState = readFileSync(statePath, "utf8");
    expect(storedState).not.toContain(rawSessionId);
    expect(statSync(stateDirectory).mode & 0o777).toBe(0o700);
    expect(statSync(statePath).mode & 0o777).toBe(0o600);
  });

  it("returns AUTH_EXPIRED for expired session", () => {
    process.env["FARFIELD_AUTH_PIN"] = "1234";
    process.env["FARFIELD_SESSION_TTL_SECONDS"] = "1";
    const nowSpy = vi.spyOn(Date, "now");

    nowSpy.mockReturnValue(1_000);
    const service = new AuthService("0.0.0.0");
    const login = service.login("1234", "100.64.0.7");

    const cookieName = service.getConfig().cookieName;
    const cookieHeader = cookieHeaderFromSetCookie(login.setCookie ?? "", cookieName);

    nowSpy.mockReturnValue(3_000);
    const requirement = service.requireSession(cookieHeader);
    expect(requirement.ok).toBe(false);
    expect(requirement.code).toBe("AUTH_EXPIRED");
  });

  it("rate limits repeated invalid login attempts", () => {
    process.env["FARFIELD_AUTH_PIN"] = "1234";
    const service = new AuthService("0.0.0.0");

    for (let attemptIndex = 0; attemptIndex < 8; attemptIndex += 1) {
      service.login("9999", "100.64.0.8");
    }

    const blockedAttempt = service.login("9999", "100.64.0.8");
    expect(blockedAttempt.ok).toBe(false);
    expect(blockedAttempt.error).toMatch(/Too many failed attempts/);
  });

  it("invalidates session on logout", () => {
    process.env["FARFIELD_AUTH_PIN"] = "1234";
    const service = new AuthService("0.0.0.0");
    const login = service.login("1234", "100.64.0.9");

    const cookieName = service.getConfig().cookieName;
    const cookieHeader = cookieHeaderFromSetCookie(login.setCookie ?? "", cookieName);
    const beforeLogout = service.requireSession(cookieHeader);
    expect(beforeLogout.ok).toBe(true);

    service.logout(cookieHeader);
    const afterLogout = service.requireSession(cookieHeader);
    expect(afterLogout.ok).toBe(false);
    expect(afterLogout.code).toBe("AUTH_INVALID");

    const restartedService = new AuthService("0.0.0.0");
    expect(restartedService.requireSession(cookieHeader).ok).toBe(false);
  });

  it("adds Secure to session and clear cookies when configured", () => {
    process.env["FARFIELD_AUTH_PIN"] = "1234";
    process.env["FARFIELD_AUTH_COOKIE_SECURE"] = "1";
    const service = new AuthService("0.0.0.0");

    const login = service.login("1234", "100.64.0.5");
    expect(login.setCookie).toContain("; Secure");
    expect(service.getClearCookieHeader()).toContain("; Secure");
  });

  it("coalesces sliding-session disk writes while preserving renewal across restarts", () => {
    process.env["FARFIELD_AUTH_PIN"] = "1234";
    const clock = vi.spyOn(Date, "now").mockReturnValue(100_000);
    const service = new AuthService("0.0.0.0");
    const login = service.login("1234", "100.64.0.5");
    const cookie = cookieHeaderFromSetCookie(login.setCookie ?? "", service.getConfig().cookieName);
    const statePath = path.join(stateHome, "codex-mobile", "sessions.json");
    const initialState = readFileSync(statePath, "utf8");
    for (let index = 1; index <= 100; index += 1) {
      clock.mockReturnValue(100_000 + index);
      expect(service.requireSession(cookie).ok).toBe(true);
    }
    expect(readFileSync(statePath, "utf8")).toBe(initialState);
    clock.mockReturnValue(160_001);
    const renewed = service.requireSession(cookie);
    expect(renewed.expiresAt).not.toBe(login.expiresAt);
    expect(new AuthService("0.0.0.0").getSessionState(cookie).expiresAt).toBe(renewed.expiresAt);
  });

  it("renews short-lived sessions before they expire", () => {
    process.env["FARFIELD_AUTH_PIN"] = "1234";
    process.env["FARFIELD_SESSION_TTL_SECONDS"] = "1";
    const clock = vi.spyOn(Date, "now").mockReturnValue(1_000);
    const service = new AuthService("0.0.0.0");
    const login = service.login("1234", "100.64.0.5");
    const cookie = cookieHeaderFromSetCookie(login.setCookie ?? "", service.getConfig().cookieName);
    clock.mockReturnValue(1_600);
    expect(service.requireSession(cookie).expiresAt).toBe(new Date(2_600).toISOString());
    clock.mockReturnValue(2_100);
    expect(service.requireSession(cookie).ok).toBe(true);
  });
});
