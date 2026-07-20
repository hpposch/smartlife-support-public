# Drehbuch: Eigene Videos für das Help-Portal

Die Bold-BI-Doku bettet an 4 Stellen YouTube-Videos von Bold BI ein. Diese
werden beim Rebranding **immer entfernt** — statt ihrer erscheinen eigene,
selbst gehostete Aufnahmen, sobald sie vorliegen. Bis dahin wird der jeweilige
Videoblock (samt Hinweissatz) einfach ausgeblendet.

## Ablauf pro Video

1. Original-Video auf YouTube ansehen (Links unten) — es dient als Drehbuch.
2. Dieselben Schritte in der **eigenen white-labeled smartlife-BI-Instanz**
   mit einem Screenrecorder aufnehmen (z. B. [OBS Studio](https://obsproject.com/),
   kostenlos). Empfohlen: 1920×1080, 16:9, MP4 (H.264 + AAC) — das spielt in
   allen Browsern. Ton optional; Voiceover geht auch nachträglich per
   Text-to-Speech.
3. Datei unter dem angegebenen Namen in den Video-Ordner legen
   (Container-Mount: `-v C:\Development\help-videos:/import/help-videos:ro`).
4. Help-Portal neu bauen:
   `docker exec smartlife-support bash docker/build-help.sh /import/bold-bi-docs`

Auch `.webm` wird akzeptiert. Taucht in künftigen Doku-Ständen ein neues Video
auf, funktioniert automatisch `<youtube-id>.mp4` als Dateiname (die ID steht in
der Embed-URL); fürs Ausblenden ist nichts zu tun.

## Die 4 Videos

### 1. `creating-dashboard.mp4`

- **Seite:** `/getting-started/creating-dashboard/` („A Basic Walkthrough“)
- **Original:** https://www.youtube.com/watch?v=k6yeUz0NqQ4 (ab Minute 11:48)
- **Inhalt:** Marketing-Dashboard von Null aufbauen — Dashboard-Designer
  öffnen, Datenquelle verbinden und einrichten, Tabellen/Views konfigurieren,
  Daten transformieren, Widgets ins Design ziehen, Daten zuweisen
  (Measures/Dimensionen, Filter, Sortierung), Widget-Eigenschaften,
  Dashboard speichern und veröffentlichen.

### 2. `embedding-in-your-application.mp4`

- **Seite:** `/getting-started/embedding-in-your-application/`
- **Original:** https://www.youtube.com/watch?v=OXISapzYAj8 (ab Minute 6:19)
- **Inhalt:** Embedding per SDK — Wrapper in eine HTML-Seite einbinden,
  Dashboard per ID bzw. Pfad einbetten, Authorize-Server mit
  Nutzer-E-Mail/Name implementieren, Embed-Secret aus der Anwendung holen,
  kurzer Blick auf Multi-Tab-Dashboards.

### 3. `activate-ai-feature.mp4`

- **Seite:** `/artificial-intelligence-and-machine-learning/activate-ai-feature/`
- **Original:** https://www.youtube.com/watch?v=oeHEcOVd634
- **Inhalt:** KI-Funktion aktivieren — Unterschiede On-Premises (ab 10.1) vs.
  Cloud, Schritte zur Aktivierung im Admin-Bereich, eigenen
  OpenAI-/Azure-AI-Schlüssel hinterlegen.

### 4. `ai-copilot-getting-started.mp4`

- **Seite:** `/artificial-intelligence-and-machine-learning/ai-copilot-getting-started/`
- **Original:** https://www.youtube.com/watch?v=6KfzY3tpOG8
- **Inhalt:** AI-Copilot-Überblick — Copilot öffnen, Fragen stellen,
  automatisch generierte Abfragen, KI-Verbrauch überwachen, Sitzung neu
  starten, minimieren und später fortsetzen.

## Rechtlicher Hinweis

Die Original-Videos nicht herunterladen und umschneiden — sie zeigen die
Bold-BI-Marke in Bild und Ton, und die YouTube-Nutzungsbedingungen sowie die
OEM-Vereinbarung decken das voraussichtlich nicht ab. Eigene Aufnahmen der
eigenen (white-labeled) Instanz sind sauber und wirken zudem konsistent zum
restlichen Portal.
