#!/usr/bin/env python3
"""Jana 4 variasi maskot Rockstar Duck (SVG) daripada bahagian dikongsi.
   python3 tools/make-mascots.py  →  icons/duck-guitar.svg, duck-run.svg, duck-trophy.svg, duck-thumbs.svg
"""
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

DEFS = '''<defs>
  <radialGradient id="y" cx="38%" cy="30%" r="75%"><stop offset="0" stop-color="#FFF7B0"/><stop offset=".5" stop-color="#FFD72E"/><stop offset="1" stop-color="#F2A900"/></radialGradient>
  <linearGradient id="jk" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3A3A44"/><stop offset=".35" stop-color="#16161C"/><stop offset="1" stop-color="#050507"/></linearGradient>
  <linearGradient id="mh" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FF4D5E"/><stop offset="1" stop-color="#C4001A"/></linearGradient>
  <linearGradient id="bk" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFA640"/><stop offset="1" stop-color="#F0640A"/></linearGradient>
  <linearGradient id="gl" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#4B5563"/><stop offset=".45" stop-color="#0B0B0F"/><stop offset="1" stop-color="#1F2937"/></linearGradient>
  <linearGradient id="gt" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFD166"/><stop offset=".35" stop-color="#F43F1E"/><stop offset="1" stop-color="#7F1D1D"/></linearGradient>
  <linearGradient id="au" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFF1A8"/><stop offset=".45" stop-color="#E6B325"/><stop offset="1" stop-color="#9A6B00"/></linearGradient>
  <linearGradient id="bt" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3A3A44"/><stop offset="1" stop-color="#050507"/></linearGradient>
</defs>'''

# ---------------------------------------------------------------- bahagian
def mohawk(cx, top):
    spikes = []
    xs = [-58, -38, -16, 8, 32, 54]
    hs = [58, 76, 90, 88, 72, 50]
    for i, (dx, h) in enumerate(zip(xs, hs)):
        x = cx + dx
        spikes.append(f'<path d="M{x-14} {top+40} Q{x-10} {top+20-h*0.5} {x-26+i*3} {top+38-h} Q{x+4} {top+10-h*0.3} {x+20} {top+42} Z" fill="url(#mh)"/>')
    return '<g>' + ''.join(spikes) + '</g>'


def head(cx=200, cy=150, tilt=0):
    return f'''<g transform="rotate({tilt} {cx} {cy})">
  {mohawk(cx - 6, cy - 120)}
  <circle cx="{cx}" cy="{cy}" r="84" fill="url(#y)"/>
  <!-- paruh terbuka (menjerit rock) -->
  <path d="M{cx+30} {cy+16} C{cx+80} {cy-2} {cx+128} {cy+6} {cx+132} {cy+24} C{cx+118} {cy+34} {cx+74} {cy+36} {cx+34} {cy+34} Z" fill="url(#bk)"/>
  <path d="M{cx+36} {cy+38} C{cx+70} {cy+40} {cx+112} {cy+38} {cx+124} {cy+34} C{cx+116} {cy+70} {cx+70} {cy+84} {cx+40} {cy+66} Z" fill="url(#bk)"/>
  <path d="M{cx+44} {cy+40} C{cx+74} {cy+44} {cx+104} {cy+42} {cx+114} {cy+40} C{cx+104} {cy+62} {cx+74} {cy+70} {cx+50} {cy+60} Z" fill="#9F1239"/>
  <path d="M{cx+56} {cy+56} C{cx+72} {cy+50} {cx+92} {cy+52} {cx+100} {cy+56} C{cx+88} {cy+66} {cx+68} {cy+66} {cx+56} {cy+56} Z" fill="#FB7185"/>
  <!-- cermin mata hitam -->
  <path d="M{cx-58} {cy-26} L{cx+108} {cy-38}" stroke="#0B0B0F" stroke-width="10" stroke-linecap="round"/>
  <rect x="{cx-30}" y="{cy-36}" width="62" height="40" rx="10" fill="url(#gl)" stroke="#0B0B0F" stroke-width="5"/>
  <rect x="{cx+42}" y="{cy-42}" width="60" height="40" rx="10" fill="url(#gl)" stroke="#0B0B0F" stroke-width="5"/>
  <path d="M{cx-22} {cy-28} l20 0" stroke="#fff" stroke-width="4" stroke-linecap="round" opacity=".55"/>
  <path d="M{cx+50} {cy-34} l20 -1" stroke="#fff" stroke-width="4" stroke-linecap="round" opacity=".55"/>
</g>'''


