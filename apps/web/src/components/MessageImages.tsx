import { useState } from "react";
import { ImageLightbox } from "./ImageLightbox";

export interface MessageImage {
  src: string;
}

interface MessageImagesProps {
  images: MessageImage[];
}

export function MessageImages({ images }: MessageImagesProps): React.JSX.Element | null {
  const [unavailableIndexes, setUnavailableIndexes] = useState<Set<number>>(new Set());
  const [selectedImage, setSelectedImage] = useState<string | null>(null);

  if (images.length === 0) {
    return null;
  }

  return (
    <>
      <div
        className={`mt-3 grid w-full max-w-xs items-start justify-items-start gap-2 ${images.length === 1 ? "grid-cols-1" : "grid-cols-2"}`}
      >
        {images.map((image, index) =>
          unavailableIndexes.has(index) ? (
            <div
              key={image.src}
              className="flex max-h-56 aspect-[4/3] items-center justify-center rounded-xl border border-border bg-muted/40 px-3 text-center text-xs text-muted-foreground"
            >
              Image unavailable
            </div>
          ) : (
            <button
              key={image.src}
              type="button"
              className="flex w-fit max-w-full items-center justify-center overflow-hidden rounded-xl border border-border bg-black/20"
              onClick={() => setSelectedImage(image.src)}
            >
              <img
                src={image.src}
                alt={`Conversation image ${String(index + 1)}`}
                className="max-h-56 h-auto w-auto max-w-full object-contain"
                loading="lazy"
                onError={() =>
                  setUnavailableIndexes((current) => new Set(current).add(index))
                }
              />
            </button>
          )
        )}
      </div>
      {selectedImage && (
        <ImageLightbox src={selectedImage} onClose={() => setSelectedImage(null)} />
      )}
    </>
  );
}
