"""Render maskot 3D Rockstar Duck ke icons/duck-*.webp (perlukan pelayan di :8080)."""
import base64, io, sys
from playwright.sync_api import sync_playwright
from PIL import Image

POSES = sys.argv[1:] or ['guitar', 'run', 'trophy', 'thumbs', 'head']
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=[
        '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    pg = b.new_page(viewport={'width': 1024, 'height': 1024})
    pg.on('console', lambda m: print('console:', m.text))
    pg.on('pageerror', lambda e: print('ERR:', e))
    pg.goto('http://localhost:8080/tools/mascot3d/index.html')
    pg.wait_for_function('window.ready === true', timeout=60000)
    for pose in POSES:
        url = pg.evaluate(f'window.renderPose("{pose}")')
        im = Image.open(io.BytesIO(base64.b64decode(url.split(',', 1)[1]))).convert('RGBA')
        bbox = im.getbbox()
        if bbox:
            pad = 16
            im = im.crop((max(0, bbox[0] - pad), max(0, bbox[1] - pad), min(im.width, bbox[2] + pad), min(im.height, bbox[3] + pad)))
        im.thumbnail((640, 640), Image.LANCZOS)
        im.save(f'icons/duck-{pose}.webp', 'WEBP', quality=88, method=6)
        im.save(f'/tmp/duck-{pose}.png')
        print(pose, im.size)
    b.close()