def torso(cx=200, cy=310, tilt=0):
    studs = ''.join(f'<circle cx="{cx-70+i*20}" cy="{cy-58+(i%2)*4}" r="3.6" fill="#E5E7EB"/>' for i in range(8))
    return f'''<g transform="rotate({tilt} {cx} {cy})">
  <ellipse cx="{cx}" cy="{cy}" rx="96" ry="84" fill="url(#jk)"/>
  <!-- baju-T merah + kilat -->
  <path d="M{cx-30} {cy-70} L{cx+34} {cy-70} L{cx+18} {cy+40} L{cx-14} {cy+40} Z" fill="#B91C1C"/>
  <path d="M{cx+8} {cy-52} L{cx-10} {cy-12} L{cx+4} {cy-12} L{cx-8} {cy+22} L{cx+18} {cy-22} L{cx+4} {cy-22} L{cx+16} {cy-52} Z" fill="#fff"/>
  <!-- kolar & zip -->
  <path d="M{cx-30} {cy-72} L{cx-62} {cy-40} L{cx-34} {cy+20} Z" fill="#26262E"/>
  <path d="M{cx+34} {cy-72} L{cx+66} {cy-40} L{cx+30} {cy+20} Z" fill="#26262E"/>
  <path d="M{cx+30} {cy+20} L{cx+44} {cy+74}" stroke="#9CA3AF" stroke-width="4" stroke-dasharray="4 3"/>
  {studs}
  <!-- rantai -->
  <path d="M{cx-60} {cy+56} C{cx-30} {cy+86} {cx+10} {cy+84} {cx+40} {cy+60}" fill="none" stroke="#D1D5DB" stroke-width="5" stroke-dasharray="7 4" stroke-linecap="round"/>
</g>'''


def tail(cx=110, cy=300):
    return f'<path d="M{cx} {cy} C{cx-40} {cy-20} {cx-52} {cy-56} {cx-30} {cy-70} C{cx-22} {cy-40} {cx-4} {cy-28} {cx+16} {cy-22} Z" fill="url(#y)"/>'


def leg(x, y, ang=0, boot_dx=0):
    return f'''<g transform="rotate({ang} {x} {y})">
  <rect x="{x-13}" y="{y}" width="26" height="46" rx="10" fill="url(#y)"/>
  <path d="M{x-26} {y+36} h44 a10 10 0 0 1 10 10 v14 h22 a14 14 0 0 1 14 14 v8 h-104 v-10 a12 12 0 0 1 4 -10 z" fill="url(#bt)"/>
  <rect x="{x-28}" y="{y+76}" width="106" height="10" rx="4" fill="#111"/>
  <circle cx="{x-14}" cy="{y+50}" r="3" fill="#D1D5DB"/><circle cx="{x}" cy="{y+50}" r="3" fill="#D1D5DB"/>
  <rect x="{x-24}" y="{y+56}" width="40" height="6" rx="2" fill="#4B5563"/>
</g>'''


def mitt(x, y, ang=0, s=1):
    return f'<g transform="translate({x} {y}) rotate({ang}) scale({s})"><ellipse cx="0" cy="0" rx="22" ry="19" fill="url(#y)"/></g>'


def sleeve(x1, y1, x2, y2):
    return f'<path d="M{x1} {y1} L{x2} {y2}" stroke="#111" stroke-width="34" stroke-linecap="round"/><path d="M{x1} {y1} L{x2} {y2}" stroke="#2A2A33" stroke-width="22" stroke-linecap="round" opacity=".6"/>'


def wristband(x, y, ang=0):
    return f'<g transform="translate({x} {y}) rotate({ang})"><rect x="-17" y="-8" width="34" height="16" rx="4" fill="#0B0B0F"/><circle cx="-8" cy="0" r="3" fill="#D1D5DB"/><circle cx="2" cy="0" r="3" fill="#D1D5DB"/><circle cx="12" cy="0" r="3" fill="#D1D5DB"/></g>'


