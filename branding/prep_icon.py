#!/usr/bin/env python3
"""Prep branding/logo.png into production app-icon candidates.
Produces: icon_full.png (text kept) and icon_hero.png (text cropped),
both with transparent rounded corners, plus a preview contact sheet.
"""
from PIL import Image, ImageChops, ImageDraw, ImageFilter

SRC = "logo.png"


def trim_white(img):
    rgb = img.convert("RGB")
    bg = Image.new("RGB", img.size, (255, 255, 255))
    bbox = ImageChops.difference(rgb, bg).getbbox()
    return img.crop(bbox) if bbox else img


def to_square(img):
    w, h = img.size
    s = min(w, h)
    return img.crop(((w - s) // 2, (h - s) // 2, (w - s) // 2 + s, (h - s) // 2 + s))


def detect_radius(img):
    px = img.load()
    w, _ = img.size
    for x in range(w // 2):
        r, g, b, *_ = px[x, 0]
        if r + g + b < 240:  # first non-white along top edge = corner radius
            return x
    return int(w * 0.12)


def rounded(img, radius):
    w, h = img.size
    s = 4
    mask = Image.new("L", (w * s, h * s), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, w * s - 1, h * s - 1], radius=radius * s, fill=255)
    mask = mask.resize((w, h), Image.LANCZOS)
    out = img.copy()
    out.putalpha(mask)
    return out


def save(img, name, size=1024):
    img.resize((size, size), Image.LANCZOS).save(name)


src = Image.open(SRC).convert("RGBA")
tile = to_square(trim_white(src))
S = tile.size[0]
rgb = tile.convert("RGB")

# Alpha follows the tile's real rounded shape: flood-fill the EXTERIOR white from the
# four corners (interior white text stays opaque), then erode to remove the AA fringe.
flood = rgb.copy()
for c in [(0, 0), (S - 1, 0), (0, S - 1), (S - 1, S - 1)]:
    ImageDraw.floodfill(flood, c, (255, 0, 255), thresh=45)
exterior = ImageChops.difference(flood, rgb).convert("L").point(lambda p: 255 if p > 10 else 0)
alpha = exterior.point(lambda p: 0 if p else 255)
alpha = alpha.filter(ImageFilter.MinFilter(7))     # erode ~3px -> kill light fringe
alpha = alpha.filter(ImageFilter.GaussianBlur(1))  # soften edge back
print(f"tile={S}px")

# A) full — clean rounded tile, text kept
full = tile.copy()
full.putalpha(alpha)
save(full, "icon_full.png")

# B) hero — interior square (skips tile edges + drops bottom text), fresh rounding
top, bottom = int(S * 0.05), int(S * 0.74)
h = bottom - top
x0 = (S - h) // 2
hero = rounded(tile.crop((x0, top, x0 + h, top + h)), int(h * 0.16))
save(hero, "icon_hero.png")

# preview on magenta so ANY white fringe is obvious
sheet = Image.new("RGBA", (860, 620), (200, 0, 200, 255))
for i, name in enumerate(["icon_full.png", "icon_hero.png"]):
    im = Image.open(name)
    x = 40 + i * 420
    sheet.alpha_composite(im.resize((320, 320), Image.LANCZOS), (x, 30))
    sheet.alpha_composite(im.resize((96, 96), Image.LANCZOS), (x, 380))
    sheet.alpha_composite(im.resize((48, 48), Image.LANCZOS), (x + 120, 400))
    sheet.alpha_composite(im.resize((32, 32), Image.LANCZOS), (x + 200, 408))
sheet.convert("RGB").save("compare.png")
print("wrote icon_full.png, icon_hero.png, compare.png")
