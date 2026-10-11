"""Generate the game's procedural "grungy industrial" textures as PNG files.

Usage:  python tools/make_textures.py

Writes godot/assets/textures/*.png (shared by the Godot project and the
Blender model scripts). Python standard library only. The look follows the
web version's canvas painters (core/textures.js): a base colour, per-pixel
noise, soft stains, streaks and a few pattern details, sampled with
nearest-neighbour filtering in the game for a crunchy late-90s look.
"""
import math
import os
import random
import struct
import zlib

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "godot", "assets", "textures")


class Img:
    def __init__(self, s, base=(0, 0, 0, 0)):
        self.s = s
        self.px = [list(base) for _ in range(s * s)]

    def _blend(self, x, y, rgba):
        x %= self.s
        y %= self.s
        p = self.px[y * self.s + x]
        a = rgba[3]
        for i in range(3):
            p[i] = p[i] * (1 - a) + rgba[i] * a
        p[3] = p[3] + (1 - p[3]) * a

    def fill(self, rgb):
        for p in self.px:
            p[0], p[1], p[2], p[3] = rgb[0], rgb[1], rgb[2], 1.0

    def noise(self, amount):
        for p in self.px:
            n = (random.random() - 0.5) * amount
            p[0] += n
            p[1] += n
            p[2] += n

    def stain(self, cx, cy, r, rgba):
        ri = int(r) + 1
        for dy in range(-ri, ri + 1):
            for dx in range(-ri, ri + 1):
                d = math.hypot(dx, dy)
                if d >= r:
                    continue
                k = 1 - d / r
                self._blend(int(cx + dx), int(cy + dy), (rgba[0], rgba[1], rgba[2], rgba[3] * k))

    def rect(self, x, y, w, h, rgba):
        for yy in range(int(y), int(y + h)):
            for xx in range(int(x), int(x + w)):
                self._blend(xx, yy, rgba)

    def line(self, x0, y0, x1, y1, rgba, width=1):
        n = int(max(abs(x1 - x0), abs(y1 - y0), 1) * 2)
        hw = width / 2
        for i in range(n + 1):
            t = i / n
            x, y = x0 + (x1 - x0) * t, y0 + (y1 - y0) * t
            for yy in range(int(y - hw), int(y + hw) + 1):
                for xx in range(int(x - hw), int(x + hw) + 1):
                    if (xx - x) ** 2 + (yy - y) ** 2 <= max(hw, 0.5) ** 2 + 0.25:
                        self._blend(xx, yy, rgba)

    def circle(self, cx, cy, r, rgba):
        ri = int(r) + 1
        for dy in range(-ri, ri + 1):
            for dx in range(-ri, ri + 1):
                if dx * dx + dy * dy <= r * r:
                    self._blend(int(cx + dx), int(cy + dy), rgba)

    def save(self, name):
        rows = b""
        for y in range(self.s):
            row = bytearray([0])
            for x in range(self.s):
                p = self.px[y * self.s + x]
                row += bytes(max(0, min(255, int(round(c * 255)))) for c in p)
            rows += bytes(row)
        def chunk(tag, data):
            return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", self.s, self.s, 8, 6, 0, 0, 0))
        png += chunk(b"IDAT", zlib.compress(rows, 9)) + chunk(b"IEND", b"")
        with open(os.path.join(OUT, name + ".png"), "wb") as f:
            f.write(png)


def hexrgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))


def grime(img, base, noise=30, stains=14, stain=(20 / 255, 15 / 255, 10 / 255, 0.18), streaks=0):
    s = img.s
    img.fill(hexrgb(base))
    img.noise(noise / 255)
    for _ in range(stains):
        img.stain(random.uniform(0, s), random.uniform(0, s), random.uniform(s * 0.05, s * 0.25), stain)
    for _ in range(streaks):
        img.rect(random.uniform(0, s), random.uniform(0, s * 0.5), random.uniform(1, 3), random.uniform(s * 0.2, s * 0.8),
                 (10 / 255, 8 / 255, 5 / 255, random.uniform(0.05, 0.15)))


