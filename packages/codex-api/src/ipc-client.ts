import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import net from "node:net";
import {
  IpcBroadcastFrameSchema,
  IpcClientDiscoveryResponseFrameSchema,
  IpcFrameSchema,
  IpcRequestFrameSchema,
  IpcResponseFrameSchema,
  type IpcBroadcastFrame,
  type IpcFrame,
  type IpcResponseFrame,
  parseIpcFrame
} from "@farfield/protocol";
import { DesktopIpcError } from "./errors.js";
import { IpcFrameDecoder } from "./ipc-frame-decoder.js";
import { z } from "zod";

interface PendingRequest {
  method: string;
  timer: NodeJS.Timeout;
  resolve: (value: IpcResponseFrame) => void;
  reject: (error: Error) => void;
}

export interface SendRequestOptions {
  targetClientId?: string;
  version?: number;
  timeoutMs?: number;
}

export interface SendBroadcastOptions {
  targetClientIds?: string[];
  version?: number;
}

export interface DesktopIpcClientOptions {
  socketPath: string;
  requestTimeoutMs?: number;
}

export type IpcFrameListener = (frame: IpcFrame) => void;
export interface IpcConnectionState {
  connected: boolean;
  reason?: string;
}
export type IpcConnectionListener = (state: IpcConnectionState) => void;

const MAX_FRAME_SIZE_BYTES = 256 * 1024 * 1024;
const INITIALIZING_CLIENT_ID = "initializing-client";

export class DesktopIpcClient {
  private readonly socketPath: string;
  private readonly requestTimeoutMs: number;
  private socket: net.Socket | null = null;
  private readonly decoder = new IpcFrameDecoder(MAX_FRAME_SIZE_BYTES);
  private clientId: string | null = null;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly events = new EventEmitter();

  public constructor(options: DesktopIpcClientOptions) {
    this.socketPath = options.socketPath;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 20_000;
  }

  public onFrame(listener: IpcFrameListener): () => void {
    this.events.on("frame", listener);
    return () => this.events.off("frame", listener);
  }

  public onConnectionState(listener: IpcConnectionListener): () => void {
    this.events.on("connection-state", listener);
    return () => this.events.off("connection-state", listener);
  }

  public isConnected(): boolean {
    return this.socket !== null;
  }

  public async connect(): Promise<void> {
    if (this.socket) {
      throw new DesktopIpcError("IPC client is already connected");
    }

    this.socket = await new Promise<net.Socket>((resolve, reject) => {
      const socket = net.createConnection(this.socketPath);

      const onConnect = (): void => {
        socket.off("error", onError);
        resolve(socket);
      };
      const onError = (error: Error): void => {
        socket.off("connect", onConnect);
        const wrapped = new DesktopIpcError(error.message);
        this.emitConnectionState({
          connected: false,
          reason: wrapped.message
        });
        reject(wrapped);
      };

      socket.once("connect", onConnect);
      socket.once("error", onError);
    });

    this.socket.on("data", (chunk) => this.handleData(chunk));
    this.socket.on("close", () => {
      this.rejectAll(new DesktopIpcError("IPC socket closed"));
      this.socket = null;
      this.decoder.reset();
      this.clientId = null;
      this.emitConnectionState({
        connected: false,
        reason: "IPC socket closed"
      });
    });
    this.socket.on("error", (error) => {
      this.rejectAll(new DesktopIpcError(`IPC socket error: ${error.message}`));
      this.emitConnectionState({
        connected: false,
        reason: `IPC socket error: ${error.message}`
      });
    });

    this.emitConnectionState({ connected: true });
  }

  public async disconnect(): Promise<void> {
    const socket = this.socket;
    if (!socket) {
      return;
    }

    this.socket = null;
    this.clientId = null;
    this.rejectAll(new DesktopIpcError("IPC client disconnected"));

    await new Promise<void>((resolve) => {
      socket.once("close", () => resolve());
      socket.end();
    });
  }

  private rejectAll(error: Error): void {
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    this.pending.clear();
  }

  private ensureSocket(): net.Socket {
    if (!this.socket) {
      throw new DesktopIpcError("IPC socket is not connected");
    }
    return this.socket;
  }

  private emitFrame(frame: IpcFrame): void {
    this.events.emit("frame", frame);
  }

