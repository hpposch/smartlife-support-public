#!/usr/bin/env python3
"""Ersetzt das Bold-BI-Logo (oranges Fenster-Icon) in allen KB-Screenshots
durch ein eigenes Logo.

    pip install opencv-python-headless numpy pillow
    python3 scripts/replace-logo.py --assets data/kb-assets --logo mein-logo.png

Vorgehen: Orange-Farbmaske (RGB 255,72,0) -> zusammenhängende, annähernd
quadratische Blobs in Logo-Größe -> Verifikation gegen die Icon-Vorlage
per normalisierter Kreuzkorrelation -> Ersetzung durch das eigene Logo
(auf Hintergrundfarbe gelegt, proportional skaliert).

Originale der veränderten Dateien landen in <assets>-originale/ (Undo).
Der Lauf ist idempotent: bereits ersetzte Logos matchen nicht erneut.
"""
import argparse
import os
import shutil
import sys

import cv2
import numpy as np

# Icon-Vorlage: wird beim ersten Lauf aus einem bekannten Screenshot
# extrahiert und neben dem Skript zwischengespeichert.
TEMPLATE_SOURCE = "working-with-dashboards/images/mydashboard.png"
TEMPLATE_BBOX = (29, 14, 74, 59)  # x1, y1, x2, y2

MIN_SIZE = 14      # kleinste erwartete Logo-Kantenlänge (px)
MAX_SIZE = 160     # größte erwartete Logo-Kantenlänge (px)
NCC_THRESHOLD = 0.72
IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".gif"}


def orange_mask(bgr: np.ndarray) -> np.ndarray:
    """Maske für den Bold-BI-Orangeton (BGR ~ 0,72,255) mit Toleranz."""
    b, g, r = bgr[:, :, 0].astype(int), bgr[:, :, 1].astype(int), bgr[:, :, 2].astype(int)
    return ((r > 215) & (g > 30) & (g < 130) & (b < 90)).astype(np.uint8) * 255


def load_template(assets_dir: str) -> np.ndarray:
    cache = os.path.join(os.path.dirname(__file__), "assets", "boldbi-logo-template.png")
    if os.path.exists(cache):
        return cv2.imread(cache, cv2.IMREAD_COLOR)
    source = cv2.imread(os.path.join(assets_dir, TEMPLATE_SOURCE), cv2.IMREAD_COLOR)
    if source is None:
        sys.exit(f"Vorlagen-Screenshot fehlt: {TEMPLATE_SOURCE} (erst Import laufen lassen)")
    x1, y1, x2, y2 = TEMPLATE_BBOX
    template = source[y1:y2, x1:x2]
    os.makedirs(os.path.dirname(cache), exist_ok=True)
    cv2.imwrite(cache, template)
    return template


def candidate_boxes(bgr: np.ndarray) -> list[tuple[int, int, int, int]]:
    """Annähernd quadratische Orange-Blobs in plausibler Logo-Größe.

    Das weiße Kreuz zwischen den vier Icon-Quadranten skaliert mit der
    Logo-Größe — deshalb werden mehrere Dilatations-Radien probiert und die
    Ergebnisse überlappungsbereinigt zusammengeführt.
    """
    mask = orange_mask(bgr)
    if cv2.countNonZero(mask) < MIN_SIZE * MIN_SIZE // 3:
        return []

    boxes: list[tuple[int, int, int, int]] = []
    for radius in (4, 8, 16):
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (2 * radius + 1, 2 * radius + 1))
        merged = cv2.dilate(mask, kernel)
        count, _, stats, _ = cv2.connectedComponentsWithStats(merged)
        for i in range(1, count):
            dx, dy, dw, dh, _ = stats[i]
            # Dilatation zurückrechnen
            x, y = dx + radius, dy + radius
            w, h = dw - 2 * radius, dh - 2 * radius
            if not (MIN_SIZE <= w <= MAX_SIZE and MIN_SIZE <= h <= MAX_SIZE):
                continue
            if not (0.75 <= w / h <= 1.33):
                continue
            # Füllgrad des Icons (Quadranten mit Kreuz-Lücke) liegt bei ~45-90 %
            fill = cv2.countNonZero(mask[y : y + h, x : x + w]) / float(w * h)
            if not (0.35 <= fill <= 0.95):
                continue
            boxes.append((int(x), int(y), int(w), int(h)))

    # Überlappende Kandidaten aus verschiedenen Radien zusammenführen (größte Box gewinnt)
    boxes.sort(key=lambda b: b[2] * b[3], reverse=True)
    kept: list[tuple[int, int, int, int]] = []
    for box in boxes:
        x, y, w, h = box
        overlaps = False
        for kx, ky, kw, kh in kept:
            ix = max(0, min(x + w, kx + kw) - max(x, kx))
            iy = max(0, min(y + h, ky + kh) - max(y, ky))
            if ix * iy > 0.3 * w * h:
                overlaps = True
                break
        if not overlaps:
            kept.append(box)
    return kept


def verify(bgr: np.ndarray, box: tuple[int, int, int, int], template: np.ndarray) -> float:
    x, y, w, h = box
    crop = bgr[y : y + h, x : x + w]
    resized = cv2.resize(crop, (template.shape[1], template.shape[0]), interpolation=cv2.INTER_AREA)
    result = cv2.matchTemplate(resized, template, cv2.TM_CCOEFF_NORMED)
    return float(result[0][0])


