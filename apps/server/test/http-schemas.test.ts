import { describe, expect, it } from "vitest";
import {
  AuthErrorBodySchema,
  AuthSessionResponseSchema,
  DeviceStatusResponseSchema,
  HealthResponseSchema,
  ImageUploadResponseSchema,
  CompactThreadBodySchema,
  EditLastMessageBodySchema,
  ForkThreadBodySchema,
  LoginBodySchema,
  EditQueuedFollowUpBodySchema,
  QueuedFollowUpsResponseSchema,
  parseBody,
  ReplayBodySchema,
  RemoteStatusResponseSchema,
  SendMessageBodySchema,
  SetModeBodySchema,
  SideThreadBodySchema,
  SubmitUserInputBodySchema,
  ThreadAccountStatusResponseSchema,
  ThreadMediaRouteSchema,
  ThreadSettingsResponseSchema,
  UpdateThreadSettingsBodySchema
} from "../src/http-schemas.js";

describe("server request schemas", () => {
  it("validates native thread action bodies", () => {
    expect(
      parseBody(EditLastMessageBodySchema, {
        turnId: "turn-7",
        message: "revised"
      })
    ).toEqual({ turnId: "turn-7", message: "revised" });
    expect(parseBody(ForkThreadBodySchema, { turnId: "turn-7" })).toEqual({
      turnId: "turn-7"
    });
    expect(parseBody(SideThreadBodySchema, { cwd: "/workspace/project" })).toEqual({
      cwd: "/workspace/project"
    });
    expect(parseBody(CompactThreadBodySchema, {})).toEqual({});
  });

  it("validates authenticated thread media route parameters", () => {
    expect(
      parseBody(ThreadMediaRouteSchema, {
        threadId: "thread-1",
        itemId: "item-1",
        imageIndex: 0
      })
    ).toEqual({ threadId: "thread-1", itemId: "item-1", imageIndex: 0 });
    expect(() =>
      parseBody(ThreadMediaRouteSchema, {
        threadId: "thread-1",
        itemId: "item-1",
        imageIndex: -1
      })
    ).toThrow();
  });

  it("accepts valid send message body", () => {
    const parsed = parseBody(SendMessageBodySchema, {
      text: "hello",
      isSteering: false
    });

    expect(parsed.text).toBe("hello");
    expect(parsed.images).toEqual([]);

    const imageOnly = parseBody(SendMessageBodySchema, {
      text: "",
      images: ["00000000-0000-4000-8000-000000000002"]
    });
    expect(imageOnly.text).toBe("");
    expect(imageOnly.images).toHaveLength(1);
  });

  it("rejects whitespace-only send message text", () => {
    expect(() =>
      parseBody(SendMessageBodySchema, {
        text: "   \n\t"
      })
    ).toThrowError(/message text or image is required/i);
  });

  it("rejects duplicate or excessive image references", () => {
    const id = "00000000-0000-4000-8000-000000000002";
    expect(() => parseBody(SendMessageBodySchema, { text: "x", images: [id, id] })).toThrow();
    expect(() =>
      parseBody(SendMessageBodySchema, {
        text: "x",
        images: Array.from({ length: 9 }, () => id)
      })
    ).toThrow();
  });

  it("validates the public image upload response", () => {
    expect(
      parseBody(ImageUploadResponseSchema, {
        ok: true,
        image: {
          id: "00000000-0000-4000-8000-000000000002",
          filename: "paste.png",
          mediaType: "image/png",
          size: 12,
          url: "/api/uploads/00000000-0000-4000-8000-000000000002"
        }
      }).image.filename
    ).toBe("paste.png");
  });

  it("validates strict queue edit bodies and public queue responses", () => {
    expect(parseBody(EditQueuedFollowUpBodySchema, { text: "revised" })).toEqual({
      text: "revised"
    });
    expect(
      parseBody(QueuedFollowUpsResponseSchema, {
        ok: true,
        threadId: "thread-1",
        ownerClientId: "client-1",
        messages: [
          {
            id: "queue-1",
            text: "follow up",
            createdAt: 1_700_000_000_000
          }
        ]
      }).messages[0]?.text
    ).toBe("follow up");
    expect(() =>
      parseBody(EditQueuedFollowUpBodySchema, { text: "revised", extra: true })
    ).toThrowError(/Unrecognized key/);
  });

  it("rejects unknown fields", () => {
    expect(() =>
      parseBody(SendMessageBodySchema, {
        text: "hello",
        extra: true
      })
    ).toThrowError(/Unrecognized key/);
  });

  it("validates set mode body", () => {
    const parsed = parseBody(SetModeBodySchema, {
      collaborationMode: {
        mode: "plan",
        settings: {
          model: "gpt-5.3-codex",
          reasoning_effort: "high",
          developer_instructions: "x"
        }
      }
    });

    expect(parsed.collaborationMode.mode).toBe("plan");
  });

  it("rejects invalid request id type", () => {
    expect(() =>
      parseBody(SubmitUserInputBodySchema, {
        requestId: "bad",
        response: {}
      })
    ).toThrowError(/Expected number/);
  });

  it("validates replay body", () => {
    const parsed = parseBody(ReplayBodySchema, {
      entryId: "abc",
      waitForResponse: true
    });

    expect(parsed.waitForResponse).toBe(true);
  });

  it("validates login body", () => {
    const parsed = parseBody(LoginBodySchema, {
      pin: "1234"
    });

    expect(parsed.pin).toBe("1234");
  });

  it("validates auth session response", () => {
    const parsed = parseBody(AuthSessionResponseSchema, {
      ok: true,
      authenticated: false,
      expiresAt: null,
      requiresAuth: true,
      remoteRequest: true,
      debugAvailable: false,
      fullControlAvailable: true
    });

    expect(parsed.requiresAuth).toBe(true);
  });

  it("exposes only minimal authenticated health state", () => {
    const parsed = parseBody(HealthResponseSchema, {
      ok: true,
      state: {
        appReady: true,
        ipcConnected: true,
        ipcInitialized: true,
        requiresAuth: true,
        multiAccount: false
      }
    });
    expect(parsed.state.appReady).toBe(true);
    expect(() =>
      parseBody(HealthResponseSchema, {
        ok: true,
        state: {
          appReady: true,
          ipcConnected: true,
          ipcInitialized: true,
          requiresAuth: true,
          multiAccount: false,
          gitCommit: "secret"
        }
      })
    ).toThrowError(/Unrecognized key/);
  });

  it("validates remote status response", () => {
    const parsed = parseBody(RemoteStatusResponseSchema, {
      ok: true,
      tailscaleInstalled: true,
      tailscaleIps: ["100.64.0.2"],
      host: "0.0.0.0",
      port: 4311
    });

    expect(parsed.port).toBe(4311);
  });

  it("validates the authenticated device status response without host details", () => {
    const parsed = parseBody(DeviceStatusResponseSchema, {
      ok: true,
      status: {
        updatedAt: "2026-08-01T00:00:00.000Z",
        machineState: "awake",
        battery: { available: true, percent: 73, state: "discharging" },
        acPower: { available: true, connected: false },
        cpuTemperature: { available: true, celsius: 70.4 },
        gpuTemperature: { available: true, celsius: 57 },
        brightness: { available: true, percent: 76 },
        session: { available: true, active: true, locked: false, idle: false }
      }
    });

    expect(parsed.status.battery).toEqual({
      available: true,
      percent: 73,
      state: "discharging"
    });
    expect(() =>
      parseBody(DeviceStatusResponseSchema, {
        ...parsed,
        status: {
          ...parsed.status,
          batteryPath: "/sys/class/power_supply/BAT0"
        }
      })
    ).toThrowError(/Unrecognized key/);
  });

  it("validates auth error shape", () => {
    const parsed = parseBody(AuthErrorBodySchema, {
      ok: false,
      error: "Authentication is required.",
      code: "AUTH_REQUIRED"
    });

    expect(parsed.code).toBe("AUTH_REQUIRED");
  });

  it("validates a masked thread account response", () => {
    const parsed = parseBody(ThreadAccountStatusResponseSchema, {
      ok: true,
      state: "assigned",
      accountNumber: 4,
      accountDisplay: "Account 4 (de***@example.com)",
      maskedEmail: "de***@example.com",
      quota5h: { remainingPercent: 79, resetAtMs: 1_783_798_873_165 },
      quota7d: { remainingPercent: 96, resetAtMs: 1_784_361_887_165 },
      poolQuota: null,
      updatedAt: 1_783_781_435_801,
      stale: false,
      reason: "Saved task assignment"
    });

    expect(parsed.accountNumber).toBe(4);
  });

  it("validates authoritative thread settings", () => {
    expect(
      parseBody(ThreadSettingsResponseSchema, {
        ok: true,
        model: "gpt-5.5",
        modelProvider: "codex-multi-auth-runtime-proxy",
        reasoningEffort: "high"
      }).model
    ).toBe("gpt-5.5");
  });

  it("validates sticky thread setting updates", () => {
    const parsed = parseBody(UpdateThreadSettingsBodySchema, {
      model: "gpt-5.5",
      effort: "high",
      collaborationMode: null
    });
    expect(parsed.effort).toBe("high");
  });
});
