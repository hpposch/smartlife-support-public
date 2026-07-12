"use client";

// Drag-&-Drop-Upload-Zone („Dateien hier ablegen oder durchsuchen“) —
// hält die Auswahl in einem echten <input type="file">, damit das Formular
// ohne weiteres JavaScript abgesendet werden kann.
import { useRef, useState } from "react";

export function FileDrop({
  name,
  maxFiles = 5,
  maxMb = 20,
}: {
  name: string;
  maxFiles?: number;
  maxMb?: number;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);

  function apply(next: File[]) {
    const limited = next
      .filter((file) => file.size <= maxMb * 1024 * 1024)
      .slice(0, maxFiles);
    const transfer = new DataTransfer();
    for (const file of limited) transfer.items.add(file);
    if (inputRef.current) inputRef.current.files = transfer.files;
    setFiles(limited);
  }

  return (
    <div>
      <label
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          apply([...files, ...Array.from(e.dataTransfer.files)]);
        }}
        className={`flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed px-4 py-5 text-sm transition ${
          dragging ? "border-blue-400 bg-blue-50 text-blue-700" : "border-slate-300 text-slate-500 hover:border-slate-400"
        }`}
      >
        <span aria-hidden>📎</span>
        <span>
          Dateien hier ablegen oder <span className="text-blue-700 underline">durchsuchen</span>{" "}
          <span className="text-xs text-slate-400">
            (max. {maxFiles} Dateien à {maxMb} MB)
          </span>
        </span>
        <input
          ref={inputRef}
          type="file"
          name={name}
          multiple
          className="hidden"
          onChange={(e) => apply([...files, ...Array.from(e.target.files ?? [])])}
        />
      </label>
      {files.length > 0 && (
        <ul className="mt-2 space-y-1">
          {files.map((file, index) => (
            <li
              key={`${file.name}-${index}`}
              className="flex items-center justify-between rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-600"
            >
              <span className="truncate">
                {file.name} <span className="text-slate-400">({Math.ceil(file.size / 1024)} KB)</span>
              </span>
              <button
                type="button"
                onClick={() => apply(files.filter((_, i) => i !== index))}
                className="ml-2 text-slate-400 hover:text-red-600"
                title="Entfernen"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
