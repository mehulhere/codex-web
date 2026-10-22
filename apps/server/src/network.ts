import { type IncomingMessage } from "node:http";
import net from "node:net";
import { z } from "zod";

const IPV4_MAPPED_IPV6_PREFIX = "::ffff:";
export const FARFIELD_CLIENT_ADDRESS_HEADER = "x-farfield-client-address";

const ProxyClientAddressSchema = z
  .string()
  .trim()
  .min(1)
  .refine((value) => !value.includes(",") && net.isIP(value) !== 0);

function stripZoneIndex(address: string): string {
  const percentIndex = address.indexOf("%");
  if (percentIndex === -1) {
    return address;
  }
  return address.slice(0, percentIndex);
}

function normalizeAddress(address: string): string {
  const trimmed = address.trim();
  if (!trimmed) {
    return "";
  }
  return stripZoneIndex(trimmed).toLowerCase();
}

function normalizeHost(host: string): string {
  const trimmed = host.trim().toLowerCase();
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function isLoopbackIpv4(address: string): boolean {
  if (net.isIP(address) !== 4) {
    return false;
  }
  return address.startsWith("127.");
}

function isLoopbackIpv6(address: string): boolean {
  if (net.isIP(address) !== 6) {
    return false;
  }
  return address === "::1";
}

function unwrapIpv4MappedIpv6(address: string): string {
  if (!address.startsWith(IPV4_MAPPED_IPV6_PREFIX)) {
    return address;
  }
  const candidate = address.slice(IPV4_MAPPED_IPV6_PREFIX.length);
  return net.isIP(candidate) === 4 ? candidate : address;
}

export function isLoopbackAddress(address: string): boolean {
  const normalized = normalizeAddress(address);
  if (!normalized) {
    return false;
  }

  if (isLoopbackIpv4(normalized) || isLoopbackIpv6(normalized)) {
    return true;
  }

  const unwrapped = unwrapIpv4MappedIpv6(normalized);
  if (unwrapped !== normalized) {
    return isLoopbackIpv4(unwrapped);
  }

  return false;
}

export function isLoopbackHost(host: string): boolean {
  const normalized = normalizeHost(host);
  if (!normalized) {
    return false;
  }

  if (normalized === "localhost") {
    return true;
  }

  return isLoopbackAddress(normalized);
}

export interface RequestNetworkInfo {
  remoteAddress: string | null;
  isRemote: boolean;
}

export function getRequestNetworkInfo(
  req: IncomingMessage,
  options: { directWeb?: boolean } = {}
): RequestNetworkInfo {
  const address = req.socket.remoteAddress ?? null;
  if (!address) {
    return {
      remoteAddress: null,
      isRemote: true
    };
  }

  if (isLoopbackAddress(address)) {
    // The production web listener sits directly behind Tailscale Serve.
    // Ignore the internal Vite header here; only the loopback proxy may supply an address.
    if (options.directWeb) {
      const forwarded = req.headers["x-forwarded-for"];
      if (forwarded !== undefined) {
        const parsed = ProxyClientAddressSchema.safeParse(forwarded);
        return parsed.success
          ? { remoteAddress: parsed.data, isRemote: !isLoopbackAddress(parsed.data) }
          : { remoteAddress: null, isRemote: true };
      }
      const host = z.string().min(1).max(255).safeParse(req.headers.host);
      try {
        if (host.success && isLoopbackHost(new URL(`http://${host.data}`).hostname)) {
          return { remoteAddress: address, isRemote: false };
        }
      } catch { /* Invalid host headers are treated as remote. */ }
      return { remoteAddress: null, isRemote: true };
    }
    const proxyAddress = req.headers[FARFIELD_CLIENT_ADDRESS_HEADER];
    if (proxyAddress !== undefined) {
      const parsed = ProxyClientAddressSchema.safeParse(proxyAddress);
      if (!parsed.success) {
        return {
          remoteAddress: null,
          isRemote: true
        };
      }

      return {
        remoteAddress: parsed.data,
        isRemote: !isLoopbackAddress(parsed.data)
      };
    }
  }

  return {
    remoteAddress: address,
    isRemote: !isLoopbackAddress(address)
  };
}
