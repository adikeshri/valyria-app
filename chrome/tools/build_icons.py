#!/usr/bin/env python3
"""
Build the Valyria workbench icon assets (docs/UX-DIFFERENTIATION.md, lever A).

Outputs, all committed to chrome/dist/ so CI and bootstrap never need fontTools:

  dist/valyria-icons.woff          the product-icon font (solid geometric family)
  dist/valyria-product-icons.json  product icon theme — codicon id -> glyph
  dist/valyria-file-icons.json     file icon theme = stock Seti (vendored, MIT) +
  dist/seti.woff                     Valyria folder icons injected; file-type
  dist/file-icons/folder*.svg        icons are left exactly as Seti draws them

Product glyphs are built from primitives (rect / polygon / disc / ring) in font
units — no hand-authored SVG, so the family stays consistent and reproducible.
Everything is polygons (discs are 32-gons): TrueType quadratic-only, zero curve
math, and knockouts simply wind opposite to their container.

Run:  python3 chrome/tools/build_icons.py
Deps: fontTools  (pip install fonttools)
"""
from __future__ import annotations

import json
import math
import os
from typing import Callable

from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen

HERE = os.path.dirname(os.path.abspath(__file__))
DIST = os.path.normpath(os.path.join(HERE, "..", "dist"))

UPM = 300          # matches @vscode/codicons: unitsPerEm 300, ascent 300, descent 0
BOX = 300
PAD = 30           # glyph lives in [PAD, BOX-PAD]
INNER = BOX - 2 * PAD

# ----------------------------------------------------------------------------
# primitive pens — everything is a closed polygon, wound counter-clockwise for
# solid contours and clockwise for knockouts.
# ----------------------------------------------------------------------------

Pen = TTGlyphPen


def _signed_area(pts: list[tuple[float, float]]) -> float:
    s = 0.0
    for i in range(len(pts)):
        x1, y1 = pts[i]
        x2, y2 = pts[(i + 1) % len(pts)]
        s += x1 * y2 - x2 * y1
    return s / 2.0


def poly(pen: Pen, pts: list[tuple[float, float]], hole: bool = False) -> None:
    """Emit a closed contour. Winding is *enforced* from the requested role, not
    the point order: solid contours end up counter-clockwise (positive area),
    knockouts clockwise — so a hole always subtracts under nonzero fill."""
    area = _signed_area(pts)
    want_positive = not hole
    if (area > 0) != want_positive:
        pts = list(reversed(pts))
    pen.moveTo(pts[0])
    for p in pts[1:]:
        pen.lineTo(p)
    pen.closePath()


def rect(pen: Pen, x: float, y: float, w: float, h: float, hole: bool = False) -> None:
    poly(pen, [(x, y), (x + w, y), (x + w, y + h), (x, y + h)], hole)


def disc(pen: Pen, cx: float, cy: float, r: float, n: int = 32, hole: bool = False) -> None:
    pts = [
        (cx + r * math.cos(2 * math.pi * i / n), cy + r * math.sin(2 * math.pi * i / n))
        for i in range(n)
    ]
    poly(pen, pts, hole)


def ring(pen: Pen, cx: float, cy: float, r_out: float, r_in: float, n: int = 32) -> None:
    disc(pen, cx, cy, r_out, n)
    disc(pen, cx, cy, r_in, n, hole=True)


def seg(pen: Pen, x1: float, y1: float, x2: float, y2: float, w: float) -> None:
    """A thick line segment as a rotated rectangle (butt caps)."""
    dx, dy = x2 - x1, y2 - y1
    ln = math.hypot(dx, dy) or 1.0
    nx, ny = -dy / ln * w / 2, dx / ln * w / 2
    poly(pen, [(x1 + nx, y1 + ny), (x2 + nx, y2 + ny), (x2 - nx, y2 - ny), (x1 - nx, y1 - ny)])