def build():
    os.makedirs(OUT, exist_ok=True)
    random.seed(1977)

    img = Img(128); grime(img, "#6d6a63", 34, 22, streaks=10)
    for _ in range(4):  # hairline cracks
        x, y = random.uniform(0, 128), random.uniform(0, 128)
        for _ in range(5):
            nx, ny = x + random.uniform(-12, 12), y + random.uniform(-12, 12)
            img.line(x, y, nx, ny, (30 / 255, 28 / 255, 25 / 255, 0.35)); x, y = nx, ny
    img.save("concrete")

    img = Img(128); grime(img, "#7a776d", 30, 18, streaks=26); img.rect(0, 128 * 0.82, 128, 128 * 0.18, (40 / 255, 35 / 255, 30 / 255, 0.25)); img.save("wall")

    img = Img(64); grime(img, "#4b4f4a", 24, 8)
    dark = (*hexrgb("#25261f"), 1.0)
    for i in range(64):
        for (x, y) in ((i, 0), (i, 1), (i, 63), (i, 62), (0, i), (1, i), (63, i), (62, i), (32, i), (31, i), (i, 32), (i, 31)):
            img._blend(x, y, dark)
    img.save("tiles")

    img = Img(64); grime(img, "#5c605f", 20, 10, stain=(90 / 255, 50 / 255, 20 / 255, 0.25))
    for y in range(0, 64, 4): img.rect(0, y, 64, 1, (1, 1, 1, 0.05))
    img.save("metal")

    img = Img(64); grime(img, "#575b58", 18, 8, stain=(110 / 255, 60 / 255, 20 / 255, 0.25))
    for i in range(64):
        for (x, y) in ((i, 0), (i, 63), (0, i), (63, i)): img._blend(x, y, (0, 0, 0, 0.5))
    for (x, y) in ((5, 5), (58, 5), (5, 58), (58, 58)): img.circle(x, y, 2, (*hexrgb("#2b2d2b"), 1))
    for i in range(0, 64, 8): img.line(i, 0, i + 8, 8, (0, 0, 0, 0.25))
    img.save("plate")

    img = Img(64); grime(img, "#6e3f22", 40, 16, stain=(30 / 255, 15 / 255, 5 / 255, 0.35)); img.save("rust")

    img = Img(64); grime(img, "#6b4a2f", 22, 6)
    y = 0.0
    while y < 64:
        a, b = random.uniform(-3, 3), random.uniform(-3, 3)
        pts = [(x, y + a * math.sin(x / 64 * math.pi) + b * math.sin(x / 32 * math.pi)) for x in range(0, 65, 4)]
        for (x0, y0), (x1, y1) in zip(pts, pts[1:]): img.line(x0, y0, x1, y1, (40 / 255, 25 / 255, 10 / 255, 0.45))
        y += random.uniform(3, 7)
    img.save("wood")

    img = Img(64); grime(img, "#7b5d38", 26, 6)
    edge = (*hexrgb("#3d2b16"), 1.0)
    img.rect(0, 0, 64, 5, edge); img.rect(0, 59, 64, 5, edge); img.rect(0, 0, 5, 64, edge); img.rect(59, 0, 5, 64, edge)
    img.line(4, 4, 60, 60, edge, 4)
    img.save("crate")

    img = Img(64); img.fill(hexrgb("#c9a227"))
    stripe = (*hexrgb("#1b1a17"), 1.0)
    for yy in range(64):
        for xx in range(64):
            if (xx + yy) % 16 < 8: img._blend(xx, yy, stripe)
    img.noise(40 / 255)
    img.save("hazard")

    img = Img(32); grime(img, "#ffffff", 40, 4, stain=(0, 0, 0, 0.12)); img.save("fabric")

    img = Img(128); grime(img, "#4a4434", 46, 26, stain=(20 / 255, 18 / 255, 10 / 255, 0.3))
    for _ in range(60): img.rect(random.uniform(0, 128), random.uniform(0, 128), random.uniform(1, 3), random.uniform(2, 5), (70 / 255, 90 / 255, 40 / 255, 0.25))
    img.save("dirt")

    img = Img(64)  # transparent blood pool
    for _ in range(9):
        img.circle(32 + random.uniform(-14, 14), 32 + random.uniform(-14, 14), random.uniform(5, 16),
                   ((90 + random.random() * 40) / 255, 0, 0, 0.7 + random.random() * 0.3))
    for _ in range(14): img.circle(random.uniform(4, 60), random.uniform(4, 60), random.uniform(1, 3), (110 / 255, 0, 0, 0.9))
    img.save("blood")

    # Headwear patterns (white-based ones are tinted by the material colour).
    img = Img(64); img.fill((1, 1, 1))
    for x in range(0, 64, 8): img.rect(x, 0, 3, 64, (0, 0, 0, 0.18)); img.rect(x + 4, 0, 2, 64, (1, 1, 1, 0.08))
    for _ in range(300): img.rect(random.uniform(0, 64), random.uniform(0, 64), 2, 1, (0, 0, 0, random.random() * 0.12))
    img.save("knit")

    img = Img(64); img.fill(hexrgb("#b08f5c"))
    for _ in range(14): img.line(random.uniform(0, 64), 0, random.uniform(0, 64), 64, (60 / 255, 40 / 255, 15 / 255, 0.1 + random.random() * 0.15))
    for _ in range(400): img.rect(random.uniform(0, 64), random.uniform(0, 64), 1, 1, (0, 0, 0, random.random() * 0.06))
    img.save("paper")

    suits = ["#c4561f", "#2f7d74", "#b89a2c", "#7c2323", "#5a6a2e", "#2d4f8f", "#c9c5b8", "#5b3a72"]
    for i, hx in enumerate(suits):
        img = Img(64); img.fill(hexrgb(hx))
        cream = (*hexrgb("#f2ead8"), 1.0)
        for yy in range(64):
            for xx in range(64):
                if (yy - xx * 0.5) % 16 < 7: img._blend(xx, yy, cream)
        for k in range(18): img.rect(random.uniform(0, 61), random.uniform(0, 61), 3, 3, (*hexrgb(["#ffd84a", "#4ad2ff", "#ff5ab0"][k % 3]), 1))
        img.save(f"stripes_{i}")

    # Film grain tile for the full-screen overlay.
    img = Img(128)
    for p in img.px:
        v = random.random()
        p[0] = p[1] = p[2] = v
        p[3] = 1.0
    img.save("grain")
    print("textures written to", OUT)


if __name__ == "__main__":
    build()
