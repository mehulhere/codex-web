import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent
} from "react";
import { ArrowUp, CirclePause, FileText, Loader2, Mic, Plus, Square, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  deleteComposerImage,
  uploadComposerImage,
  type ComposerImage
} from "@/lib/api";
import { appendTranscript, useDictation } from "@/hooks/useDictation";
import {
  SlashCommandMenu,
  type ComposerCommand,
  type SlashCommandOption
} from "@/components/SlashCommandMenu";

type ChatComposerProps = {
  canSend: boolean;
  canStartSide?: boolean;
  draft?: string;
  isBusy: boolean;
  isGenerating: boolean;
  isThreadActive?: boolean;
  isWaitingForResponse: boolean;
  onInterrupt: () => void | Promise<void>;
  onCommand?: (command: ComposerCommand) => void | Promise<void>;
  onDraftChange?: (draft: string) => void;
  onSend: (
    text: string,
    behavior: "queue" | "steer",
    imageIds: string[]
  ) => boolean | void | Promise<boolean | void>;
};

const MAX_COMPOSER_IMAGES = 8;
const MAX_COMPOSER_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_COMPOSER_FILES = 5;
const MAX_COMPOSER_FILE_BYTES = 1024 * 1024;
const COMPOSER_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/avif"
]);

type PendingComposerImage = {
  localId: string;
  filename: string;
  previewUrl: string;
  status: "uploading" | "ready" | "error";
  image?: ComposerImage;
  error?: string;
};

type PendingComposerFile = {
  localId: string;
  filename: string;
  content: string;
};

function readTextFile(file: File): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }
      reject(new Error("Text file did not contain text."));
    });
    reader.addEventListener("error", () => reject(new Error("Text file could not be read.")));
    reader.readAsText(file);
  });
}

