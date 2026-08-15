"""Generate the DeepSeek Harness Desktop app icon (1024x1024 PNG)."""
from PIL import Image, ImageDraw

SIZE = 1024
R = 220  # corner radius

# 1) gradient background (opaque, full rectangle)
bg = Image.new("RGB", (SIZE, SIZE), (0, 0, 0))
bd = ImageDraw.Draw(bg)
BG_TOP = (77, 107, 254)
BG_BOTTOM = (30, 58, 138)
for y in range(SIZE):
    t = y / SIZE
    r = int(BG_TOP[0] + (BG_BOTTOM[0] - BG_TOP[0]) * t)
    g = int(BG_TOP[1] + (BG_BOTTOM[1] - BG_TOP[1]) * t)
    b = int(BG_TOP[2] + (BG_BOTTOM[2] - BG_TOP[2]) * t)
    bd.line([(0, y), (SIZE, y)], fill=(r, g, b))

# 2) rounded mask
mask = Image.new("L", (SIZE, SIZE), 0)
ImageDraw.Draw(mask).rounded_rectangle([0, 0, SIZE - 1, SIZE - 1], radius=R, fill=255)

# 3) compose: gradient RGB + rounded alpha
IMG = bg.convert("RGBA")
IMG.putalpha(mask)

# 4) whale glyph
D = ImageDraw.Draw(IMG)
WHITE = (255, 255, 255, 255)
BLACK = (13, 17, 23, 255)

# Body (vertical capsule)
cx, cy = 470, 512
bw, bh = 250, 560
D.rounded_rectangle(
    [cx - bw // 2, cy - bh // 2, cx + bw // 2, cy + bh // 2],
    radius=120, fill=WHITE,
)

# Tail fin
tx, ty = cx + bw // 2 - 30, cy + bh // 2 - 40
D.polygon([
    (tx, ty),
    (tx + 170, ty - 130),
    (tx + 130, ty + 10),
    (tx + 195, ty + 115),
    (tx + 50, ty + 30),
], fill=WHITE)

# Eye
D.ellipse([cx - 22, cy - 150, cx + 22, cy - 106], fill=BLACK)

# "dsh" wordmark (small, top-left)
D.rectangle([0, 0, 0, 0], fill=BLACK)

IMG.save("icon.png")
print(f"icon.png written: {SIZE}x{SIZE}")

# Windows installer/executable icons require a real .ico (NSIS rejects PNG).
IMG.save(
    "icon.ico",
    sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
)
print("icon.ico written (multi-size)")