def chevron(pen: Pen, cx: float, cy: float, size: float, w: float, direction: str) -> None:
    """A solid `>` / `<` / `^` / `v` made of two thick segments meeting at a point."""
    s = size / 2
    tip = {
        "right": (cx + s, cy), "left": (cx - s, cy),
        "up": (cx, cy + s), "down": (cx, cy - s),
    }[direction]
    if direction in ("right", "left"):
        a, b = (tip[0] - (s if direction == "right" else -s), cy + s), (tip[0] - (s if direction == "right" else -s), cy - s)
    else:
        a, b = (cx - s, tip[1] - (s if direction == "up" else -s)), (cx + s, tip[1] - (s if direction == "up" else -s))
    seg(pen, a[0], a[1], tip[0], tip[1], w)
    seg(pen, b[0], b[1], tip[0], tip[1], w)


def arrow(pen: Pen, direction: str) -> None:
    c = BOX / 2
    L = INNER / 2
    w = 46
    hd = 92  # head half-width / depth
    if direction == "right":
        seg(pen, c - L, c, c + L - hd + 10, c, w)
        poly(pen, [(c + L, c), (c + L - hd, c + hd), (c + L - hd, c - hd)])
    elif direction == "left":
        seg(pen, c + L, c, c - L + hd - 10, c, w)
        poly(pen, [(c - L, c), (c - L + hd, c - hd), (c - L + hd, c + hd)])
    elif direction == "up":
        seg(pen, c, c - L, c, c + L - hd + 10, w)
        poly(pen, [(c, c + L), (c - hd, c + L - hd), (c + hd, c + L - hd)])
    else:
        seg(pen, c, c + L, c, c - L + hd - 10, w)
        poly(pen, [(c, c - L), (c + hd, c - L + hd), (c - hd, c - L + hd)])


# ----------------------------------------------------------------------------
# the glyph library — codicon id -> builder. Kept to the workbench "tells":
# tree twisties, window / tab chrome, common actions, status glyphs, view icons.
# ----------------------------------------------------------------------------

def _plus(pen: Pen) -> None:
    c = BOX / 2
    w = 44
    rect(pen, c - w / 2, PAD, w, INNER)
    rect(pen, PAD, c - w / 2, INNER, w)


def _dash(pen: Pen) -> None:
    c = BOX / 2
    rect(pen, PAD, c - 22, INNER, 44)


def _close(pen: Pen) -> None:
    a, b = PAD + 6, BOX - PAD - 6
    seg(pen, a, a, b, b, 44)
    seg(pen, a, b, b, a, 44)


def _check(pen: Pen) -> None:
    seg(pen, PAD + 4, BOX / 2 - 6, BOX / 2 - 24, PAD + 20, 46)
    seg(pen, BOX / 2 - 24, PAD + 20, BOX - PAD, BOX - PAD - 6, 46)


def _dots(pen: Pen, vertical: bool) -> None:
    c = BOX / 2
    for k in (-1, 0, 1):
        if vertical:
            disc(pen, c, c + k * 78, 26)
        else:
            disc(pen, c + k * 78, c, 26)


def _gear(pen: Pen) -> None:
    c = BOX / 2
    r_out, r_in = INNER / 2, INNER / 2 - 34
    teeth = 8
    for i in range(teeth):
        ang = 2 * math.pi * i / teeth
        seg(pen, c + r_in * math.cos(ang), c + r_in * math.sin(ang),
            c + (r_out + 14) * math.cos(ang), c + (r_out + 14) * math.sin(ang), 40)
    ring(pen, c, c, r_in + 8, 34)


def _bell(pen: Pen, dot: bool) -> None:
    c = BOX / 2
    top, bot = BOX - PAD - 20, PAD + 44
    poly(pen, [
        (c - 96, bot), (c + 96, bot),
        (c + 78, bot + 30), (c + 62, top - 26),
        (c, top), (c - 62, top - 26), (c - 78, bot + 30),
    ])
    rect(pen, c - 30, bot - 26, 60, 26)  # clapper
    if dot:
        disc(pen, c + 84, top - 6, 34)