export function ChatComposer({
  canSend,
  canStartSide = true,
  draft: controlledDraft,
  isBusy,
  isGenerating,
  isThreadActive = false,
  isWaitingForResponse,
  onInterrupt,
  onCommand = () => undefined,
  onDraftChange,
  onSend
}: ChatComposerProps): React.JSX.Element {
  const [localDraft, setLocalDraft] = useState("");
  const draft = controlledDraft ?? localDraft;
  const draftRef = useRef(draft);
  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);
  const updateDraft = useCallback((nextDraft: string): void => {
    draftRef.current = nextDraft;
    if (controlledDraft !== undefined) {
      onDraftChange?.(nextDraft);
      return;
    }
    setLocalDraft(nextDraft);
  }, [controlledDraft, onDraftChange]);
  const [followUpBehavior, setFollowUpBehavior] = useState<"queue" | "steer">("queue");
  const [selectedCommandIndex, setSelectedCommandIndex] = useState(0);
  const [commandMenuDismissed, setCommandMenuDismissed] = useState(false);
  const [pendingImages, setPendingImages] = useState<PendingComposerImage[]>([]);
  const [pendingFiles, setPendingFiles] = useState<PendingComposerFile[]>([]);
  const [pasteError, setPasteError] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingImagesRef = useRef<PendingComposerImage[]>([]);
  const removedImageIdsRef = useRef(new Set<string>());
  const nextImageIdRef = useRef(0);
  const resizeFrameRef = useRef<number | null>(null);
  const previousHeightRef = useRef(0);
  const addTranscript = useCallback((transcript: string) => {
    updateDraft(appendTranscript(draftRef.current, transcript));
  }, [updateDraft]);
  const dictation = useDictation(addTranscript);

  const commandOptions: SlashCommandOption[] = [
    {
      command: "status",
      description: "Show task, model, account, quota, and connection status",
      disabled: false
    },
    {
      command: "compact",
      description: "Compact the current task's context",
      disabled: false
    },
    {
      command: "side",
      description: canStartSide
        ? "Start a temporary side conversation"
        : "Available after this task has started",
      disabled: !canStartSide
    }
  ];
  const normalizedDraft = draft.trim().toLowerCase();
  const commandQueryMatches = /^\/[a-z]*$/.test(normalizedDraft);
  const visibleCommandOptions = commandQueryMatches
    ? commandOptions.filter((option) => `/${option.command}`.startsWith(normalizedDraft))
    : [];
  const commandMenuOpen = pendingImages.length === 0
    && pendingFiles.length === 0
    && !commandMenuDismissed
    && visibleCommandOptions.length > 0;

  const commandFromDraft = useCallback((): ComposerCommand | null => {
    switch (draft.trim().toLowerCase()) {
      case "/status":
        return "status";
      case "/compact":
        return "compact";
      case "/side":
        return canStartSide ? "side" : null;
      default:
        return null;
    }
  }, [canStartSide, draft]);

  const runCommand = useCallback(async (command: ComposerCommand) => {
    if (command === "side" && !canStartSide) {
      return;
    }
    textareaRef.current?.blur();
    await onCommand(command);
    updateDraft("");
    setSelectedCommandIndex(0);
    setCommandMenuDismissed(false);
    previousHeightRef.current = 0;
  }, [canStartSide, onCommand, updateDraft]);

  const resizeTextarea = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }

    const maxHeight = 200;
    textarea.style.height = "auto";
    const nextHeight = Math.min(textarea.scrollHeight, maxHeight);
    const currentHeight = previousHeightRef.current;

    if (currentHeight <= 0) {
      textarea.style.height = `${nextHeight}px`;
      previousHeightRef.current = nextHeight;
      return;
    }

    if (nextHeight === currentHeight) {
      textarea.style.height = `${nextHeight}px`;
      return;
    }

    textarea.style.height = `${currentHeight}px`;

    if (resizeFrameRef.current !== null) {
      window.cancelAnimationFrame(resizeFrameRef.current);
    }

    resizeFrameRef.current = window.requestAnimationFrame(() => {
      if (!textareaRef.current) {
        return;
      }
      textareaRef.current.style.height = `${nextHeight}px`;
      resizeFrameRef.current = null;
    });
    previousHeightRef.current = nextHeight;
  }, []);

  useEffect(() => {
    resizeTextarea();
  }, [draft, resizeTextarea]);

  useEffect(() => {
    return () => {
      if (resizeFrameRef.current !== null) {
        window.cancelAnimationFrame(resizeFrameRef.current);
      }
    };
  }, []);

  useEffect(() => {
    pendingImagesRef.current = pendingImages;
  }, [pendingImages]);

  useEffect(() => () => {
    for (const image of pendingImagesRef.current) {
      URL.revokeObjectURL(image.previewUrl);
    }
  }, []);

  const removeImage = useCallback((localId: string) => {
    const existing = pendingImagesRef.current.find((image) => image.localId === localId);
    if (!existing) return;
    setPendingImages((current) => current.filter((image) => image.localId !== localId));
    URL.revokeObjectURL(existing.previewUrl);
    if (existing.image) {
      void deleteComposerImage(existing.image.id).catch(() => undefined);
    } else {
      removedImageIdsRef.current.add(localId);
    }
  }, []);

  const queueImages = useCallback((files: readonly File[]) => {
    const remainingSlots = MAX_COMPOSER_IMAGES - pendingImagesRef.current.length;
    if (remainingSlots <= 0) {
      setPasteError(`You can attach up to ${MAX_COMPOSER_IMAGES} images.`);
      return;
    }

    const accepted: File[] = [];
    for (const file of files.slice(0, remainingSlots)) {
      if (!COMPOSER_IMAGE_TYPES.has(file.type)) {
        setPasteError("Attach a PNG, JPEG, WebP, GIF, or AVIF image.");
        continue;
      }
      if (file.size > MAX_COMPOSER_IMAGE_BYTES) {
        setPasteError("Each image must be 20 MB or smaller.");
        continue;
      }
      accepted.push(file);
    }
    if (files.length > remainingSlots) {
      setPasteError(`You can attach up to ${MAX_COMPOSER_IMAGES} images.`);
    }

    for (const file of accepted) {
      const localId = `image-${Date.now()}-${nextImageIdRef.current++}`;
      const previewUrl = URL.createObjectURL(file);
      const pending: PendingComposerImage = {
        localId,
        filename: file.name || "attached-image",
        previewUrl,
        status: "uploading"
      };
      setPendingImages((current) => [...current, pending]);
      void uploadComposerImage(file).then((image) => {
        if (removedImageIdsRef.current.delete(localId)) {
          return deleteComposerImage(image.id).catch(() => undefined);
        }
        setPendingImages((current) => current.map((item) =>
          item.localId === localId ? { ...item, filename: image.filename, status: "ready", image } : item
        ));
      }).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "Image upload failed";
        setPendingImages((current) => current.map((item) =>
          item.localId === localId ? { ...item, status: "error", error: message } : item
        ));
      });
    }
  }, []);

  const handleFileSelection = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = "";
    if (selectedFiles.length === 0) return;
    setPasteError("");

    const images = selectedFiles.filter((file) => COMPOSER_IMAGE_TYPES.has(file.type));
    queueImages(images);

    const documents = selectedFiles.filter((file) => !COMPOSER_IMAGE_TYPES.has(file.type));
    const remainingSlots = MAX_COMPOSER_FILES - pendingFiles.length;
    if (documents.length > remainingSlots) {
      setPasteError(`You can attach up to ${MAX_COMPOSER_FILES} files.`);
    }
    for (const file of documents.slice(0, Math.max(0, remainingSlots))) {
      if (file.size > MAX_COMPOSER_FILE_BYTES) {
        setPasteError("Each text file must be 1 MB or smaller.");
        continue;
      }
      try {
        const content = await readTextFile(file);
        setPendingFiles((current) => [
          ...current,
          {
            localId: `file-${Date.now()}-${nextImageIdRef.current++}`,
            filename: file.name || "attached-file.txt",
            content
          }
        ]);
      } catch {
        setPasteError("This file could not be read as text.");
      }
    }
  }, [pendingFiles.length, queueImages]);

  const handlePaste = useCallback((event: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(event.clipboardData.items)
      .filter((item) => item.kind === "file")
      .map((item) => item.getAsFile())
      .filter((file): file is File => file !== null);
    if (files.length === 0) return;

    event.preventDefault();
    setPasteError("");

    const pastedText = event.clipboardData.getData("text/plain");
    if (pastedText) {
      const textarea = textareaRef.current;
      const start = textarea?.selectionStart ?? draft.length;
      const end = textarea?.selectionEnd ?? start;
      updateDraft(`${draft.slice(0, start)}${pastedText}${draft.slice(end)}`);
    }

    queueImages(files);
  }, [draft, queueImages, updateDraft]);

  const sendDraft = useCallback(async (behavior = followUpBehavior) => {
    const readyImages = pendingImages.filter((image) => image.status === "ready" && image.image);
    const imagesAreSettled = pendingImages.every((image) => image.status === "ready");
    const fileText = pendingFiles.map(
      (file) => `[Attached file: ${file.filename}]\n${file.content}`
    );
    const outgoingText = [draft.trim(), ...fileText].filter((part) => part.length > 0).join("\n\n");
    if ((!outgoingText && readyImages.length === 0) || !imagesAreSettled || !canSend || isBusy) {
      return;
    }

    const command = pendingImages.length === 0 && pendingFiles.length === 0
      ? commandFromDraft()
      : null;
    if (command) {
      await runCommand(command);
    } else {
      const delivered = await onSend(
        outgoingText,
        behavior,
        readyImages.flatMap((image) => image.image ? [image.image.id] : [])
      );
      if (delivered === false) {
        return;
      }
    }
    for (const image of pendingImages) {
      URL.revokeObjectURL(image.previewUrl);
    }
    setPendingImages([]);
    setPendingFiles([]);
    setPasteError("");
    updateDraft("");
    previousHeightRef.current = 0;
  }, [canSend, commandFromDraft, draft, followUpBehavior, isBusy, onSend, pendingFiles, pendingImages, runCommand, updateDraft]);

  const imageUploadInProgress = pendingImages.some((image) => image.status !== "ready");
  const disableSend = !canSend
    || isBusy
    || imageUploadInProgress
    || (!draft.trim() && pendingImages.length === 0 && pendingFiles.length === 0);
  const workIsActive = isGenerating || isWaitingForResponse || isThreadActive;

  useEffect(() => {
    if (dictation.state === "idle" && !workIsActive) return;
    const handleEscape = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.key !== "Escape" || event.repeat) return;
      event.preventDefault();
      if (dictation.state !== "idle") {
        dictation.cancel();
      } else {
        void onInterrupt();
      }
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [dictation, onInterrupt, workIsActive]);

  return (
    <div className="relative flex flex-col rounded-[28px] border border-border bg-card px-2.5 py-2.5 focus-within:border-muted-foreground/40 transition-colors">
      {commandMenuOpen && (
        <SlashCommandMenu
          options={visibleCommandOptions}
          selectedIndex={Math.min(selectedCommandIndex, visibleCommandOptions.length - 1)}
          onSelect={(command) => void runCommand(command)}
        />
      )}
      {pendingImages.length > 0 && (
        <div className="flex gap-2 overflow-x-auto px-1 pb-2" aria-label="Attached images">
          {pendingImages.map((image) => (
            <div key={image.localId} className="relative h-16 w-16 shrink-0 overflow-hidden rounded-xl border border-border bg-muted">
              <img
                src={image.previewUrl}
                alt={image.filename}
                className={`h-full w-full object-cover ${image.status === "uploading" ? "opacity-50" : ""}`}
              />
              {image.status === "uploading" && (
                <Loader2 size={16} className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 animate-spin" />
              )}
              {image.status === "error" && (
                <span className="absolute inset-x-0 bottom-0 bg-destructive/90 px-1 py-0.5 text-center text-[9px] text-destructive-foreground">Failed</span>
              )}
              <button
                type="button"
                aria-label={`Remove ${image.filename}`}
                title={image.error ?? `Remove ${image.filename}`}
                onClick={() => removeImage(image.localId)}
                className="absolute right-0.5 top-0.5 rounded-full bg-background/90 p-0.5 text-foreground shadow"
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
      {pendingFiles.length > 0 && (
        <div className="flex flex-wrap gap-2 px-1 pb-2" aria-label="Attached files">
          {pendingFiles.map((file) => (
            <div
              key={file.localId}
              className="flex max-w-full items-center gap-2 rounded-xl border border-border bg-muted/40 px-2.5 py-1.5 text-xs"
            >
              <FileText size={14} className="shrink-0 text-muted-foreground" />
              <span className="truncate">{file.filename}</span>
              <button
                type="button"
                aria-label={`Remove ${file.filename}`}
                onClick={() =>
                  setPendingFiles((current) =>
                    current.filter((item) => item.localId !== file.localId)
                  )
                }
                className="rounded-full p-0.5 text-muted-foreground hover:text-foreground"
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
      {pasteError && <p className="px-1 pb-1 text-xs text-destructive" role="alert">{pasteError}</p>}
      <div className="flex items-end gap-2 pl-1.5">
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="sr-only"
        aria-label="Choose images or files"
        accept="image/png,image/jpeg,image/webp,image/gif,image/avif,text/*,.md,.json,.csv,.ts,.tsx,.js,.jsx,.py,.rs,.go,.java,.c,.cpp,.h,.css,.html,.xml,.yaml,.yml,.toml,.log"
        onChange={(event) => void handleFileSelection(event)}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-9 w-9 shrink-0 self-end rounded-full text-muted-foreground"
        aria-label="Attach images or files"
        title="Attach images or text files"
        onClick={() => fileInputRef.current?.click()}
      >
        <Plus size={16} />
      </Button>
      <Textarea
        ref={textareaRef}
        value={draft}
        onPaste={handlePaste}
        onChange={(e) => {
          updateDraft(e.target.value);
          setSelectedCommandIndex(0);
          setCommandMenuDismissed(false);
          resizeTextarea();
        }}
        onKeyDown={(e) => {
          if (commandMenuOpen && e.key === "ArrowDown") {
            e.preventDefault();
            setSelectedCommandIndex((current) =>
              (current + 1) % visibleCommandOptions.length
            );
            return;
          }
          if (commandMenuOpen && e.key === "ArrowUp") {
            e.preventDefault();
            setSelectedCommandIndex((current) =>
              (current - 1 + visibleCommandOptions.length) % visibleCommandOptions.length
            );
            return;
          }
          if (
            commandMenuOpen &&
            e.key === "Enter" &&
            !e.shiftKey &&
            !e.metaKey &&
            !e.ctrlKey
          ) {
            e.preventDefault();
            const option = visibleCommandOptions[selectedCommandIndex];
            if (option && !option.disabled) {
              void runCommand(option.command);
            }
            return;
          }
          if (commandMenuOpen && e.key === "Escape") {
            e.preventDefault();
            setCommandMenuDismissed(true);
            return;
          }
          if (e.key === "Escape" && dictation.state !== "idle" && !e.repeat) {
            e.preventDefault();
            dictation.cancel();
            return;
          }
          if (e.key === "Escape" && workIsActive && !e.repeat) {
            e.preventDefault();
            void onInterrupt();
            return;
          }
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void sendDraft();
            return;
          }
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            const behavior = e.shiftKey
              ? followUpBehavior === "queue" ? "steer" : "queue"
              : followUpBehavior;
            void sendDraft(behavior);
          }
        }}
        placeholder={workIsActive ? "Ask for follow-up changes" : "Message Codex…"}
        rows={1}
        className="flex-1 min-h-9 max-h-[200px] resize-none overflow-y-auto border-0 bg-transparent px-0 py-2 text-base leading-5 shadow-none transition-[height] duration-90 ease-out focus-visible:ring-0 md:text-sm"
      />
      <Button
        type="button"
        onClick={() => {
          if (dictation.state === "recording") dictation.finish();
          else if (dictation.state === "connecting" || dictation.state === "transcribing") dictation.cancel();
          else void dictation.start();
        }}
        disabled={!canSend || isBusy}
        size="icon"
        variant="ghost"
        className={`h-9 w-9 shrink-0 self-end rounded-full ${dictation.state === "recording" ? "text-destructive" : "text-muted-foreground"}`}
        aria-label={dictation.state === "recording" ? "Stop dictation" : dictation.state === "connecting" || dictation.state === "transcribing" ? "Cancel dictation" : "Start dictation"}
        title={dictation.error ?? "Dictate on this device"}
      >
        {dictation.state === "connecting" || dictation.state === "transcribing" ? (
          <Loader2 size={14} className="animate-spin" />
        ) : dictation.state === "recording" ? (
          <Square size={13} fill="currentColor" />
        ) : (
          <Mic size={14} />
        )}
      </Button>
      {workIsActive && (
        <Button
          type="button"
          onClick={() => void onInterrupt()}
          disabled={!canSend || isBusy}
          size="icon"
          variant="ghost"
          className="h-9 w-9 shrink-0 self-end rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          aria-label="Pause thread"
          title="Pause thread"
        >
          <CirclePause size={14} />
        </Button>
      )}
      <Button
        type="button"
        onClick={() => {
          void sendDraft();
        }}
        disabled={disableSend}
        size="icon"
        className="h-9 w-9 shrink-0 self-end rounded-full bg-foreground text-background hover:bg-foreground/80 disabled:opacity-30"
        aria-label={workIsActive ? `${followUpBehavior === "queue" ? "Queue" : "Steer"} follow-up` : "Send message"}
      >
        {isBusy ? (
          <Loader2 size={13} className="animate-spin" />
        ) : (
          <ArrowUp size={13} />
        )}
      </Button>
      {workIsActive && (
        <div className="absolute -top-8 right-2 flex rounded-full border border-border bg-card p-0.5 text-[11px] shadow-sm">
          {(["queue", "steer"] as const).map((behavior) => (
            <button
              key={behavior}
              type="button"
              aria-pressed={followUpBehavior === behavior}
              onClick={() => setFollowUpBehavior(behavior)}
              className={`rounded-full px-2 py-1 capitalize ${followUpBehavior === behavior ? "bg-foreground text-background" : "text-muted-foreground"}`}
            >
              {behavior}
            </button>
          ))}
        </div>
      )}
      </div>
    </div>
  );
}
