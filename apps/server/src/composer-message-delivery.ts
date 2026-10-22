import type { ComposerMessageDelivery } from "./thread-owner.js";

interface DesktopSubmissionAcknowledgement {
  ownerClientId: string;
}

interface ExecuteComposerMessageDeliveryOptions {
  delivery: ComposerMessageDelivery;
  submitDesktop: () => Promise<DesktopSubmissionAcknowledgement>;
  sendAppServer: (
    fallbackFromDesktop: boolean
  ) => Promise<DesktopSubmissionAcknowledgement | null | void>;
}

export interface ComposerMessageDeliveryResult {
  transport: ComposerMessageDelivery["type"];
  ownerClientId: string | null;
  fallbackFromDesktop: boolean;
}

export type DesktopComposerSubmission =
  | "queued-follow-up"
  | "native-composer"
  | "direct-turn";

export function desktopComposerSubmissionNeedsResume(
  submission: DesktopComposerSubmission
): submission is "direct-turn" {
  return submission === "direct-turn";
}

export async function resolveDesktopComposerOwner(input: {
  submission: DesktopComposerSubmission;
  cachedOwnerClientId: string | undefined;
  discoverOwner: () => Promise<string>;
}): Promise<string | null> {
  if (input.submission === "native-composer") {
    return null;
  }
  if (input.cachedOwnerClientId) {
    return input.cachedOwnerClientId;
  }
  if (input.submission === "queued-follow-up") {
    return null;
  }
  return input.discoverOwner();
}

export function resolveDesktopComposerSubmission(input: {
  isActive: boolean;
  isSteering: boolean;
  imageCount: number;
}): DesktopComposerSubmission {
  if (input.isActive && !input.isSteering) {
    return "queued-follow-up";
  }
  if (input.isSteering || input.imageCount > 0) {
    return "direct-turn";
  }
  return "native-composer";
}

function isNoDesktopClientFound(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /(?:^|\W)no-client-found(?:\W|$)/u.test(message);
}

function isDesktopRequestUnavailable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    isNoDesktopClientFound(error) ||
    /(?:^|\W)request-timeout(?:\W|$)/u.test(message) ||
    /request timed out:\s*thread-follower-type-and-submit-message(?:\W|$)/u.test(message)
  );
}

export async function executeComposerMessageDelivery(
  options: ExecuteComposerMessageDeliveryOptions
): Promise<ComposerMessageDeliveryResult> {
  if (options.delivery.type === "app-server") {
    const transferredAcknowledgement = await options.sendAppServer(false);
    if (transferredAcknowledgement) {
      return {
        transport: "desktop-takeover",
        ownerClientId: transferredAcknowledgement.ownerClientId,
        fallbackFromDesktop: false
      };
    }
    return {
      transport: "app-server",
      ownerClientId: null,
      fallbackFromDesktop: false
    };
  }

  try {
    const acknowledgement = await options.submitDesktop();
    return {
      transport: "desktop-takeover",
      ownerClientId: acknowledgement.ownerClientId,
      fallbackFromDesktop: false
    };
  } catch (error) {
    if (!isDesktopRequestUnavailable(error)) {
      throw error;
    }

    await options.sendAppServer(true);
    return {
      transport: "app-server",
      ownerClientId: null,
      fallbackFromDesktop: true
    };
  }
}
