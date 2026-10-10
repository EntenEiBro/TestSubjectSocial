"""Generate the game icons with only the standard library.

Writes:
  Test Subject Social/game/icon.png        favicon / window icon (256 px)
  icon.ico                                  Windows .exe icon (16–256 px)
  android/app/src/main/res/mipmap-*/        Android launcher icons:
      ic_launcher.png                       legacy square icon (Android 7)
      ic_launcher_background.png            adaptive icon layers (Android 8+)
      ic_launcher_foreground.png              — the launcher masks them to the
      ic_launcher_monochrome.png              phone's shape (circle on Pixel) and
  android/.../mipmap-anydpi-v26/ic_launcher.xml   uses monochrome for themed icons

The design is original: a blocky test-subject head in a hard hat and an
oxblood jumpsuit, over a grimy plate with hazard stripes.

Usage:  python tools/make_icon.py
"""
import os
import random
import struct
import zlib

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RES = os.path.join(ROOT, "android", "app", "src", "main", "res")

PLATE = (38, 36, 32)
HAZARD_Y = (201, 162, 39)
HAZARD_K = (27, 26, 23)
SUIT = (124, 35, 35)
PATCH = (216, 208, 184)
SKIN = (226, 184, 150)
HAT = (216, 176, 42)
BRIM = (190, 150, 30)
INK = (10, 10, 10)
BLOOD = (110, 5, 5)


class Canvas:
    """RGBA pixel grid with drawing in 'design units' (grid → pixels via scale + offset)."""

    def __init__(self, size, grid, offset=(0.0, 0.0), scale=1.0, seed=7):
        self.size = size
        self.k = size / grid          # pixels per design unit
        self.ox, self.oy = offset     # design-space offset applied before scaling
        self.scale = scale            # extra design-space scale (for re-using shapes)
        self.rnd = random.Random(seed)
        self.px = [[(0, 0, 0, 0)] * size for _ in range(size)]

    def _span(self, a0, a1, o):
        lo = int(round((o + a0 * self.scale) * self.k))
        hi = int(round((o + a1 * self.scale) * self.k))
        return max(0, lo), min(self.size, hi)

    def rect(self, x0, y0, x1, y1, color, noise=0, alpha=255):
        xs, xe = self._span(x0, x1, self.ox)
        ys, ye = self._span(y0, y1, self.oy)
        for y in range(ys, ye):
            row = self.px[y]
            for x in range(xs, xe):
                n = self.rnd.randint(-noise, noise) if noise else 0
                row[x] = (max(0, min(255, color[0] + n)), max(0, min(255, color[1] + n)),
                          max(0, min(255, color[2] + n)), alpha)

    def hazard(self, x0, y0, x1, y1, period=8.0):
        """Diagonal yellow/black stripes filling a rectangle (design units)."""
        xs, xe = self._span(x0, x1, self.ox)
        ys, ye = self._span(y0, y1, self.oy)
        for y in range(ys, ye):
            for x in range(xs, xe):
                g = (x + y) / self.k / self.scale
                self.px[y][x] = (*(HAZARD_Y if (g % period) < period / 2 else HAZARD_K), 255)


def draw_subject(c, color=None, cutouts=True):
    """The test subject, in the original 32-unit design grid.

    color=None paints it in full colour; a colour tuple paints a solid
    silhouette (monochrome layer) with the face details cut out.
    """
    solid = color is not None
    paint = (lambda col: color) if solid else (lambda col: col)
    c.rect(9, 21, 23, 26, paint(SUIT), 0 if solid else 8)     # shoulders
    c.rect(9, 5, 23, 20, paint(SKIN), 0 if solid else 6)      # head
    c.rect(9, 4, 23, 7, paint(HAT), 0 if solid else 6)        # hard hat
    c.rect(7, 6, 25, 7, paint(BRIM))                          # brim
    if solid:
        if cutouts:  # eyes, mouth and collar patch become holes
            for r in ((12, 10, 15, 13), (17, 10, 20, 13), (13, 16, 19, 17), (14, 22, 18, 25)):
                c.rect(*r, (0, 0, 0), alpha=0)
        return
    c.rect(14, 22, 18, 25, PATCH)                             # collar number patch
    c.rect(12, 10, 15, 13, INK)                               # eyes
    c.rect(17, 10, 20, 13, INK)
    c.rect(13, 16, 19, 17, INK)                               # mouth slit
    c.rect(19, 14, 21, 18, BLOOD)                             # a little blood, of course


def render_legacy(size):
    """Square icon: plate + stripes + subject (32-unit grid)."""
    c = Canvas(size, 32)
    c.rect(1, 1, 31, 31, PLATE, 10)
    c.hazard(2, 25, 30, 30)
    draw_subject(c)
    return c.px