def _search(pen: Pen) -> None:
    cx, cy = BOX / 2 - 22, BOX / 2 + 24
    r = 78
    ring(pen, cx, cy, r, r - 40)
    seg(pen, cx + r * 0.7, cy - r * 0.7, BOX - PAD, PAD, 44)


def _refresh(pen: Pen) -> None:
    c = BOX / 2
    r_out, r_in = INNER / 2, INNER / 2 - 42
    n = 32
    start, end = math.radians(60), math.radians(340)
    outer = [(c + r_out * math.cos(start + (end - start) * i / n), c + r_out * math.sin(start + (end - start) * i / n)) for i in range(n + 1)]
    inner = [(c + r_in * math.cos(end - (end - start) * i / n), c + r_in * math.sin(end - (end - start) * i / n)) for i in range(n + 1)]
    poly(pen, outer + inner)
    a = start
    poly(pen, [
        (c + (r_out + 34) * math.cos(a), c + (r_out + 34) * math.sin(a)),
        (c + (r_in - 34) * math.cos(a), c + (r_in - 34) * math.sin(a)),
        (c + (r_out) * math.cos(a - 0.5), c + (r_out) * math.sin(a - 0.5)),
    ])


def _triangle_warn(pen: Pen) -> None:
    c = BOX / 2
    poly(pen, [(c, BOX - PAD), (BOX - PAD + 6, PAD + 8), (PAD - 6, PAD + 8)])
    rect(pen, c - 20, PAD + 70, 40, 96, hole=True)   # exclamation stem knockout
    rect(pen, c - 20, PAD + 30, 40, 30, hole=True)   # exclamation dot knockout


def _error_x(pen: Pen) -> None:
    c = BOX / 2
    disc(pen, c, c, INNER / 2)
    # knockout X: two rotated rects wound clockwise
    for (x1, y1, x2, y2) in [(c - 46, c - 46, c + 46, c + 46), (c - 46, c + 46, c + 46, c - 46)]:
        dx, dy = x2 - x1, y2 - y1
        ln = math.hypot(dx, dy)
        nx, ny = -dy / ln * 19, dx / ln * 19
        poly(pen, [(x1 + nx, y1 + ny), (x2 + nx, y2 + ny), (x2 - nx, y2 - ny), (x1 - nx, y1 - ny)], hole=True)


def _info(pen: Pen) -> None:
    c = BOX / 2
    disc(pen, c, c, INNER / 2)
    disc(pen, c, BOX - PAD - 40, 24, hole=True)          # dot
    rect(pen, c - 20, PAD + 44, 40, 108, hole=True)      # stem


def _circle_filled(pen: Pen) -> None:
    disc(pen, BOX / 2, BOX / 2, INNER / 2 - 6)


def _circle_outline(pen: Pen) -> None:
    ring(pen, BOX / 2, BOX / 2, INNER / 2 - 6, INNER / 2 - 44)


def _loading(pen: Pen) -> None:
    c = BOX / 2
    r_out, r_in = INNER / 2 - 6, INNER / 2 - 44
    n = 26
    start, end = math.radians(90), math.radians(360)
    outer = [(c + r_out * math.cos(start + (end - start) * i / n), c + r_out * math.sin(start + (end - start) * i / n)) for i in range(n + 1)]
    inner = [(c + r_in * math.cos(end - (end - start) * i / n), c + r_in * math.sin(end - (end - start) * i / n)) for i in range(n + 1)]
    poly(pen, outer + inner)


def _play(pen: Pen) -> None:
    poly(pen, [(PAD + 20, PAD), (PAD + 20, BOX - PAD), (BOX - PAD, BOX / 2)])


def _pause(pen: Pen) -> None:
    rect(pen, PAD + 30, PAD, 60, INNER)
    rect(pen, BOX - PAD - 90, PAD, 60, INNER)


