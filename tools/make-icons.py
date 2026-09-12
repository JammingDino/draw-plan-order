"""Generate the app icons from a single description, so they stay in sync.

Run:  python tools/make-icons.py
Writes icons/icon-192.png, icon-512.png, icon-maskable-512.png and favicon.ico
"""
from PIL import Image, ImageDraw
import os, math

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "icons")
os.makedirs(OUT, exist_ok=True)

BG = (20, 22, 28, 255)          # --text on the light theme: a near-black slate
INK = (250, 250, 252, 255)
ACCENT = (79, 107, 255, 255)


def rounded(size, radius_ratio, fill):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    r = int(size * radius_ratio)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=r, fill=fill)
    return img


def stroke_points(size, pad):
    """A single tapered pen stroke: the whole app in one gesture."""
    w = size - pad * 2
    pts = []
    for i in range(101):
        t = i / 100
        x = pad + t * w
        y = pad + w * (0.62 + 0.30 * math.sin(t * math.pi * 1.35 + 0.5) - 0.22 * t)
        pts.append((x, y))
    return pts


def draw_stroke(img, size, pad, colour, width_ratio=0.13):
    d = ImageDraw.Draw(img)
    pts = stroke_points(size, pad)
    wmax = size * width_ratio
    for i in range(len(pts) - 1):
        t = i / (len(pts) - 1)
        # taper both ends like a real nib
        k = min(1.0, math.sqrt(t) * 3) * min(1.0, math.sqrt(1 - t) * 3)
        w = max(2.0, wmax * (0.45 + 0.55 * k))
        d.line([pts[i], pts[i + 1]], fill=colour, width=int(w), joint="curve")
        d.ellipse([pts[i][0] - w / 2, pts[i][1] - w / 2, pts[i][0] + w / 2, pts[i][1] + w / 2], fill=colour)


def dot_grid(img, size, pad, colour):
    d = ImageDraw.Draw(img)
    step = (size - pad * 2) / 5
    r = max(1, int(size * 0.012))
    for i in range(6):
        for j in range(6):
            x, y = pad + i * step, pad + j * step
            d.ellipse([x - r, y - r, x + r, y + r], fill=colour)


def build(size, maskable=False):
    pad_ratio = 0.26 if maskable else 0.17     # maskable icons need a safe zone
    img = rounded(size, 0.0 if maskable else 0.22, BG)
    pad = int(size * pad_ratio)
    dot_grid(img, size, pad, (255, 255, 255, 38))
    draw_stroke(img, size, pad, INK)
    # a small accent nib at the end of the stroke
    d = ImageDraw.Draw(img)
    ex, ey = stroke_points(size, pad)[-1]
    r = size * 0.055
    d.ellipse([ex - r, ey - r, ex + r, ey + r], fill=ACCENT)
    return img


for size in (192, 512):
    build(size).save(os.path.join(OUT, f"icon-{size}.png"))
build(512, maskable=True).save(os.path.join(OUT, "icon-maskable-512.png"))
build(256).save(os.path.join(OUT, "icon.ico"), sizes=[(16, 16), (32, 32), (48, 48), (256, 256)])
print("wrote", os.listdir(OUT))

# the desktop bundle wants its own set, at the names Tauri looks for
TAURI = os.path.join(os.path.dirname(OUT), "src-tauri", "icons")
if os.path.isdir(os.path.dirname(TAURI)):
    os.makedirs(TAURI, exist_ok=True)
    build(32).save(os.path.join(TAURI, "32x32.png"))
    build(128).save(os.path.join(TAURI, "128x128.png"))
    build(256).save(os.path.join(TAURI, "128x128@2x.png"))
    build(256).save(os.path.join(TAURI, "icon.png"))
    build(256).save(os.path.join(TAURI, "icon.ico"), sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (256, 256)])
    print("wrote", os.listdir(TAURI))