def background_color(bgr: np.ndarray, box: tuple[int, int, int, int]) -> tuple[int, int, int]:
    """Hintergrundfarbe: Median des Rahmenrings um die Box, ohne warme
    (orange/rötliche) Pixel — der Icon-Glow darf die Füllung nicht einfärben."""
    x, y, w, h = box
    ring_out = max(6, round(w * 0.35))
    ring_in = max(3, round(w * 0.25))
    y1, y2 = max(0, y - ring_out), min(bgr.shape[0], y + h + ring_out)
    x1, x2 = max(0, x - ring_out), min(bgr.shape[1], x + w + ring_out)
    region = bgr[y1:y2, x1:x2].copy()
    # Innenbereich (Box + Glow-Zone) maskieren
    iy1, iy2 = max(0, (y - ring_in) - y1), min(region.shape[0], (y + h + ring_in) - y1)
    ix1, ix2 = max(0, (x - ring_in) - x1), min(region.shape[1], (x + w + ring_in) - x1)
    inner_mask = np.zeros(region.shape[:2], dtype=bool)
    inner_mask[iy1:iy2, ix1:ix2] = True
    pixels = region[~inner_mask].reshape(-1, 3)
    if len(pixels) > 0:
        b, g, r = pixels[:, 0].astype(int), pixels[:, 1].astype(int), pixels[:, 2].astype(int)
        cool = (r <= g + 30) | (r <= b + 30)
        if cool.sum() > 10:
            pixels = pixels[cool]
    if len(pixels) == 0:
        return (255, 255, 255)
    return tuple(int(v) for v in np.median(pixels, axis=0))


def paste_logo(bgr: np.ndarray, box: tuple[int, int, int, int], logo_rgba: np.ndarray) -> None:
    x, y, w, h = box
    bg = background_color(bgr, box)
    # Füllfläche großzügig vergrößern: das Icon hat weiche Glow-/Antialiasing-
    # Ränder deutlich außerhalb der strengen Farbmaske
    pad = max(4, round(w * 0.3))
    fy1, fy2 = max(0, y - pad), min(bgr.shape[0], y + h + pad)
    fx1, fx2 = max(0, x - pad), min(bgr.shape[1], x + w + pad)
    bgr[fy1:fy2, fx1:fx2] = bg
    # Logo proportional in die Box einpassen (zentriert)
    lh, lw = logo_rgba.shape[:2]
    scale = min(w / lw, h / lh)
    nw, nh = max(1, int(lw * scale)), max(1, int(lh * scale))
    logo = cv2.resize(logo_rgba, (nw, nh), interpolation=cv2.INTER_AREA)
    ox, oy = x + (w - nw) // 2, y + (h - nh) // 2
    if logo.shape[2] == 4:
        alpha = logo[:, :, 3:4].astype(float) / 255.0
        region = bgr[oy : oy + nh, ox : ox + nw].astype(float)
        bgr[oy : oy + nh, ox : ox + nw] = (
            logo[:, :, :3].astype(float) * alpha + region * (1 - alpha)
        ).astype(np.uint8)
    else:
        bgr[oy : oy + nh, ox : ox + nw] = logo[:, :, :3]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--assets", default="data/kb-assets")
    parser.add_argument("--logo", required=True, help="Eigenes Logo (PNG, gern mit Transparenz)")
    parser.add_argument("--limit", type=int, default=0, help="Nur die ersten N Bilder (Testlauf)")
    parser.add_argument("--dry-run", action="store_true", help="Nur zählen, nichts schreiben")
    parser.add_argument("--review-dir", default="", help="Ersetzte Ausschnitte zusätzlich hier ablegen")
    args = parser.parse_args()

    logo = cv2.imread(args.logo, cv2.IMREAD_UNCHANGED)
    if logo is None:
        sys.exit(f"Logo nicht lesbar: {args.logo}")
    if logo.shape[2] == 3:
        logo = cv2.cvtColor(logo, cv2.COLOR_BGR2BGRA)
    template = load_template(args.assets)
    backup_dir = args.assets.rstrip("/") + "-originale"

    files = []
    for root, _, names in os.walk(args.assets):
        for name in names:
            if os.path.splitext(name)[1].lower() in IMAGE_EXTS:
                files.append(os.path.join(root, name))
    files.sort()
    if args.limit:
        files = files[: args.limit]

    images_changed = 0
    logos_replaced = 0
    for index, file in enumerate(files):
        if index and index % 1000 == 0:
            print(f"  … {index}/{len(files)} Bilder, bisher {logos_replaced} Logos ersetzt")
        bgr = cv2.imread(file, cv2.IMREAD_COLOR)
        if bgr is None:
            continue
        hits = [b for b in candidate_boxes(bgr) if verify(bgr, b, template) >= NCC_THRESHOLD]
        if not hits:
            continue
        if not args.dry_run:
            backup = os.path.join(backup_dir, os.path.relpath(file, args.assets))
            os.makedirs(os.path.dirname(backup), exist_ok=True)
            if not os.path.exists(backup):
                shutil.copy2(file, backup)
            for box in hits:
                if args.review_dir:
                    x, y, w, h = box
                    os.makedirs(args.review_dir, exist_ok=True)
                    cv2.imwrite(
                        os.path.join(args.review_dir, f"{index}_{x}_{y}.png"),
                        bgr[max(0, y - 4) : y + h + 4, max(0, x - 4) : x + w + 4],
                    )
                paste_logo(bgr, box, logo)
            cv2.imwrite(file, bgr)
        images_changed += 1
        logos_replaced += len(hits)

    print(
        f"Fertig: {logos_replaced} Logo(s) in {images_changed} von {len(files)} Bildern "
        f"{'gefunden (Testlauf)' if args.dry_run else 'ersetzt'}; Originale unter {backup_dir}/"
    )


if __name__ == "__main__":
    main()