def _stop(pen: Pen) -> None:
    rect(pen, PAD + 16, PAD + 16, INNER - 32, INNER - 32)


def _frame(pen: Pen, div: str) -> None:
    """Rounded-ish rect frame with a divider — split / layout icons."""
    ring_pts_out = [(PAD, PAD), (BOX - PAD, PAD), (BOX - PAD, BOX - PAD), (PAD, BOX - PAD)]
    poly(pen, ring_pts_out)
    poly(pen, [(PAD + 30, PAD + 30), (BOX - PAD - 30, PAD + 30), (BOX - PAD - 30, BOX - PAD - 30), (PAD + 30, BOX - PAD - 30)], hole=True)
    if div == "v":
        rect(pen, BOX / 2 - 16, PAD, 32, INNER)
    elif div == "h":
        rect(pen, PAD, BOX / 2 - 16, INNER, 32)
    elif div == "sidebar":
        rect(pen, PAD, PAD, 96, INNER)
    elif div == "panel":
        rect(pen, PAD, BOX - PAD - 96, INNER, 96)


def _page(pen: Pen, fold: bool = True) -> None:
    x0, x1 = PAD + 34, BOX - PAD - 34
    y0, y1 = PAD, BOX - PAD
    fc = 78
    if fold:
        poly(pen, [(x0, y0), (x1, y0), (x1, y1 - fc), (x1 - fc, y1), (x0, y1)])
        poly(pen, [(x1 - fc, y1), (x1 - fc, y1 - fc), (x1, y1 - fc)], hole=True)
    else:
        rect(pen, x0, y0, x1 - x0, y1 - y0)


def _files(pen: Pen) -> None:
    rect(pen, PAD + 60, PAD, 150, 190)
    rect(pen, PAD, PAD + 60, 150, 190)
    rect(pen, PAD + 20, PAD + 80, 110, 150, hole=True)


def _scm(pen: Pen) -> None:
    disc(pen, PAD + 30, PAD + 30, 34)
    disc(pen, PAD + 30, BOX - PAD - 30, 34)
    disc(pen, BOX - PAD - 30, BOX / 2, 34)
    seg(pen, PAD + 30, PAD + 30, PAD + 30, BOX - PAD - 30, 26)
    seg(pen, PAD + 30, BOX / 2, BOX - PAD - 30, BOX / 2, 26)


def _extensions(pen: Pen) -> None:
    g = 22
    s = (INNER - g) / 2
    rect(pen, PAD, PAD, s, s)
    rect(pen, PAD + s + g, PAD, s, s)
    rect(pen, PAD, PAD + s + g, s, s)
    rect(pen, PAD + s + g + 26, PAD + s + g + 26, s, s)


def _terminal(pen: Pen) -> None:
    poly(pen, [(PAD, PAD), (BOX - PAD, PAD), (BOX - PAD, BOX - PAD), (PAD, BOX - PAD)])
    poly(pen, [(PAD + 26, PAD + 26), (BOX - PAD - 26, PAD + 26), (BOX - PAD - 26, BOX - PAD - 26), (PAD + 26, BOX - PAD - 26)], hole=True)
    chevron(pen, PAD + 96, BOX / 2 + 6, 70, 26, "right")
    rect(pen, BOX / 2 + 4, PAD + 60, 84, 26)


def _account(pen: Pen) -> None:
    c = BOX / 2
    disc(pen, c, BOX - PAD - 58, 58)
    poly(pen, [(PAD + 20, PAD), (BOX - PAD - 20, PAD), (BOX - PAD - 44, PAD + 96), (PAD + 44, PAD + 96)])


def _lightbulb(pen: Pen) -> None:
    c = BOX / 2
    disc(pen, c, BOX / 2 + 20, INNER / 2 - 26)
    rect(pen, c - 36, PAD, 72, 54)


