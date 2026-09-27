"""Transparent crops of the Family A coach for Home and the AI coach (no redrawing, pixels come from the sources).

    python scripts/visual/coach_cutouts.py        (Python 3.10+ with numpy, scipy and Pillow; not part of pnpm)

Writes public/assets/coach/coach-welcome.webp and coach-avatar.webp; see src/components/coach/coachIdentity.ts.

Known-background matting: the sources are flat illustrations on an off-white canvas W with a pale-blue disc D, so
every background pixel lies on the RGB segment W-D. Background = pixels close to that segment that are connected to
the image border, plus enclosed pockets that are clearly background (inside the loose hair above the shoulders, or
large ones such as the gap between the legs). Eye whites and catchlights are near-white too; they sit in the
protected eye band and stay opaque. Edge alpha is solved by unmixing each boundary pixel C = a*F + (1-a)*B with
B = nearest background colour and F = nearest solid figure colour (or the dark hair colour, whichever explains the
pixel better), and edge colours are decontaminated. Tuned for light surfaces, which is where FormPilot shows them.
"""
import hashlib
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = Path(__file__).resolve().parents[2]
ASSETS = ROOT / 'public' / 'assets'

# Both Family A sources share one canvas (1086 x 1448) and one head placement.
HAIR_REGION_MAX_Y = 400          # enclosed pockets above this line are hair loops
EYE_BAND = (470, 205, 600, 255)  # x0, y0, x1, y1: eye whites and catchlights stay opaque
LARGE_POCKET = 2500              # enclosed background this large is background anywhere (leg gap)

JOBS = [
    # output, Family A source, crop box (x0, y0, x1, y1), output width (None = source pixels)
    ('coach-welcome.webp', 'coach-shoulder-rotation.png', (160, 36, 925, 780), None),  # raised open palms, hands to hips
    ('coach-avatar.webp', 'overhead-raise-demo-start.png', (363, 36, 703, 376), 192),  # identity baseline, head crop
]


def segment_distance(img, w, d):
    v = d - w
    t = np.clip(((img - w) @ v) / (v @ v), 0.0, 1.0)
    return np.linalg.norm(img - (w + t[..., None] * v), axis=-1)


def cutout(src, t_bg=14.0, t_fg=34.0, band=3, hair_band=18, max_residual=26.0):
    rgb = np.asarray(Image.open(src).convert('RGB')).astype(np.float64)
    W = np.array([rgb[4, 4], rgb[4, -5], rgb[-5, 4], rgb[-5, -5]]).mean(axis=0)
    D = np.median(rgb[560:760, 180:260].reshape(-1, 3), axis=0)
    dist = segment_distance(rgb, W, D)

    candidate = dist < t_bg
    labels, n = ndimage.label(candidate)
    border = np.unique(np.concatenate([labels[0], labels[-1], labels[:, 0], labels[:, -1]]))
    is_bg = np.zeros(n + 1, bool)
    is_bg[border[border > 0]] = True
    index = np.arange(1, n + 1)
    sizes = ndimage.sum(candidate, labels, index)
    cy, cx = np.array(ndimage.center_of_mass(candidate, labels, index)).T
    in_eyes = (cx >= EYE_BAND[0]) & (cx <= EYE_BAND[2]) & (cy >= EYE_BAND[1]) & (cy <= EYE_BAND[3])
    is_bg[1:] |= ((cy < HAIR_REGION_MAX_Y) & ~in_eyes) | (sizes >= LARGE_POCKET)
    fg = ~(is_bg[labels] & candidate)
    fg_labels, n_fg = ndimage.label(fg)
    if n_fg > 1:  # drop specks of noise left in the background
        keep = np.zeros(n_fg + 1, bool)
        keep[1:] = ndimage.sum(fg, fg_labels, range(1, n_fg + 1)) >= 400
        fg = keep[fg_labels]
    bg = ~fg

    solid = ndimage.binary_erosion(fg, iterations=band) & (dist > t_fg)
    _, bg_idx = ndimage.distance_transform_edt(~bg, return_indices=True)
    B = rgb[bg_idx[0], bg_idx[1]]
    _, fg_idx = ndimage.distance_transform_edt(~solid, return_indices=True)
    F = rgb[fg_idx[0], fg_idx[1]]

    hair_rows = np.arange(rgb.shape[0])[:, None] < HAIR_REGION_MAX_Y
    edge = (ndimage.distance_transform_edt(~bg) <= np.where(hair_rows, hair_band, band) + 0.5) & fg
    ring = ndimage.binary_dilation(fg, iterations=1) & bg

    def unmix(figure_colour):
        fb = figure_colour - B
        denom = np.einsum('ijk,ijk->ij', fb, fb)
        a = np.clip(np.einsum('ijk,ijk->ij', rgb - B, fb) / np.maximum(denom, 1e-6), 0.0, 1.0)
        residual = np.linalg.norm(rgb - (B + a[..., None] * fb), axis=-1)
        return a, np.where(denom > 30.0 ** 2, residual, np.inf)

    a, residual = unmix(F)
    # Loose strands near the ears: the nearest solid colour is skin, but the pixel is hair over background.
    lum = rgb @ np.array([0.299, 0.587, 0.114])
    hair = np.median(rgb[solid & hair_rows & (lum < 90)], axis=0)
    a2, residual2 = unmix(np.broadcast_to(hair, rgb.shape))
    use_hair = hair_rows & (residual2 < residual)
    a = np.where(use_hair, a2, a)
    residual = np.where(use_hair, residual2, residual)
    F = np.where(use_hair[..., None], hair, F)
    # Only a pixel that really lies between its background and figure colours is a mix; anything off that line
    # (skin next to a hair strand, say) is solid figure.
    reliable = residual < max_residual
    alpha = np.where(fg, 1.0, 0.0)
    alpha = np.where(edge & reliable, a, alpha)
    alpha = np.where(ring & reliable, np.clip(a, 0.0, 0.6), alpha)

    unmixed = np.clip((rgb - (1.0 - alpha[..., None]) * B) / np.maximum(alpha, 1e-3)[..., None], 0, 255)
    mix = np.clip((alpha - 0.35) / 0.4, 0, 1)[..., None]
    colour = np.where((edge | ring)[..., None], unmixed * mix + F * (1 - mix), rgb)
    return Image.fromarray(np.dstack([colour, alpha * 255.0]).round().astype(np.uint8), 'RGBA')


def main():
    out_dir = ASSETS / 'coach'
    out_dir.mkdir(parents=True, exist_ok=True)
    for name, source, box, width in JOBS:
        src = ASSETS / source
        image = cutout(src).crop(box)
        alpha = image.getchannel('A')
        # Only the bottom edge may cut the figure.
        for side, strip in (('top', (0, 0, image.width, 1)), ('left', (0, 0, 1, image.height)), ('right', (image.width - 1, 0, image.width, image.height))):
            assert alpha.crop(strip).getextrema()[1] == 0, f'{name}: figure touches the {side} edge'
        if width:
            image = image.convert('RGBa').resize((width, round(image.height * width / image.width)), Image.LANCZOS).convert('RGBA')
        path = out_dir / name
        image.save(path, 'WEBP', quality=90, alpha_quality=100, method=6)
        sha = hashlib.sha256(src.read_bytes()).hexdigest()
        print(f'{name}: {image.width}x{image.height}, {path.stat().st_size} B, from {source} (sha256 {sha[:8]}...) box {box}')


if __name__ == '__main__':
    main()
