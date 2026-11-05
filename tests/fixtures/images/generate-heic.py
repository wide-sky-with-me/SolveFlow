"""Synthetic, non-exam fixtures. Regenerate with Pillow 13.0.0 + pillow-heif 1.1.1."""
from pathlib import Path
from PIL import Image, ImageDraw
from pillow_heif import register_heif_opener
register_heif_opener()
root = Path(__file__).parent
image = Image.new('RGB', (480, 320), 'white')
draw = ImageDraw.Draw(image)
draw.rectangle((0, 0, 230, 150), fill='red')
draw.rectangle((250, 0, 479, 150), fill='green')
draw.rectangle((0, 170, 230, 319), fill='blue')
draw.text((260, 210), 'Synthetic HEIC 1 2 3 4', fill='black')
image.save(root / 'synthetic.heic', format='HEIF', quality=95)
image.save(root / 'synthetic.png')
exif = image.getexif(); exif[274] = 6
image.save(root / 'rotated.heic', format='HEIF', quality=95, exif=exif.tobytes())
image.save(root / 'primary-second.heic', format='HEIF', quality=95, save_all=True,
           append_images=[Image.new('RGB', (128, 96), 'yellow')], primary_index=1)
print({path.name: path.stat().st_size for path in root.glob('*') if path.suffix != '.py'})
for label, size in [('24mp', (5712, 4284)), ('48mp', (8064, 6048))]:
    large = Image.new('RGB', size, 'white')
    painter = ImageDraw.Draw(large)
    painter.rectangle((0, 0, size[0] // 2, size[1] // 2), fill='red')
    painter.rectangle((0, size[1] // 2, size[0] // 2, size[1]), fill='blue')
    large.save(root / (label + '.heic'), format='HEIF', quality=80)
    large.save(root / (label + '.jpg'), quality=90)
    if label == '24mp':
        rotated_exif = large.getexif(); rotated_exif[274] = 6
        large.save(root / '24mp-rotated.jpg', quality=90, exif=rotated_exif.tobytes())
    large.close()