def horns_hand(x, y, ang=0):
    """Isyarat rock (jari telunjuk & kelingking ke atas)."""
    return f'''<g transform="translate({x} {y}) rotate({ang})">
  <ellipse cx="0" cy="8" rx="22" ry="18" fill="url(#y)"/>
  <rect x="-20" y="-34" width="12" height="40" rx="6" fill="url(#y)"/>
  <rect x="9" y="-30" width="12" height="36" rx="6" fill="url(#y)"/>
  <path d="M-8 -2 q8 6 18 0" stroke="#E0A100" stroke-width="3" fill="none"/>
</g>'''


def thumb_hand(x, y, ang=0, s=1):
    return f'''<g transform="translate({x} {y}) rotate({ang}) scale({s})">
  <rect x="-22" y="-8" width="40" height="34" rx="14" fill="url(#y)"/>
  <rect x="-10" y="-44" width="15" height="42" rx="7.5" fill="url(#y)"/>
  <path d="M-18 6 h30 M-18 16 h30" stroke="#E0A100" stroke-width="3"/>
</g>'''


def guitar(x, y, ang, s=1):
    return f'''<g transform="translate({x} {y}) rotate({ang}) scale({s})">
  <rect x="40" y="-7" width="150" height="14" rx="3" fill="#3F2A1D"/>
  <path d="M40 -7 h150" stroke="#E5E7EB" stroke-width="1.2" opacity=".6"/>
  {''.join(f'<rect x="{50+i*16}" y="-7" width="2" height="14" fill="#D1D5DB"/>' for i in range(9))}
  <path d="M186 -12 h30 l6 -6 v36 l-6 -6 h-30 z" fill="#B91C1C"/>
  <path d="M-62 -40 C-30 -60 4 -46 14 -30 C24 -42 50 -40 52 -18 C54 6 30 10 22 16 C34 34 22 62 -10 62 C-56 62 -84 34 -78 2 C-74 -16 -78 -30 -62 -40 Z" fill="url(#gt)" stroke="#450A0A" stroke-width="3"/>
  <rect x="-30" y="-14" width="10" height="28" rx="2" fill="#111"/><rect x="-10" y="-14" width="10" height="28" rx="2" fill="#111"/>
  <rect x="12" y="-10" width="16" height="20" rx="2" fill="#D1D5DB"/>
  <circle cx="-40" cy="34" r="5" fill="#E5E7EB"/><circle cx="-24" cy="42" r="5" fill="#E5E7EB"/>
</g>'''


def trophy(x, y, s=1):
    return f'''<g transform="translate({x} {y}) scale({s})">
  <path d="M-46 -40 C-82 -40 -82 4 -40 6" fill="none" stroke="url(#au)" stroke-width="10"/>
  <path d="M46 -40 C82 -40 82 4 40 6" fill="none" stroke="url(#au)" stroke-width="10"/>
  <path d="M-50 -56 h100 v20 c0 44 -26 64 -50 64 s-50 -20 -50 -64 z" fill="url(#au)" stroke="#7A5200" stroke-width="3"/>
  <path d="M-30 -48 c0 30 10 50 20 56" stroke="#FFF8D0" stroke-width="6" fill="none" opacity=".7" stroke-linecap="round"/>
  <rect x="-10" y="26" width="20" height="24" fill="url(#au)"/>
  <rect x="-36" y="48" width="72" height="22" rx="4" fill="url(#au)" stroke="#7A5200" stroke-width="3"/>
  <path d="M0 -40 l7 14 15 2 -11 11 3 15 -14 -7 -14 7 3 -15 -11 -11 15 -2z" fill="#FFF8D0"/>
</g>'''


def svg(body, vb='-20 -60 500 530'):
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vb}">{DEFS}{body}</svg>'


# ---------------------------------------------------------------- variasi
def v_guitar():
    return svg(''.join([
        tail(118, 312),
        leg(165, 370, 8), leg(240, 370, -6),
        sleeve(140, 270, 92, 170),
        torso(200, 310),
        horns_hand(84, 150, -12), wristband(92, 182, -20),
        head(205, 150),
        guitar(214, 330, -28, 1.0),
        sleeve(262, 280, 300, 236), mitt(306, 226, 0),
    ]))


