"use client";

import { useEffect, useState } from "react";
import { ACCEPT_ATTR } from "@/lib/image";

const SAMPLES = [
  { name: "drivers-license.jpg", label: "Driver's license", src: "/samples/drivers-license.jpg" },
  { name: "receipt.jpg", label: "Receipt", src: "/samples/receipt.jpg" },
];

interface Props {
  onFile: (file: Blob, name: string) => void;
  disabled?: boolean;
}

export function DocumentUpload({ onFile, disabled }: Props) {
  const [dragging, setDragging] = useState(false);

  // Paste a screenshot straight from the clipboard.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const file = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith("image/"));
      if (file && !disabled) onFile(file, file.name || "pasted-image");
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [onFile, disabled]);

  const loadSample = async (sample: (typeof SAMPLES)[number]) => {
    const blob = await (await fetch(sample.src)).blob();
    onFile(blob, sample.name);
  };

  return (
    <div className="flex flex-col gap-4">
      <label
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const file = e.dataTransfer.files[0];
          if (file && !disabled) onFile(file, file.name);
        }}
        className={`group flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-6 py-16 text-center transition-colors focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/30 ${
          dragging ? "border-accent bg-accent-soft" : "border-border bg-surface hover:border-accent/60"
        } ${disabled ? "pointer-events-none opacity-60" : ""}`}
      >
        <svg viewBox="0 0 24 24" className="size-10 text-muted group-hover:text-accent" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
          <path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8l-5-5z" />
          <path d="M14 3v5h5M12 18v-6M9 15l3-3 3 3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <div>
          <p className="font-medium">Drop an ID, passport, invoice, or receipt</p>
          <p className="mt-1 text-sm text-muted">or click to browse · paste from clipboard · PNG, JPEG, WebP</p>
        </div>
        <input
          type="file"
          accept={ACCEPT_ATTR}
          className="sr-only"
          disabled={disabled}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onFile(file, file.name);
            e.target.value = "";
          }}
        />
      </label>

      <div className="flex flex-wrap items-center justify-center gap-2 text-sm">
        <span className="text-muted">Try a sample:</span>
        {SAMPLES.map((s) => (
          <button
            key={s.name}
            type="button"
            disabled={disabled}
            onClick={() => loadSample(s)}
            className="rounded-full border border-border bg-surface px-3 py-1 hover:border-accent hover:text-accent disabled:opacity-50"
          >
            {s.label}
          </button>
        ))}
      </div>
    </div>
  );
}
