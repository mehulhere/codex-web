import { type IncomingMessage } from "node:http";
import net from "node:net";
import { z } from "zod";

export const FARFIELD_CLIENT_ADDRESS_HEADER = "x-farfield-client-address";
const RESTRICTIVE_REMOTE_ADDRESS = "0.0.0.0";

const AddressSchema = z
  .string()
  .trim()
  .min(1)
  .refine((value) => !value.includes(",") && net.isIP(value) !== 0);

const HostHeaderSchema = z.string().trim().min(1).max(255);

function isLoopbackAddress(address: string): boolean {
  if (address === "::1") {
    return true;
  }
  if (address.startsWith("::ffff:")) {
    return address.slice("::ffff:".length).startsWith("127.");
  }
  return address.startsWith("127.") && net.isIP(address) === 4;
}

function isLocalHostHeader(hostHeader: string | undefined): boolean {
  const parsedHost = HostHeaderSchema.safeParse(hostHeader);
  if (!parsedHost.success) {
    return false;
  }

  try {
    const hostname = new URL(`http://${parsedHost.data}`).hostname.replace(/^\[|\]$/g, "");
    return hostname === "localhost" || isLoopbackAddress(hostname);
  } catch {
    return false;
  }
}

export function resolveProxyClientAddress(req: IncomingMessage): string {
  const directAddress = AddressSchema.safeParse(req.socket.remoteAddress);
  if (!directAddress.success) {
    return RESTRICTIVE_REMOTE_ADDRESS;
  }

  if (!isLoopbackAddress(directAddress.data)) {
    return directAddress.data;
  }

  const forwardedAddress = req.headers["x-forwarded-for"];
  if (forwardedAddress === undefined) {
    return isLocalHostHeader(req.headers.host)
      ? directAddress.data
      : RESTRICTIVE_REMOTE_ADDRESS;
  }

  const parsedForwardedAddress = AddressSchema.safeParse(forwardedAddress);
  return parsedForwardedAddress.success
    ? parsedForwardedAddress.data
    : RESTRICTIVE_REMOTE_ADDRESS;
}
