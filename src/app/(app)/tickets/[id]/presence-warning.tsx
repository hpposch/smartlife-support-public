"use client";

// Kollisionswarnung: meldet die eigene Präsenz am Ticket und zeigt an,
// wenn Kolleginnen/Kollegen dasselbe Ticket gerade geöffnet haben.
import { useEffect, useState } from "react";

export function PresenceWarning({ ticketId }: { ticketId: string }) {
  const [others, setOthers] = useState<string[]>([]);

  useEffect(() => {
    let active = true;
    async function beat() {
      try {
        const response = await fetch("/api/presence", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ticketId }),
        });
        const json = await response.json();
        if (active) setOthers(json.data?.others ?? []);
      } catch {
        // Präsenz ist Komfort — Fehler still ignorieren
      }
    }
    beat();
    const interval = setInterval(beat, 25_000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [ticketId]);

  if (others.length === 0) return null;
  return (
    <p className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
      ⚠ {others.join(", ")} {others.length === 1 ? "arbeitet" : "arbeiten"} gerade auch an diesem
      Ticket.
    </p>
  );
}