# Adaptive icons use a 108×108 dp canvas; launchers may crop anything outside
# the central 66 dp circle, so the subject is kept inside x/y 24..84.
ADAPTIVE_GRID = 108
SUBJECT_SCALE = 2.45                     # 32-unit design → dp
SUBJECT_OFFSET = (54 - 16 * 2.45, 22.0)  # centred horizontally; head top at y≈32 dp


def render_background(size):
    """Full-bleed layer: grimy plate with a hazard band where the shoulders rest."""
    c = Canvas(size, ADAPTIVE_GRID)
    c.rect(0, 0, ADAPTIVE_GRID, ADAPTIVE_GRID, PLATE, 10)
    c.rect(0, 0, ADAPTIVE_GRID, 4, (28, 27, 24))                       # top grime edge
    band_top = SUBJECT_OFFSET[1] + 25 * SUBJECT_SCALE - 4              # just under the collar
    c.hazard(0, band_top, ADAPTIVE_GRID, band_top + 16, period=10)
    c.rect(0, band_top + 16, ADAPTIVE_GRID, ADAPTIVE_GRID, (31, 29, 26), 8)
    return c.px


def render_foreground(size):
    """Transparent layer with just the subject, inside the safe zone."""
    c = Canvas(size, ADAPTIVE_GRID, offset=SUBJECT_OFFSET, scale=SUBJECT_SCALE)
    draw_subject(c)
    return c.px


def render_monochrome(size):
    """Single-colour silhouette used by Android 13+ themed icons."""
    c = Canvas(size, ADAPTIVE_GRID, offset=SUBJECT_OFFSET, scale=SUBJECT_SCALE)
    draw_subject(c, color=(255, 255, 255))
    return c.px


def png_bytes(px):
    size = len(px)
    raw = b"".join(b"\x00" + bytes(ch for p in row for ch in p) for row in px)

    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))


def ico_bytes(images):
    """ICO container holding PNG-encoded images (supported since Windows Vista)."""
    header = struct.pack("<HHH", 0, 1, len(images))
    offset = 6 + 16 * len(images)
    entries, blobs = b"", b""
    for size, data in images:
        entries += struct.pack("<BBBBHHII", size % 256, size % 256, 0, 0, 1, 32, len(data), offset)
        blobs += data
        offset += len(data)
    return header + entries + blobs


def write(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(data)


# density → (legacy icon px, adaptive layer px = 108 dp)
ANDROID_DENSITIES = {"mdpi": (48, 108), "hdpi": (72, 162), "xhdpi": (96, 216), "xxhdpi": (144, 324), "xxxhdpi": (192, 432)}

ADAPTIVE_XML = """<?xml version="1.0" encoding="utf-8"?>
<!-- Adaptive launcher icon (Android 8+): the launcher masks these layers to the
     device's icon shape (a circle on Pixel phones). Generated by tools/make_icon.py. -->
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@mipmap/ic_launcher_background" />
    <foreground android:drawable="@mipmap/ic_launcher_foreground" />
    <monochrome android:drawable="@mipmap/ic_launcher_monochrome" />
</adaptive-icon>
"""


def main():
    sizes = [256, 64, 48, 32, 16]
    pngs = [(n, png_bytes(render_legacy(n))) for n in sizes]
    write(os.path.join(ROOT, "Test Subject Social", "game", "icon.png"), pngs[0][1])
    write(os.path.join(ROOT, "icon.ico"), ico_bytes(pngs))

    for density, (legacy, layer) in ANDROID_DENSITIES.items():
        folder = os.path.join(RES, f"mipmap-{density}")
        write(os.path.join(folder, "ic_launcher.png"), png_bytes(render_legacy(legacy)))
        write(os.path.join(folder, "ic_launcher_background.png"), png_bytes(render_background(layer)))
        write(os.path.join(folder, "ic_launcher_foreground.png"), png_bytes(render_foreground(layer)))
        write(os.path.join(folder, "ic_launcher_monochrome.png"), png_bytes(render_monochrome(layer)))
    write(os.path.join(RES, "mipmap-anydpi-v26", "ic_launcher.xml"), ADAPTIVE_XML.encode("utf-8"))

    # Preview of how a circular launcher (Pixel) shows the adaptive icon.
    write(os.path.join(ROOT, "build", "icon-preview-circle.png"), png_bytes(preview_circle(432)))
    print("wrote icon.png, icon.ico, Android legacy + adaptive icons, build/icon-preview-circle.png")


def preview_circle(size):
    """Composite background + foreground and apply the circular mask (66 dp visible of 108 dp → ~72 dp crop)."""
    bg, fg = render_background(size), render_foreground(size)
    out = [[(0, 0, 0, 0)] * size for _ in range(size)]
    r = size * (72 / 108) / 2  # launchers show roughly the middle 72 dp
    cx = cy = size / 2
    for y in range(size):
        for x in range(size):
            if (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 > r * r:
                continue
            f = fg[y][x]
            out[y][x] = f if f[3] else bg[y][x]
    return out


if __name__ == "__main__":
    main()
