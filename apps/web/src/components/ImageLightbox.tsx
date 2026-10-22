import { X } from "lucide-react";

interface ImageLightboxProps {
  src: string;
  onClose: () => void;
}

export function ImageLightbox({ src, onClose }: ImageLightboxProps): React.JSX.Element {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Image preview"
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/85 p-4"
      onClick={onClose}
    >
      <button
        type="button"
        aria-label="Close image preview"
        className="absolute right-4 top-4 rounded-full bg-black/50 p-2 text-white"
        onClick={onClose}
      >
        <X size={18} />
      </button>
      <img
        src={src}
        alt="Expanded conversation image"
        className="max-h-full max-w-full rounded-xl object-contain"
        onClick={(event) => event.stopPropagation()}
      />
    </div>
  );
}