  private emitConnectionState(state: IpcConnectionState): void {
    this.events.emit("connection-state", state);
  }

  private writeFrame(frame: unknown): void {
    const socket = this.ensureSocket();
    const encoded = Buffer.from(JSON.stringify(frame), "utf8");
    const header = Buffer.alloc(4);
    header.writeUInt32LE(encoded.length, 0);
    socket.write(Buffer.concat([header, encoded]));
  }

  private respondClientDiscovery(requestId: string): void {
    const response = IpcClientDiscoveryResponseFrameSchema.parse({
      type: "client-discovery-response",
      requestId,
      response: {
        canHandle: false
      }
    });

    this.writeFrame(response);
  }

  private respondNoHandler(requestId: string): void {
    const response = IpcResponseFrameSchema.parse({
      type: "response",
      requestId,
      resultType: "error",
      error: "no-handler-for-request"
    });

    this.writeFrame(response);
  }

  private handleData(chunk: Buffer): void {
    try {
      this.decoder.push(chunk, (payload) => this.handlePayload(payload));
    } catch (error) {
      const reason = `IPC protocol error: ${z.instanceof(Error).parse(error).message}`;
      this.rejectAll(new DesktopIpcError(reason));
      this.decoder.reset();
      this.socket?.destroy();
      this.emitConnectionState({ connected: false, reason });
    }
  }

  private handlePayload(payload: Buffer): void {
    const frame = parseIpcFrame(JSON.parse(payload.toString("utf8")));
    this.emitFrame(frame);
    if (frame.type === "client-discovery-request") {
      this.respondClientDiscovery(frame.requestId);
      return;
    }
    if (frame.type === "request") {
      this.respondNoHandler(frame.requestId);
      return;
    }
    if (frame.type !== "response") return;
    const pending = this.pending.get(frame.requestId);
    if (!pending) return;
    if (pending.method === "initialize" && frame.resultType !== "error") {
      this.clientId = z.object({ clientId: z.string().min(1) }).passthrough().parse(frame.result).clientId;
    }
    this.pending.delete(frame.requestId);
    clearTimeout(pending.timer);
    if (frame.resultType === "error") {
      pending.reject(new DesktopIpcError(`IPC ${pending.method} failed: ${JSON.stringify(frame.error)}`));
      return;
    }
    pending.resolve(frame);
  }

  public sendBroadcast(
    method: string,
    params: IpcBroadcastFrame["params"],
    options: SendBroadcastOptions = {}
  ): void {
    const frame = IpcBroadcastFrameSchema.parse({
      type: "broadcast",
      method,
      params,
      sourceClientId: this.clientId ?? INITIALIZING_CLIENT_ID,
      targetClientIds: options.targetClientIds,
      version: options.version
    });

    this.writeFrame(frame);
  }

  public async sendRequestAndWait(
    method: string,
    params: unknown,
    options: SendRequestOptions = {}
  ): Promise<IpcResponseFrame> {
    this.ensureSocket();
    const requestId = randomUUID();

    const frame = IpcRequestFrameSchema.parse({
      type: "request",
      requestId,
      method,
      params,
      sourceClientId: this.clientId ?? INITIALIZING_CLIENT_ID,
      targetClientId: options.targetClientId,
      version: options.version
    });

    const timeout = options.timeoutMs ?? this.requestTimeoutMs;

    const responsePromise = new Promise<IpcResponseFrame>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new DesktopIpcError(`IPC request timed out: ${method}`));
      }, timeout);

      this.pending.set(requestId, {
        method,
        timer,
        resolve,
        reject
      });
    });

    this.writeFrame(frame);
    return responsePromise;
  }

  public async initialize(_userAgent: string): Promise<IpcResponseFrame> {
    this.ensureSocket();
    const requestId = randomUUID();
    const frame = IpcRequestFrameSchema.parse({
      type: "request",
      requestId,
      sourceClientId: INITIALIZING_CLIENT_ID,
      version: 1,
      method: "initialize",
      params: {
        clientType: "farfield"
      }
    });

    const responsePromise = new Promise<IpcResponseFrame>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new DesktopIpcError("IPC initialize request timed out"));
      }, this.requestTimeoutMs);

      this.pending.set(requestId, {
        method: "initialize",
        timer,
        resolve,
        reject
      });
    });

    this.writeFrame(frame);
    return responsePromise;
  }
}