def _funnel(pen: Pen) -> None:
    poly(pen, [(PAD, BOX - PAD), (BOX - PAD, BOX - PAD), (BOX / 2 + 34, BOX / 2), (BOX / 2 + 34, PAD + 40), (BOX / 2 - 34, PAD + 40), (BOX / 2 - 34, BOX / 2)])


def _save(pen: Pen) -> None:
    poly(pen, [(PAD, PAD), (BOX - PAD - 54, PAD), (BOX - PAD, PAD + 54), (BOX - PAD, BOX - PAD), (PAD, BOX - PAD)])
    poly(pen, [(PAD + 40, PAD + 30), (PAD + 40, PAD + 30), (BOX - PAD - 80, PAD + 30), (BOX - PAD - 80, PAD + 96), (PAD + 40, PAD + 96)], hole=True)
    rect(pen, PAD + 60, BOX - PAD - 90, INNER - 120, 90, hole=True)


def _go_to_file(pen: Pen) -> None:
    _page(pen, fold=True)
    seg(pen, PAD + 46, BOX / 2, BOX / 2 + 30, BOX / 2, 34)
    poly(pen, [(BOX / 2 + 66, BOX / 2), (BOX / 2 + 20, BOX / 2 + 44), (BOX / 2 + 20, BOX / 2 - 44)])


GLYPHS: dict[str, Callable[[Pen], None]] = {
    "chevron-right": lambda p: chevron(p, BOX / 2 - 10, BOX / 2, INNER, 44, "right"),
    "chevron-left": lambda p: chevron(p, BOX / 2 + 10, BOX / 2, INNER, 44, "left"),
    "chevron-up": lambda p: chevron(p, BOX / 2, BOX / 2 - 10, INNER, 44, "up"),
    "chevron-down": lambda p: chevron(p, BOX / 2, BOX / 2 + 10, INNER, 44, "down"),
    "arrow-right": lambda p: arrow(p, "right"),
    "arrow-left": lambda p: arrow(p, "left"),
    "arrow-up": lambda p: arrow(p, "up"),
    "arrow-down": lambda p: arrow(p, "down"),
    "add": _plus,
    "remove": _dash,
    "close": _close,
    "chrome-close": _close,
    "close-all": _close,
    "clear-all": _dash,
    "check": _check,
    "more": lambda p: _dots(p, vertical=False),
    "ellipsis": lambda p: _dots(p, vertical=False),
    "kebab-vertical": lambda p: _dots(p, vertical=True),
    "gear": _gear,
    "settings-gear": _gear,
    "settings": _gear,
    "bell": lambda p: _bell(p, dot=False),
    "bell-dot": lambda p: _bell(p, dot=True),
    "search": _search,
    "search-stop": _search,
    "refresh": _refresh,
    "sync": _refresh,
    "warning": _triangle_warn,
    "alert": _triangle_warn,
    "error": _error_x,
    "info": _info,
    "circle-filled": _circle_filled,
    "pass-filled": _circle_filled,
    "circle-outline": _circle_outline,
    "circle-large-outline": _circle_outline,
    "loading": _loading,
    "sync-spin": _loading,
    "play": _play,
    "debug-start": _play,
    "run": _play,
    "debug-pause": _pause,
    "debug-stop": _stop,
    "stop-circle": _stop,
    "primitive-square": _stop,
    "split-horizontal": lambda p: _frame(p, "v"),
    "split-vertical": lambda p: _frame(p, "h"),
    "layout": lambda p: _frame(p, "sidebar"),
    "layout-sidebar-left": lambda p: _frame(p, "sidebar"),
    "layout-panel": lambda p: _frame(p, "panel"),
    "editor-layout": lambda p: _frame(p, "v"),
    "files": _files,
    "file": lambda p: _page(p, fold=True),
    "explorer-view-icon": _files,
    "search-view-icon": _search,
    "source-control-view-icon": _scm,
    "source-control": _scm,
    "run-view-icon": _play,
    "extensions-view-icon": _extensions,
    "extensions": _extensions,
    "terminal": _terminal,
    "terminal-view-icon": _terminal,
    "account": _account,
    "lightbulb": _lightbulb,
    "lightbulb-autofix": _lightbulb,
    "filter": _funnel,
    "list-filter": _funnel,
    "save": _save,
    "save-all": _save,
    "go-to-file": _go_to_file,
    "go-to-search": _search,
    "collapse-all": lambda p: (chevron(p, BOX / 2, BOX / 2 - 44, INNER, 40, "up"), chevron(p, BOX / 2, BOX / 2 + 60, INNER, 40, "down")),
    "expand-all": lambda p: (chevron(p, BOX / 2, BOX / 2 - 60, INNER, 40, "down"), chevron(p, BOX / 2, BOX / 2 + 44, INNER, 40, "up")),
    "fold": lambda p: (chevron(p, BOX / 2, BOX / 2 + 50, INNER, 40, "down"), chevron(p, BOX / 2, BOX / 2 - 50, INNER, 40, "up")),
    "unfold": lambda p: (chevron(p, BOX / 2, BOX / 2 - 50, INNER, 40, "down"), chevron(p, BOX / 2, BOX / 2 + 50, INNER, 40, "up")),
}


