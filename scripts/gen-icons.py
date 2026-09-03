#!/usr/bin/env python3
"""
Generate the Valyria icon set into vscode/resources/ from build/icons/.

Deterministic and offline. The source art is already raster
(build/icons/valyria.icns + valyria-512.png), so nothing here shells out to an
SVG rasteriser (rsvg-convert / ImageMagick / cairosvg) — the absence of one is
what silently broke the previous icon pipeline.

Requires Pillow. `.icns` output additionally needs `iconutil` (macOS only); when
it is absent the script prints a loud WARNING and still writes every
cross-platform icon (PNG / ICO / XPM / tiles) plus the prebuilt app `code.icns`
(a plain file copy). It never fails silently: a real error is a non-zero exit.

Outputs under vscode/resources/:

  darwin/code.icns        <- build/icons/valyria.icns verbatim (complete 10-size set)
  linux/code.png          <- 1024x1024 Valyria mark
  linux/rpm/code.xpm      <- 1024x1024, quantised, XPM3
  win32/code.ico          <- 16/32/48/64/128/256 multi-size ICO
  win32/code_70x70.png    <- Start-menu small tile
  win32/code_150x150.png  <- Start-menu large tile
  darwin/<lang>.icns      <- stock document icon, VS Code corner badge replaced (macOS only)
  win32/<lang>.ico        <- stock document icon, VS Code corner badge replaced

The document-icon rebrand keeps the page shape and the per-language glyph (those
are language identity, not Microsoft branding) and paints a Valyria "V" badge
over the blue VS Code badge in the bottom-right corner.
"""

from __future__ import annotations

import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

try:
    from PIL import Image, ImageDraw
except ImportError:
    import subprocess as _sp

    print("gen-icons: Pillow not found — installing (python3 -m pip install --user Pillow)")
    try:
        _sp.run(
            [sys.executable, "-m", "pip", "install", "--user", "--quiet", "Pillow"],
            check=True,
        )
        from PIL import Image, ImageDraw
    except Exception:
        sys.exit(
            "gen-icons: could not import or install Pillow.\n"
            "  Install it manually, then re-run scripts/bootstrap.sh:\n"
            "    python3 -m pip install --user Pillow"
        )

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "build" / "icons"
RES = ROOT / "vscode" / "resources"
HAVE_ICONUTIL = shutil.which("iconutil") is not None

# Rust / dragon-fire, sampled from the Valyria mark (build/icons/valyria-512.png).
RUST = (192, 90, 44, 255)
RUST_DEEP = (122, 42, 18, 255)
WHITE = (255, 255, 255, 255)

ICNS_DOC_SIZES = [16, 32, 128, 256, 512]      # stock document .icns ladder (no @2x)
ICO_SIZES = [16, 32, 48, 64, 128, 256]


def run(*args: str) -> None:
    subprocess.run(args, check=True, capture_output=True)


def load_mark() -> Image.Image:
    """The square Valyria mark, RGBA, at the largest resolution available."""
    if HAVE_ICONUTIL:
        d = Path(tempfile.mkdtemp()) / "app.iconset"
        run("iconutil", "-c", "iconset", str(SRC / "valyria.icns"), "-o", str(d))
        big = d / "icon_512x512@2x.png"
        if big.exists():
            return Image.open(big).convert("RGBA")
    return Image.open(SRC / "valyria-512.png").convert("RGBA")


def v_glyph(size: int, color=WHITE) -> Image.Image:
    """A bold folded 'V', centered on transparency — reads down to a few px."""
    im = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    s = size
    ImageDraw.Draw(im).polygon(
        [
            (0.14 * s, 0.16 * s), (0.34 * s, 0.16 * s),
            (0.50 * s, 0.62 * s),
            (0.66 * s, 0.16 * s), (0.86 * s, 0.16 * s),
            (0.60 * s, 0.86 * s), (0.40 * s, 0.86 * s),
        ],
        fill=color,
    )
    return im


