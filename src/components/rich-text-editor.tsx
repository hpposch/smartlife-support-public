"use client";

// Leichter Rich-Text-Editor (contenteditable) für Portal-Formulare —
// angelehnt an den BoldDesk-Editor. Der HTML-Inhalt wandert über ein
// verstecktes Feld ins Formular und wird SERVERSEITIG sanitisiert.
import { useRef } from "react";

const BUTTONS: { command: string; label: string; title: string; className?: string }[] = [
  { command: "bold", label: "B", title: "Fett", className: "font-bold" },
  { command: "italic", label: "I", title: "Kursiv", className: "italic" },
  { command: "underline", label: "U", title: "Unterstrichen", className: "underline" },
  { command: "strikeThrough", label: "S", title: "Durchgestrichen", className: "line-through" },
  { command: "insertUnorderedList", label: "•≡", title: "Aufzählung" },
  { command: "insertOrderedList", label: "1.", title: "Nummerierte Liste" },
  { command: "quote", label: "„“", title: "Zitat" },
  { command: "link", label: "🔗", title: "Link einfügen" },
  { command: "removeFormat", label: "⌫", title: "Formatierung entfernen" },
];

export function RichTextEditor({
  name,
  placeholder,
}: {
  name: string;
  placeholder?: string;
}) {
  const editorRef = useRef<HTMLDivElement>(null);
  const hiddenRef = useRef<HTMLInputElement>(null);

  function sync() {
    if (hiddenRef.current && editorRef.current) {
      hiddenRef.current.value = editorRef.current.innerHTML;
    }
  }

  function run(command: string) {
    editorRef.current?.focus();
    if (command === "link") {
      const url = window.prompt("Link-Adresse (https://…):");
      if (url && /^https?:\/\//.test(url)) document.execCommand("createLink", false, url);
    } else if (command === "quote") {
      document.execCommand("formatBlock", false, "blockquote");
    } else {
      document.execCommand(command, false);
    }
    sync();
  }

  return (
    <div className="rounded-md border border-slate-300 bg-white focus-within:border-blue-400">
      <div className="flex flex-wrap gap-0.5 border-b border-slate-200 px-2 py-1">
        {BUTTONS.map((button) => (
          <button
            key={button.command}
            type="button"
            title={button.title}
            onMouseDown={(e) => {
              e.preventDefault(); // Fokus im Editor lassen
              run(button.command);
            }}
            className={`rounded px-2 py-1 text-sm text-slate-600 hover:bg-slate-100 ${button.className ?? ""}`}
          >
            {button.label}
          </button>
        ))}
      </div>
      <div
        ref={editorRef}
        contentEditable
        onInput={sync}
        onBlur={sync}
        data-placeholder={placeholder ?? ""}
        className="rich-editor min-h-[10rem] max-w-none px-3 py-2 text-sm outline-none"
      />
      <input type="hidden" name={name} ref={hiddenRef} />
    </div>
  );
}
