import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import readline from "node:readline";
import { randomUUID } from "node:crypto";
import {
  AppServerRpcError,
  AppServerTransportError
} from "./errors.js";
import {
  type JsonRpcNotification,
  type JsonRpcServerRequest,
  JsonRpcRequestSchema,
  JsonRpcServerResponseSchema,
  parseJsonRpcIncomingMessage
} from "./json-rpc.js";

export type AppServerNotificationListener = (notification: JsonRpcNotification) => void;
export type AppServerServerRequestHandler = (request: JsonRpcServerRequest) => unknown | Promise<unknown>;
export type AppServerTransportClosedHandler = (error: AppServerTransportError) => void;

export class AppServerServerRequestError extends Error {
  public constructor(public readonly code: number, message: string, public readonly data?: unknown) {
    super(message);
    this.name = "AppServerServerRequestError";
  }
}

export interface AppServerTransport {
  request(method: string, params: unknown, timeoutMs?: number): Promise<unknown>;
  onNotification?: (listener: AppServerNotificationListener) => () => void;
  close(): Promise<void>;
}

interface PendingRequest {
  timer: NodeJS.Timeout;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

export interface ChildProcessAppServerTransportOptions {
  executablePath: string;
  userAgent: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  requestTimeoutMs?: number;
  onStderr?: (line: string) => void;
  onServerRequest?: AppServerServerRequestHandler;
  onTransportClosed?: AppServerTransportClosedHandler;
}

export class ChildProcessAppServerTransport implements AppServerTransport {
  private readonly executablePath: string;
  private readonly userAgent: string;
  private readonly cwd: string | undefined;
  private readonly env: NodeJS.ProcessEnv | undefined;
  private readonly requestTimeoutMs: number;
  private readonly onStderr: ((line: string) => void) | undefined;
  private readonly onServerRequest: AppServerServerRequestHandler | undefined;
  private readonly onTransportClosed: AppServerTransportClosedHandler | undefined;
  private process: ChildProcessWithoutNullStreams | null = null;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly notificationListeners = new Set<AppServerNotificationListener>();
  private requestId = 0;
  private initialized = false;
  private initializeInFlight: Promise<void> | null = null;

  public constructor(options: ChildProcessAppServerTransportOptions) {
    this.executablePath = options.executablePath;
    this.userAgent = options.userAgent;
    this.cwd = options.cwd;
    this.env = options.env;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
    this.onStderr = options.onStderr;
    this.onServerRequest = options.onServerRequest;
    this.onTransportClosed = options.onTransportClosed;
  }

  private ensureStarted(): void {
    if (this.process) {
      return;
    }

    const child = spawn(this.executablePath, ["app-server"], {
      cwd: this.cwd,
      env: {
        ...process.env,
        ...this.env,
        CODEX_USER_AGENT: this.userAgent,
        CODEX_CLIENT_ID: `farfield-${randomUUID()}`
      },
      stdio: ["pipe", "pipe", "pipe"]
    });

    const closeChild = (error: AppServerTransportError): void => {
      if (this.process !== child) return;
      this.rejectAll(error);
      this.process = null;
      this.initialized = false;
      this.initializeInFlight = null;
      try { this.onTransportClosed?.(error); } catch { /* Callback errors cannot affect transport cleanup. */ }
    };

    child.on("exit", (code, signal) => {
      closeChild(new AppServerTransportError(`app-server exited (code=${String(code)}, signal=${String(signal)})`));
    });

    child.on("error", (error) => {
      closeChild(new AppServerTransportError(`app-server process error: ${error.message}`));
    });

    const lineReader = readline.createInterface({ input: child.stdout });
    lineReader.on("line", (line) => {
      if (this.process !== child) return;
      const trimmed = line.trim();
      if (!trimmed) {
        return;
      }

      let raw: unknown;
      try {
        raw = JSON.parse(trimmed);
      } catch {
        this.rejectAll(new AppServerTransportError("app-server returned invalid JSON"));
        return;
      }

      let message;
      try {
        message = parseJsonRpcIncomingMessage(raw);
      } catch (error) {
        this.rejectAll(
          new AppServerTransportError(
            `app-server response schema mismatch: ${error instanceof Error ? error.message : String(error)}`
          )
        );
        return;
      }

      if (message.kind === "server-request") {
        void this.handleServerRequest(child, message.value);
        return;
      }

      if (message.kind === "notification") {
        for (const listener of this.notificationListeners) {
          listener(message.value);
        }
        return;
      }

      const pending = this.pending.get(message.value.id);
      if (!pending) {
        return;
      }

      this.pending.delete(message.value.id);
      clearTimeout(pending.timer);

      if (message.value.error) {
        pending.reject(
          new AppServerRpcError(
            message.value.error.code,
            message.value.error.message,
            message.value.error.data
          )
        );
        return;
      }

      pending.resolve(message.value.result);
    });

    const stderrReader = readline.createInterface({ input: child.stderr });
    stderrReader.on("line", (line) => {
      const trimmed = line.trim();
      if (!trimmed) {
        return;
      }

      try {
        this.onStderr?.(trimmed);
      } catch {
        // Never fail protocol requests because of stderr log handling.
      }
    });

    this.process = child;
  }