def badge(size: int) -> Image.Image:
    """Rust rounded-square with a white V — the replacement corner badge."""
    im = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle(
        [0, 0, size - 1, size - 1],
        radius=max(2, int(size * 0.22)),
        fill=RUST,
        outline=RUST_DEEP,
        width=max(1, size // 40),
    )
    im.alpha_composite(v_glyph(int(size * 0.78)), (int(size * 0.11), int(size * 0.11)))
    return im


def rebrand_doc(stock: Image.Image) -> Image.Image:
    """Cover the bottom-right VS Code badge on a document icon with a Valyria one."""
    im = stock.convert("RGBA")
    w, h = im.size
    bsize = int(w * 0.34)          # stock badge is ~x[0.66,0.92] y[0.74,0.97]; oversize to cover
    margin = int(w * 0.035)
    im.alpha_composite(badge(bsize), (w - bsize - margin, h - bsize - margin))
    return im


def expand_iconset(icns: Path) -> dict[int, Image.Image]:
    d = Path(tempfile.mkdtemp()) / "in.iconset"
    run("iconutil", "-c", "iconset", str(icns), "-o", str(d))
    out: dict[int, Image.Image] = {}
    for p in sorted(d.glob("*.png")):
        im = Image.open(p).convert("RGBA")
        out[im.size[0]] = im
    return out


def write_icns(dst: Path, frames: dict[int, Image.Image]) -> None:
    d = Path(tempfile.mkdtemp()) / "out.iconset"
    d.mkdir(parents=True)
    for px in ICNS_DOC_SIZES:
        src = frames.get(px) or frames[min(frames, key=lambda k: abs(k - px))]
        src.resize((px, px), Image.LANCZOS).save(d / f"icon_{px}x{px}.png")
    run("iconutil", "-c", "icns", str(d), "-o", str(dst))


def write_ico(dst: Path, base: Image.Image, sizes=ICO_SIZES) -> None:
    base.save(dst, format="ICO", sizes=[(s, s) for s in sizes])


def write_xpm(dst: Path, im: Image.Image, name: str = "code", max_colors: int = 64) -> None:
    """Minimal XPM3 writer (Pillow 11 dropped the XPM encoder). 1 char/pixel."""
    rgba = im.convert("RGBA")
    w, h = rgba.size
    flat = Image.new("RGB", (w, h), (255, 255, 255))
    flat.paste(rgba, mask=rgba.split()[3])
    pal = flat.quantize(colors=max_colors - 1, method=Image.MEDIANCUT).convert("RGB")
    alpha = rgba.split()[3].point(lambda a: 255 if a >= 128 else 0)
    px_pal, px_a = pal.load(), alpha.load()
    chars = [c for c in
             "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"
             "!#$%&()*+,-./:;<=>?@[]^_`{|}~" if c not in ('"', "\\")]
    color_id: dict[object, str] = {}
    rows: list[str] = []
    for y in range(h):
        row = []
        for x in range(w):
            key = None if px_a[x, y] == 0 else px_pal[x, y]
            cid = color_id.get(key)
            if cid is None:
                cid = chars[len(color_id)]
                color_id[key] = cid
            row.append(cid)
        rows.append("".join(row))
    lines = [f'"{w} {h} {len(color_id)} 1",']
    for key, cid in color_id.items():
        spec = "None" if key is None else "#%02X%02X%02X" % key
        lines.append(f'"{cid}\tc {spec}",')
    for i, r in enumerate(rows):
        lines.append(f'"{r}"' + ("," if i < h - 1 else ""))
    dst.write_text(
        "/* XPM */\nstatic char * %s_xpm[] = {\n%s\n};\n" % (name, "\n".join(lines))
    )


def main() -> int:
    if not (SRC / "valyria.icns").exists() or not (SRC / "valyria-512.png").exists():
        sys.exit(f"gen-icons: missing source art in {SRC} (valyria.icns, valyria-512.png)")
    if not RES.exists():
        sys.exit(f"gen-icons: {RES} not found — run scripts/bootstrap.sh first")

    if not HAVE_ICONUTIL:
        print(
            "gen-icons: WARNING — `iconutil` not found (macOS only). "
            "Writing PNG/ICO/XPM only; darwin .icns document icons stay stock. "
            "The macOS packaging runner regenerates these."
        )

    mark = load_mark()
    mark1024 = mark.resize((1024, 1024), Image.LANCZOS)

    # 1. macOS app icon — the recovered set is already complete and correctly sized.
    (RES / "darwin").mkdir(parents=True, exist_ok=True)
    shutil.copyfile(SRC / "valyria.icns", RES / "darwin" / "code.icns")

    # 2. Linux PNG (1024) + 3. RPM XPM.
    (RES / "linux" / "rpm").mkdir(parents=True, exist_ok=True)
    mark1024.save(RES / "linux" / "code.png")
    write_xpm(RES / "linux" / "rpm" / "code.xpm", mark1024)

    # 4. Windows main ICO + 5. Start-menu tiles.
    (RES / "win32").mkdir(parents=True, exist_ok=True)
    write_ico(RES / "win32" / "code.ico", mark1024)
    for name, px in (("code_70x70.png", 70), ("code_150x150.png", 150)):
        mark1024.resize((px, px), Image.LANCZOS).save(RES / "win32" / name)

    # 6. Document icons — badge swap, keep page + language glyph.
    doc_ico = sorted(p for p in (RES / "win32").glob("*.ico") if p.name != "code.ico")
    for p in doc_ico:
        big = Image.open(p).convert("RGBA").resize((256, 256), Image.LANCZOS)
        write_ico(p, rebrand_doc(big), sizes=[s for s in ICO_SIZES if s <= 256])

    n_icns = 0
    if HAVE_ICONUTIL:
        doc_icns = sorted(p for p in (RES / "darwin").glob("*.icns") if p.name != "code.icns")
        for p in doc_icns:
            frames = {px: rebrand_doc(im) for px, im in expand_iconset(p).items()}
            write_icns(p, frames)
        n_icns = len(doc_icns)

    print(
        f"gen-icons: code.icns/.ico/.png/.xpm + tiles + {len(doc_ico)} win32"
        + (f" & {n_icns} darwin" if n_icns else "")
        + " document icons"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
