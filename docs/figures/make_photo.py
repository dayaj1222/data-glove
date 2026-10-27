"""Annotate the photograph of the assembled glove. Writes build_photo.jpg."""
from PIL import Image, ImageDraw, ImageFont

im = Image.open("build_photo_original.png").convert("RGB")
d = ImageDraw.Draw(im)
import matplotlib
font = ImageFont.truetype(matplotlib.get_data_path() + "/fonts/ttf/DejaVuSans-Bold.ttf", 34)


def label(text, box_xy, target, anchor="lt"):
    x, y = box_xy
    w = d.textlength(text, font=font)
    pad = 10
    rect = (x, y, x + w + 2 * pad, y + 34 + 2 * pad)
    d.line([(rect[0] + (rect[2] - rect[0]) / 2, rect[1] + (rect[3] - rect[1]) / 2), target], fill=(220, 38, 38), width=6)
    d.ellipse([target[0] - 11, target[1] - 11, target[0] + 11, target[1] + 11], fill=(220, 38, 38), outline="white", width=3)
    d.rectangle(rect, fill="white", outline=(28, 27, 25), width=3)
    d.text((x + pad, y + pad - 3), text, fill=(28, 27, 25), font=font)


label("Flex sensor 1 (index)", (700, 120), (500, 400))
label("MPU-6500 IMU", (760, 640), (610, 800))
label("Flex sensor 2 (thumb)", (10, 400), (246, 760))
label("Taped dupont wires", (640, 1100), (480, 1120))
label("ESP-32 DevKit", (560, 1500), (360, 1540))
im.save("build_photo.jpg", quality=92)
print(im.size)
