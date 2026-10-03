"""Programmatic app icon for 体感游戏工坊 (Motion Games Lab).

A warm-white open hand (the in-game hand cursor colour) on a forest-green rounded square, with a gold
motion arc and three motion dots. Drawn at 4x and downsampled for clean edges, written to
src-tauri/app-icon.png (1024 px); `pnpm tauri icon src-tauri/app-icon.png` then generates every size
(icon.ico with 16-256 px layers, PNGs). Run with any Python that has Pillow.
"""
import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

S = 4096  # 4x supersampling of the 1024 px master
OUT = Path(__file__).resolve().parent.parent / 'src-tauri' / 'app-icon.png'

GREEN_TOP = (79, 154, 85)
GREEN_BOTTOM = (38, 92, 66)
HAND = (251, 242, 230)
HAND_LINE = (138, 109, 85)
GOLD = (255, 201, 77)


def rounded_mask(size: int, radius: int, inset: int) -> Image.Image:
    mask = Image.new('L', (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle((inset, inset, size - inset, size - inset), radius=radius, fill=255)
    return mask


def capsule(draw: ImageDraw.ImageDraw, a, b, r, fill):
    """Thick round-capped segment from a to b."""
    draw.line((a, b), fill=fill, width=int(r * 2))
    for p in (a, b):
        draw.ellipse((p[0] - r, p[1] - r, p[0] + r, p[1] + r), fill=fill)


def hand_shape(size: int, scale: float, cx: float, cy: float, angle: float) -> Image.Image:
    """Open hand silhouette (palm + four fingers + thumb) as an L mask, rotated by `angle` degrees."""
    m = Image.new('L', (size, size), 0)
    d = ImageDraw.Draw(m)
    u = scale
    # palm
    d.rounded_rectangle((cx - 1.55 * u, cy - 0.9 * u, cx + 1.55 * u, cy + 1.9 * u), radius=int(1.1 * u), fill=255)
    # fingers (index → little), slightly fanned
    fingers = [(-1.1, 2.55, -7), (-0.36, 2.95, -2), (0.38, 2.8, 3), (1.08, 2.2, 9)]
    for x, length, tilt in fingers:
        base = (cx + x * u, cy - 0.5 * u)
        t = math.radians(tilt)
        tip = (base[0] + math.sin(t) * length * u, base[1] - math.cos(t) * length * u)
        capsule(d, base, tip, 0.36 * u, 255)
    # thumb
    capsule(d, (cx - 1.25 * u, cy + 0.9 * u), (cx - 2.55 * u, cy - 0.35 * u), 0.42 * u, 255)
    return m.rotate(angle, resample=Image.BICUBIC, center=(cx, cy))


def main() -> None:
    img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    # background: vertical green gradient in a rounded square
    grad = Image.new('RGBA', (S, S))
    gd = ImageDraw.Draw(grad)
    for y in range(S):
        t = y / (S - 1)
        gd.line((0, y, S, y), fill=tuple(int(GREEN_TOP[i] + (GREEN_BOTTOM[i] - GREEN_TOP[i]) * t) for i in range(3)) + (255,))
    inset = int(S * 0.04)
    img.paste(grad, (0, 0), rounded_mask(S, int(S * 0.22), inset))
    draw = ImageDraw.Draw(img)

    # soft light in the top-left corner
    glow = Image.new('L', (S, S), 0)
    ImageDraw.Draw(glow).ellipse((-S * 0.2, -S * 0.25, S * 0.7, S * 0.55), fill=38)
    glow = glow.filter(ImageFilter.GaussianBlur(S * 0.08))
    light = Image.new('RGBA', (S, S), (255, 255, 255, 0))
    light.putalpha(Image.composite(glow, Image.new('L', (S, S), 0), rounded_mask(S, int(S * 0.22), inset)))
    img = Image.alpha_composite(img, light)
    draw = ImageDraw.Draw(img)

    # motion arc behind the hand (gold, tapering) + three motion dots along it
    cx, cy, R = S * 0.42, S * 0.6, S * 0.36
    for k in range(60):
        a0 = math.radians(242 + k * 1.0)
        a1 = math.radians(242 + (k + 1) * 1.0)
        w = S * (0.012 + 0.03 * k / 60)
        p0 = (cx + R * math.cos(a0), cy + R * math.sin(a0))
        p1 = (cx + R * math.cos(a1), cy + R * math.sin(a1))
        capsule(draw, p0, p1, w / 2, GOLD + (int(90 + 165 * k / 60),))
    for i, deg in enumerate((315, 333, 351)):
        a = math.radians(deg)
        r = S * (0.03 + 0.012 * i)
        p = (cx + (R + S * 0.02) * math.cos(a), cy + (R + S * 0.02) * math.sin(a))
        draw.ellipse((p[0] - r, p[1] - r, p[0] + r, p[1] + r), fill=GOLD + (255,))

    # hand: shadow, outline, fill
    hx, hy, hu = S * 0.42, S * 0.64, S * 0.088
    mask = hand_shape(S, hu, hx, hy, -14)
    shadow = mask.filter(ImageFilter.GaussianBlur(S * 0.012))
    shadow_layer = Image.new('RGBA', (S, S), (18, 50, 36, 0))
    shadow_layer.putalpha(shadow.point(lambda v: int(v * 0.45)))
    img = Image.alpha_composite(img, shadow_layer.transform((S, S), Image.AFFINE, (1, 0, -S * 0.006, 0, 1, -S * 0.016)))
    outline = mask.filter(ImageFilter.MaxFilter(int(S * 0.012) | 1))
    out_layer = Image.new('RGBA', (S, S), HAND_LINE + (0,))
    out_layer.putalpha(outline)
    img = Image.alpha_composite(img, out_layer)
    fill_layer = Image.new('RGBA', (S, S), HAND + (0,))
    fill_layer.putalpha(mask)
    img = Image.alpha_composite(img, fill_layer)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    img.resize((1024, 1024), Image.LANCZOS).save(OUT)
    print(f'wrote {OUT}')


if __name__ == '__main__':
    main()