  private async handleServerRequest(
    child: ChildProcessWithoutNullStreams,
    request: JsonRpcServerRequest
  ): Promise<void> {
    try {
      if (!this.onServerRequest) {
        throw new AppServerServerRequestError(-32601, `Unsupported app-server request: ${request.method}`);
      }
      const result = await this.onServerRequest(request);
      if (this.process !== child) return;
      child.stdin.write(`${JSON.stringify(JsonRpcServerResponseSchema.parse({ id: request.id, result: result ?? null }))}\n`, () => undefined);
    } catch (error) {
      if (this.process !== child) return;
      const code = error instanceof AppServerServerRequestError ? error.code : -32603;
      const message = error instanceof Error ? error.message : String(error);
      const data = error instanceof AppServerServerRequestError ? error.data : undefined;
      child.stdin.write(`${JSON.stringify(JsonRpcServerResponseSchema.parse({
        id: request.id,
        error: { code, message, ...(data === undefined ? {} : { data }) }
      }))}\n`, () => undefined);
    }
  }

  private rejectAll(error: Error): void {
    for (const { timer, reject } of this.pending.values()) {
      clearTimeout(timer);
      reject(error);
    }
    this.pending.clear();
  }

  private async sendRequest(method: string, params: unknown, timeoutMs?: number): Promise<unknown> {
    const processHandle = this.process;
    if (!processHandle) {
      throw new AppServerTransportError("app-server failed to start");
    }

    const id = ++this.requestId;
    const timeout = timeoutMs ?? this.requestTimeoutMs;
    const requestPayload = JsonRpcRequestSchema.parse({
      jsonrpc: "2.0",
      id,
      method,
      params
    });
    const encoded = JSON.stringify(requestPayload) + "\n";

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new AppServerTransportError(`app-server request timed out: ${method}`));
      }, timeout);

      this.pending.set(id, { timer, resolve, reject });

      processHandle.stdin.write(encoded, (error) => {
        if (!error) {
          return;
        }

        const pending = this.pending.get(id);
        if (!pending) {
          return;
        }

        clearTimeout(pending.timer);
        this.pending.delete(id);
        pending.reject(new AppServerTransportError(`failed to write app-server request: ${error.message}`));
      });
    });
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) {
      return;
    }

    if (this.initializeInFlight) {
      return this.initializeInFlight;
    }

    this.initializeInFlight = (async () => {
      const result = await this.sendRequest(
        "initialize",
        {
          clientInfo: {
            name: "farfield",
            version: "0.2.0"
          },
          capabilities: {
            experimentalApi: true
          }
        },
        this.requestTimeoutMs
      );

      if (!result || typeof result !== "object") {
        throw new AppServerTransportError("app-server initialize returned invalid result");
      }

      this.initialized = true;
    })().finally(() => {
      this.initializeInFlight = null;
    });

    return this.initializeInFlight;
  }

  public async request(method: string, params: unknown, timeoutMs?: number): Promise<unknown> {
    this.ensureStarted();

    if (method !== "initialize") {
      await this.ensureInitialized();
    }

    const result = await this.sendRequest(method, params, timeoutMs);
    if (method === "initialize") {
      this.initialized = true;
    }
    return result;
  }

  public onNotification(listener: AppServerNotificationListener): () => void {
    this.notificationListeners.add(listener);
    return () => {
      this.notificationListeners.delete(listener);
    };
  }

  public async close(): Promise<void> {
    const processHandle = this.process;
    if (!processHandle) {
      return;
    }

    this.process = null;
    this.initialized = false;
    this.initializeInFlight = null;
    this.rejectAll(new AppServerTransportError("app-server transport closed"));

    try {
      this.onTransportClosed?.(new AppServerTransportError("app-server transport closed"));
    } catch {
      // Callback errors cannot affect transport cleanup.
    }

    processHandle.kill("SIGTERM");
  }
}
