import ImagePlus from 'lucide-react/icons/image-plus';
import { useRef, useState } from 'react';

export interface UploadDropProps {
  /** The trigger's prompt config (falls back to the catalog default). */
  prompt?: string;
  /** Fired with the dropped or picked photo; the parent posts it. */
  onUpload: (file: File) => void;
  disabled?: boolean;
}

/**
 * The photo drop zone for trigger.upload workflows in runtime mode: drag a
 * photo anywhere onto it, click it, or Enter/Space it to open the picker.
 * Sends the FIRST file only — one photo starts one run.
 */
export default function UploadDrop({
  prompt = 'Drop a photo here',
  onUpload,
  disabled = false,
}: UploadDropProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const send = (list: FileList | File[] | null | undefined): void => {
    const file = list?.[0];
    if (!disabled && file) onUpload(file);
  };

  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-label={prompt}
      aria-disabled={disabled}
      onClick={() => {
        if (!disabled) inputRef.current?.click();
      }}
      onKeyDown={(e) => {
        if (!disabled && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          inputRef.current?.click();
        }
      }}
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        send(e.dataTransfer?.files);
      }}
      className={`flex flex-col items-center gap-2 rounded-[var(--radius)] border-2 border-dashed px-6 py-10 text-center ${
        dragging ? 'border-primary bg-accent' : 'border-border bg-card'
      } ${disabled ? 'opacity-60' : 'cursor-pointer'}`}
    >
      <ImagePlus className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
      <p className="text-lg font-medium">{prompt}</p>
      <p className="text-base text-muted-foreground">or choose a photo from your device</p>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        aria-hidden="true"
        tabIndex={-1}
        className="hidden"
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => {
          send(e.target.files);
          // Reset so picking the SAME photo twice still fires onChange.
          e.target.value = '';
        }}
      />
    </div>
  );
}