def build_font() -> dict[str, str]:
    names = sorted(GLYPHS)
    glyph_order = [".notdef"] + names
    glyphs = {}

    notdef = TTGlyphPen({})
    glyphs[".notdef"] = notdef.glyph()

    char_map: dict[int, str] = {}
    icon_defs: dict[str, str] = {}
    cp = 0xE000
    for name in names:
        pen = TTGlyphPen({})
        GLYPHS[name](pen)
        glyphs[name] = pen.glyph()
        char_map[cp] = name
        icon_defs[name] = "\\%04X" % cp
        cp += 1

    fb = FontBuilder(unitsPerEm=UPM, isTTF=True)
    fb.setupGlyphOrder(glyph_order)
    fb.setupCharacterMap(char_map)
    fb.setupGlyf(glyphs)
    metrics = {g: (UPM if g != ".notdef" else 0, 0) for g in glyph_order}
    fb.setupHorizontalMetrics(metrics)
    fb.setupHorizontalHeader(ascent=UPM, descent=0)
    fb.setupNameTable(
        {
            "familyName": "Valyria Product Icons",
            "styleName": "Regular",
            "psName": "ValyriaProductIcons-Regular",
            "version": "1.0",
        }
    )
    fb.setupOS2(sTypoAscender=UPM, sTypoDescender=0, sTypoLineGap=0, usWinAscent=UPM + 27, usWinDescent=3)
    fb.setupPost()
    # Deterministic output: a fixed build epoch so the committed WOFF is
    # byte-reproducible and the CI drift check is meaningful.
    fb.font["head"].created = 0
    fb.font["head"].modified = 0
    fb.font.flavor = "woff"
    os.makedirs(DIST, exist_ok=True)
    fb.save(os.path.join(DIST, "valyria-icons.woff"))
    return icon_defs


def write_product_theme(icon_defs: dict[str, str]) -> None:
    theme = {
        "$schema": "vscode://schemas/product-icon-theme",
        "fonts": [
            {
                "id": "valyria-icons",
                "src": [{"path": "./valyria-icons.woff", "format": "woff"}],
                "weight": "normal",
                "style": "normal",
            }
        ],
        "iconDefinitions": {k: {"fontCharacter": v} for k, v in sorted(icon_defs.items())},
    }
    with open(os.path.join(DIST, "valyria-product-icons.json"), "w") as fh:
        json.dump(theme, fh, indent=2)
        fh.write("\n")


