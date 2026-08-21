"""
Regenerates the app icons and social share image.

Run with:  python3 scripts/generate-icons.py
Outputs into public/ : favicon.ico, icon-192.png, icon-512.png, og-image.png

The mark is a chef hat on the app's warm orange, drawn from primitives so it
can be recoloured by editing BRAND / HAT below.
"""

from PIL import Image, ImageDraw, ImageFont
from pathlib import Path

BRAND = (224, 138, 60)      # #e08a3c, matches theme-color
BRAND_DEEP = (198, 112, 40)
HAT = (255, 250, 244)       # warm white
INK = (61, 34, 18)

ROOT = Path(__file__).resolve().parent.parent
PUBLIC = ROOT / "public"
FONT_DIR = Path("/mnt/skills/examples/canvas-design/canvas-fonts")


def draw_chef_hat(d: ImageDraw.ImageDraw, cx: int, cy: int, scale: float, colour=HAT):
    """Chef hat centred on (cx, cy). scale 1.0 ≈ 460px tall."""
    s = scale

    def px(v):
        return cx + int(v * s)

    def py(v):
        return cy + int(v * s)

    # three puffs across the crown
    for ox, oy, r in ((-112, -60, 118), (112, -60, 118), (0, -112, 136)):
        d.ellipse([px(ox - r), py(oy - r), px(ox + r), py(oy + r)], fill=colour)

    # crown base block, merges the puffs into one silhouette
    d.rounded_rectangle([px(-150), py(-60), px(150), py(70)], radius=int(40 * s), fill=colour)

    # brim
    d.rounded_rectangle([px(-124), py(60), px(124), py(196)], radius=int(30 * s), fill=colour)

    # brim pleats, drawn in the background colour so they read as folds
    for x in (-62, 0, 62):
        d.rounded_rectangle(
            [px(x - 9), py(92), px(x + 9), py(168)], radius=int(9 * s), fill=BRAND_DEEP
        )


def make_icon(size: int, padding_ratio: float = 0.0) -> Image.Image:
    """Square app icon. padding_ratio shrinks the hat for maskable safe zones."""
    SS = 4  # supersample for clean edges
    img = Image.new("RGBA", (size * SS, size * SS), BRAND + (255,))
    d = ImageDraw.Draw(img)
    inner = size * SS * (1 - padding_ratio)
    scale = (inner / 1024) * 1.5
    draw_chef_hat(d, size * SS // 2, int(size * SS * 0.52), scale)
    return img.resize((size, size), Image.LANCZOS)


def rounded_mask(size: int, radius_ratio: float) -> Image.Image:
    SS = 4
    m = Image.new("L", (size * SS, size * SS), 0)
    ImageDraw.Draw(m).rounded_rectangle(
        [0, 0, size * SS - 1, size * SS - 1], radius=int(size * SS * radius_ratio), fill=255
    )
    return m.resize((size, size), Image.LANCZOS)


def font(name: str, size: int):
    return ImageFont.truetype(str(FONT_DIR / name), size)


def make_og() -> Image.Image:
    W, H = 1200, 630
    img = Image.new("RGB", (W, H), BRAND)
    d = ImageDraw.Draw(img)

    # soft depth band behind the mark
    d.ellipse([-160, 120, 520, 800], fill=BRAND_DEEP)

    draw_chef_hat(d, 250, 300, 0.62)

    title = font("Outfit-Bold.ttf", 82)
    body = font("Outfit-Regular.ttf", 38)

    d.text((520, 214), "Bachelor", font=title, fill=HAT)
    d.text((520, 300), "Dinner Planner", font=title, fill=HAT)
    d.text((524, 400), "Weekly veg meals, groceries", font=body, fill=HAT)
    d.text((524, 448), "and kitchen tasks — together.", font=body, fill=HAT)
    return img


def main() -> None:
    PUBLIC.mkdir(exist_ok=True)

    # Two PWA variants: "any" fills the tile, "maskable" keeps the mark inside
    # the safe zone that launchers crop against.
    for size in (192, 512):
        make_icon(size, padding_ratio=0.12).convert("RGB").save(
            PUBLIC / f"icon-{size}.png", "PNG"
        )
        make_icon(size, padding_ratio=0.32).convert("RGB").save(
            PUBLIC / f"icon-{size}-maskable.png", "PNG"
        )

    # Favicon: rounded so it reads as an app tile in a browser tab.
    ico = make_icon(256, padding_ratio=0.10)
    ico.putalpha(rounded_mask(256, 0.22))
    ico.save(PUBLIC / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (256, 256)])

    # Apple touch icon must be opaque and square.
    make_icon(180, padding_ratio=0.16).convert("RGB").save(
        PUBLIC / "apple-touch-icon.png", "PNG"
    )

    make_og().save(PUBLIC / "og-image.png", "PNG", optimize=True)

    for f in (
        "favicon.ico",
        "icon-192.png",
        "icon-512.png",
        "icon-192-maskable.png",
        "icon-512-maskable.png",
        "apple-touch-icon.png",
        "og-image.png",
    ):
        print(f"  public/{f}  {(PUBLIC / f).stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
