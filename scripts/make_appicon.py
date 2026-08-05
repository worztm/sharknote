"""Generate the Sharknote app icon (1024x1024) matching the in-app Logo:
violet gradient rounded square + white shark silhouette with gradient fin."""
from PIL import Image, ImageDraw
import math

S = 1024
OUT = "build/appicon.png"

# ---------- helpers ----------
def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))

def hexc(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i+2], 16) for i in (0, 2, 4))

def bezier(p0, p1, p2, p3, n=48):
    pts = []
    for i in range(n + 1):
        t = i / n
        u = 1 - t
        x = u**3 * p0[0] + 3 * u**2 * t * p1[0] + 3 * u * t**2 * p2[0] + t**3 * p3[0]
        y = u**3 * p0[1] + 3 * u**2 * t * p1[1] + 3 * u * t**2 * p2[1] + t**3 * p3[1]
        pts.append((x, y))
    return pts

def arc(cx, cy, r, a0, a1, n=48):
    pts = []
    for i in range(n + 1):
        a = a0 + (a1 - a0) * i / n
        pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return pts

# viewBox is 24x24; scale to canvas with a little breathing room
SC = S / 24.0 * 0.92
OFF = (S - 24 * SC) / 2

def P(x, y):
    return (OFF + x * SC, OFF + y * SC)

# ---------- canvas + rounded-square gradient background ----------
img = Image.new("RGB", (S, S))
d = ImageDraw.Draw(img)

top = hexc("#8b5cf6")    # violet-500
bot = hexc("#6d28d9")    # violet-700
for y in range(S):
    t = y / S
    d.line([(0, y), (S, y)], fill=lerp(top, bot, t))

# rounded-rect mask (squircle-ish, ~22% radius)
R = int(S * 0.225)
mask = Image.new("L", (S, S), 0)
md = ImageDraw.Draw(mask)
md.rounded_rectangle([0, 0, S - 1, S - 1], radius=R, fill=255)
img.putalpha(mask)

d = ImageDraw.Draw(img)

# ---------- outer white shark silhouette ----------
outer = []
outer += bezier(P(12, 2), P(7, 6), P(4, 10), P(4, 14))
outer += arc(P(12, 14)[0], P(12, 14)[1], 8 * SC, math.pi, 0)  # bottom semicircle
outer += bezier(P(20, 14), P(20, 10), P(17, 6), P(12, 2))
d.polygon(outer, fill=(255, 255, 255))

# ---------- inner gradient fin ----------
inner = []
inner += bezier(P(12, 2), P(14.5, 5.5), P(16, 9), P(16, 12.5))
inner += arc(P(12, 12.5)[0], P(12, 12.5)[1], 4 * SC, 0, math.pi)
inner += bezier(P(8, 12.5), P(8, 9), P(9.5, 5.5), P(12, 2))

# diagonal gradient for the fin: #a78bfa -> #7c3aed
inner_img = Image.new("RGB", (S, S))
id_ = ImageDraw.Draw(inner_img)
for y in range(S):
    t = y / S
    id_.line([(0, y), (S, y)], fill=lerp(hexc("#a78bfa"), hexc("#7c3aed"), t))
fin_mask = Image.new("L", (S, S), 0)
fd = ImageDraw.Draw(fin_mask)
fd.polygon(inner, fill=255)
img.paste(inner_img, (0, 0), fin_mask)

# ---------- smile ----------
smile = bezier(P(9, 14.5), P(10.5, 13.3), P(12, 13.3), P(13.5, 14.5), n=24)
d.line(smile, fill=hexc("#0b0b10"), width=max(3, int(1.1 * SC)), joint="curve")

# rounded-rect mask again (paste step above may have clipped corners)
final = Image.new("RGBA", (S, S), (0, 0, 0, 0))
final.paste(img, (0, 0), mask)
final.save(OUT)
print("wrote", OUT, final.size)