# ----------------------------------------------------------------------------
# file icon theme = stock Seti (vendored, MIT) + Valyria folder icons.
#
# Seti's own theme ships NO folder icons; we keep every one of its file-type
# icons untouched and inject only `folder` / `folderExpanded` / `rootFolder*`.
# ----------------------------------------------------------------------------

VENDOR_SETI = os.path.normpath(os.path.join(HERE, "..", "vendor", "seti"))
FILE_ICON_DIR = os.path.join(DIST, "file-icons")


def folder_svg(accent: str, open_: bool) -> str:
    if open_:
        body = (
            '<path d="M1.5 4.2A1 1 0 0 1 2.5 3.2h3.2l1.3 1.4h6A1 1 0 0 1 14 5.6v1H4.2a1.4 1.4 0 0 0-1.35 1L1.5 12z" '
            f'fill="{accent}" opacity="0.55"/>'
            f'<path d="M3.1 6.8h11.4l-1.5 5.4a1 1 0 0 1-1 .8H2.2a1 1 0 0 1-1-1.25z" fill="{accent}"/>'
        )
    else:
        body = (
            '<path d="M1.5 4.2A1 1 0 0 1 2.5 3.2h3.2l1.3 1.4h6A1 1 0 0 1 14 5.6v6.6a1 1 0 0 1-1 1H2.5a1 1 0 0 1-1-1z" '
            f'fill="{accent}"/>'
        )
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">{body}</svg>'


def build_file_theme() -> None:
    seti_path = os.path.join(VENDOR_SETI, "vs-seti-icon-theme.json")
    with open(seti_path) as fh:
        theme = json.load(fh)

    os.makedirs(FILE_ICON_DIR, exist_ok=True)
    for name, accent, open_ in [
        ("folder", "#c15925", False),
        ("folder-open", "#ec773c", True),
    ]:
        with open(os.path.join(FILE_ICON_DIR, f"{name}.svg"), "w") as fh:
            fh.write(folder_svg(accent, open_))

    # copy Seti's font next to our theme JSON (it references `./seti.woff`)
    with open(os.path.join(VENDOR_SETI, "seti.woff"), "rb") as src:
        data = src.read()
    with open(os.path.join(DIST, "seti.woff"), "wb") as dst:
        dst.write(data)

    theme["iconDefinitions"]["_vy_folder"] = {"iconPath": "./file-icons/folder.svg"}
    theme["iconDefinitions"]["_vy_folder_open"] = {"iconPath": "./file-icons/folder-open.svg"}
    theme["folder"] = "_vy_folder"
    theme["folderExpanded"] = "_vy_folder_open"
    theme["rootFolder"] = "_vy_folder"
    theme["rootFolderExpanded"] = "_vy_folder_open"
    if isinstance(theme.get("light"), dict):
        theme["light"]["folder"] = "_vy_folder"
        theme["light"]["folderExpanded"] = "_vy_folder_open"
        theme["light"]["rootFolder"] = "_vy_folder"
        theme["light"]["rootFolderExpanded"] = "_vy_folder_open"
    theme["information_for_contributors"] = [
        "Stock VS Code Seti file icons (vendored from chrome/vendor/seti, MIT) with the",
        "Valyria folder icons injected. Regenerate: python3 chrome/tools/build_icons.py.",
        "Do not hand-edit chrome/dist/valyria-file-icons.json.",
    ]

    with open(os.path.join(DIST, "valyria-file-icons.json"), "w") as fh:
        json.dump(theme, fh, indent=2)
        fh.write("\n")
    return len(theme["iconDefinitions"])


def main() -> None:
    icon_defs = build_font()
    write_product_theme(icon_defs)
    n_file = build_file_theme()
    print(f"built {len(icon_defs)} product glyphs -> {DIST}/valyria-icons.woff")
    print(f"wrote {DIST}/valyria-product-icons.json")
    print(f"wrote {DIST}/valyria-file-icons.json (Seti file icons + Valyria folders, {n_file} defs)")


if __name__ == "__main__":
    main()