def v_run():
    lines = ''.join(f'<path d="M{20+i*6} {250+i*42} h{70-i*12}" stroke="#FF1E3C" stroke-width="6" stroke-linecap="round" opacity="{.8-i*.15}"/>' for i in range(4))
    return svg(''.join([
        lines,
        guitar(180, 250, -150, .72),
        tail(128, 300),
        leg(178, 360, 38), leg(236, 362, -34),
        sleeve(150, 280, 108, 330), mitt(102, 340, 0),
        torso(205, 300, 10),
        head(215, 142, 8),
        sleeve(262, 270, 308, 222), mitt(314, 214, 0),
    ]))


def v_trophy():
    return svg(''.join([
        tail(118, 312),
        leg(165, 370, 4), leg(240, 370, -4),
        sleeve(132, 262, 128, 40), sleeve(272, 262, 276, 40),
        torso(200, 310),
        head(200, 168),
        trophy(202, -56, 1.25),
        mitt(140, 8, 0), mitt(264, 8, 0),
        wristband(132, 44, 0), wristband(272, 44, 0),
    ]), vb='-20 -150 500 620')


def v_thumbs():
    return svg(''.join([
        tail(118, 312),
        leg(165, 370, 6), leg(240, 370, -6),
        sleeve(140, 276, 112, 330), mitt(110, 338, 0),
        torso(200, 310),
        head(198, 150, -4),
        sleeve(266, 276, 336, 236), thumb_hand(356, 214, 10, 1.45), wristband(330, 244, -40),
    ]))


if __name__ == '__main__':
    for name, fn in [('duck-guitar', v_guitar), ('duck-run', v_run), ('duck-trophy', v_trophy), ('duck-thumbs', v_thumbs)]:
        with open(os.path.join(ROOT, 'icons', name + '.svg'), 'w') as f:
            f.write(fn())
    print('ok')


LOGO = '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 700 300">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFF6C8"/><stop offset=".38" stop-color="#F5C842"/><stop offset=".55" stop-color="#B8860B"/><stop offset=".72" stop-color="#F2D06B"/><stop offset="1" stop-color="#8A6200"/></linearGradient>
    <linearGradient id="r" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FF6B7D"/><stop offset="1" stop-color="#E0001B"/></linearGradient>
    <filter id="glow" x="-20%" y="-40%" width="140%" height="180%"><feGaussianBlur stdDeviation="7" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  </defs>
  <!-- kilat -->
  <path d="M618 20 L582 108 L614 108 L592 182 L664 84 L628 84 L654 20 Z" fill="url(#r)" filter="url(#glow)"/><path d="M84 30 L56 100 L80 100 L64 156 L118 80 L92 80 L112 30 Z" fill="#9D4EDD" filter="url(#glow)"/>
  <g font-family="'Arial Black','Segoe UI Black',Impact,system-ui,sans-serif" font-weight="900" text-anchor="middle">
    <text x="350" y="150" font-size="150" letter-spacing="4" fill="#000" stroke="#000" stroke-width="22" stroke-linejoin="round" transform="skewX(-8)">ROCK</text>
    <text x="350" y="150" font-size="150" letter-spacing="4" fill="url(#g)" stroke="#3A2A00" stroke-width="4" stroke-linejoin="round" transform="skewX(-8)">ROCK</text>
    <text x="372" y="262" font-size="96" letter-spacing="6" fill="none" stroke="#FF1E3C" stroke-width="14" stroke-linejoin="round" filter="url(#glow)" opacity=".85" transform="skewX(-8)">THE DRAW</text>
    <text x="372" y="262" font-size="96" letter-spacing="6" fill="#fff" stroke="#FF1E3C" stroke-width="4" stroke-linejoin="round" transform="skewX(-8)">THE DRAW</text>
  </g>
</svg>'''

ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">' + DEFS + '''
  <rect width="512" height="512" rx="112" fill="#0A0A0F"/>
  <rect x="10" y="10" width="492" height="492" rx="104" fill="none" stroke="#FF1E3C" stroke-width="10" opacity=".85"/>
  <path d="M410 60 L370 160 L404 160 L380 236 L452 132 L414 132 L440 60 Z" fill="#9D4EDD" opacity=".9"/>
  <g transform="translate(-6 96) scale(1.3)">''' + head(170, 150) + '''</g>
</svg>'''

if __name__ == '__main__':
    with open(os.path.join(ROOT, 'icons', 'logo.svg'), 'w') as f: f.write(LOGO)
    with open(os.path.join(ROOT, 'icons', 'icon.svg'), 'w') as f: f.write(ICON)
