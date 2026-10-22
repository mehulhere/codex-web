import { execFileSync } from "node:child_process";
import net from "node:net";

export interface RemoteStatusSnapshot {
  tailscaleInstalled: boolean;
  tailscaleIps: string[];
  host: string;
  port: number;
}

function parseTailscaleIpOutput(stdout: string): string[] {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) => net.isIP(line) === 4);
}

function isCommandMissingError(error: Error): boolean {
  const maybeErrno = error as NodeJS.ErrnoException;
  return maybeErrno.code === "ENOENT";
}

function readTailscaleIps(): {
  tailscaleInstalled: boolean;
  tailscaleIps: string[];
} {
  try {
    const stdout = execFileSync("tailscale", ["ip", "-4"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
    return {
      tailscaleInstalled: true,
      tailscaleIps: parseTailscaleIpOutput(stdout)
    };
  } catch (error) {
    if (error instanceof Error && isCommandMissingError(error)) {
      return {
        tailscaleInstalled: false,
        tailscaleIps: []
      };
    }

    return {
      tailscaleInstalled: true,
      tailscaleIps: []
    };
  }
}

export function getRemoteStatusSnapshot(host: string, port: number): RemoteStatusSnapshot {
  const tailscale = readTailscaleIps();
  return {
    tailscaleInstalled: tailscale.tailscaleInstalled,
    tailscaleIps: tailscale.tailscaleIps,
    host,
    port
  };
}
