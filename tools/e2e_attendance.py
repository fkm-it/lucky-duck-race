#!/usr/bin/env python3
"""E2E modul kehadiran (QR) dengan pelayan Supabase TIRUAN (semantik sama seperti fungsi SQL).
   python3 tools/e2e_attendance.py [URL]
"""
import asyncio, os, sys, json, uuid, hashlib, datetime
from playwright.async_api import async_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:8080/'
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOTS = os.path.join(ROOT, 'e2e-shots')
os.makedirs(SHOTS, exist_ok=True)
PW = 'Admin1234'
errors = []

# ---------------------------------------------------------------- pelayan tiruan (semantik sama seperti fungsi SQL)
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fake_supabase import FakeSupabase, IGNORE_CONSOLE, Err
FS = FakeSupabase()
EMAIL = 'admin@fkm.utm.my'
FS.add_user(EMAIL, PW, 'admin', 'Za')
FS.add_user('kaunter@fkm.utm.my', 'Kaunter123', 'registrar', 'Kaunter 1')
EV = FS.add_event('Majlis Makan Malam Tahunan FKM 2026')


async def login(page, email=EMAIL, pw=PW):
    await page.wait_for_selector('#au-email')
    await page.fill('#au-email', email)
    await page.fill('#pw1', pw)
    await page.click('#auth-form button[type=submit]')


async def wait_text(page, sel, text, timeout=15):
    for _ in range(timeout * 4):
        if text in (await page.inner_text(sel)).replace('\n', ' '):
            return
        await page.wait_for_timeout(250)
    raise AssertionError('tiada "%s" dalam %s: %s' % (text, sel, await page.inner_text(sel)))


async def shot(page, name):
    await page.screenshot(path=os.path.join(SHOTS, name + '.png'))


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome')
        admin_ctx = await b.new_context(viewport={'width': 1440, 'height': 900})
        await FS.attach(admin_ctx, 'admin')
        a = await admin_ctx.new_page()
        a.on('console', lambda m: m.type == 'error' and not any(x in m.text for x in IGNORE_CONSOLE) and errors.append('admin: ' + m.text))
        a.on('pageerror', lambda e: errors.append('admin: ' + str(e)))
        await a.goto(URL + '#/attendance')
        await login(a)
        await a.wait_for_selector('#a-qr svg', timeout=15000)
        await shot(a, 'A1-setup')

        # 1. Muat naik senarai staf (500) ke pangkalan data pusat
        await a.goto(URL + '#/staff?target=attendance')
        await a.wait_for_selector('input[name=tgt][value=attendance]:checked')
        await a.set_input_files('#file', os.path.join(ROOT, 'samples/peserta-contoh-500.xlsx'))
        await a.wait_for_selector('#do-import')
        await a.click('#do-import')
        await a.locator('.modal-foot .btn-primary').click()
        await a.wait_for_selector('#a-tbl tbody tr td.mono', timeout=60000)
        assert FS.count(EV, 'staff') == 500, FS.count(EV, 'staff')
        await a.wait_for_timeout(800)
        await shot(a, 'A2-attendance')
        await wait_text(a, '#a-stats', '500')
        local = await a.evaluate("import('./js/store.js').then(S => S.stats()).then(s => s.total)")
        assert local == 0, 'staf belum hadir tidak patut jadi peserta'
        link = await a.get_attribute('#a-open-link', 'href')
        assert '/checkin.html#e=' in link and '&t=' in link, link

        # 2. Telefon staf (tanpa log masuk, token QR sahaja)
        phone_ctx = await b.new_context(viewport={'width': 360, 'height': 740}, device_scale_factor=2, is_mobile=True, has_touch=True)
        await FS.attach(phone_ctx, 'phone')
        ph = await phone_ctx.new_page()
        ph.on('console', lambda m: m.type == 'error' and not any(x in m.text for x in IGNORE_CONSOLE) and errors.append('phone: ' + m.text))
        ph.on('pageerror', lambda e: errors.append('phone: ' + str(e)))
        await ph.goto(link)
        try:
            await ph.wait_for_selector('#ci-id', timeout=15000)
        except Exception:
            print('PHONE:', (await ph.inner_text('body'))[:300], [c for c in FS.calls if c[0] == 'phone'][-5:], errors); raise
        assert '#' not in ph.url, 'token patut dibuang dari bar alamat'
        await shot(ph, 'P1-form')
        await ph.fill('#ci-id', '999999'); await ph.click('#ci-go')
        await ph.wait_for_selector('#ci-err:has-text("tidak dijumpai")')
        await shot(ph, 'P2-not-found')
        await ph.fill('#ci-id', '000123'); await ph.click('#ci-go')
        await ph.wait_for_selector('#ci-confirm')
        await shot(ph, 'P3-confirm')
        await ph.click('#ci-confirm')
        await ph.wait_for_selector('.ci-ok')
        await shot(ph, 'P4-success')
        assert await ph.evaluate('document.documentElement.scrollWidth') <= 360
        await ph.click('#ci-next'); await ph.fill('#ci-id', '000123'); await ph.click('#ci-go')
        await ph.wait_for_selector('.ci-already')
        await shot(ph, 'P5-already')
        assert FS.count(EV, 'attendance') == 1 and FS.count(EV, 'participants') == 1, 'satu kehadiran, satu peserta (pelayan)'
        await ph.reload(); await ph.wait_for_selector('#ci-id')

        # 3. Dashboard pentadbir dikemas kini secara automatik
        await wait_text(a, '#a-stats', 'Hadir 1', 20)
        await a.goto(URL + '#/participants')
        await a.wait_for_selector('#p-tbl')
        for _ in range(40):
            local = await a.evaluate("import('./js/store.js').then(S => S.listParticipants()).then(ps => ps.map(x => x.staffId))")
            if local == ['000123']: break
            await a.wait_for_timeout(250)
        assert local == ['000123'], local

        # 4. Kaunter (Staf Pendaftaran) — sahkan manual, termasuk LUAR TALIAN
        reg_ctx = await b.new_context(viewport={'width': 1280, 'height': 860})
        await FS.attach(reg_ctx, 'kaunter')
        r = await reg_ctx.new_page()
        r.on('console', lambda m: m.type == 'error' and not any(x in m.text for x in IGNORE_CONSOLE) and errors.append('kaunter: ' + m.text))
        await r.goto(URL + '#/attendance')
        await login(r, 'kaunter@fkm.utm.my', 'Kaunter123')
        await r.wait_for_selector('#a-tbl tbody tr td.mono', timeout=30000)
        nav = await r.inner_text('.side-nav')
        assert 'Cabutan Bertuah' not in nav and 'Data Staf' not in nav, 'menu ikut peranan: ' + nav
        await r.fill('#a-q', '000124')
        await r.wait_for_selector('[data-in="000124"]')
        FS.offline.add('kaunter'); await reg_ctx.set_offline(True)
        await r.click('[data-in="000124"]')
        await r.wait_for_selector('[data-out="000124"]')
        await r.wait_for_selector('#net-pill:has-text("OFFLINE")', timeout=15000)
        await shot(r, 'A3-registrar-offline')
        assert FS.count(EV, 'attendance') == 1, 'belum dihantar semasa luar talian'
        await r.reload()                                   # muat semula semasa luar talian → rekod menunggu kekal
        await r.wait_for_selector('#a-tbl tbody tr td.mono', timeout=20000)
        pend = await r.evaluate("import('./js/sync.js').then(s => s.state.pending)")
        assert pend >= 1, 'rekod menunggu kekal selepas muat semula: %s' % pend
        FS.offline.discard('kaunter'); await reg_ctx.set_offline(False)
        await r.evaluate("import('./js/sync.js').then(s => s.tick())")
        for _ in range(40):
            if FS.count(EV, 'attendance') == 2: break
            await r.wait_for_timeout(250)
        assert FS.count(EV, 'attendance') == 2 and FS.count(EV, 'participants') == 2, 'disegerak tanpa pendua'
        await wait_text(a, '#topstats', '2', 20)

        # 5. Pentadbir batal kehadiran
        await a.goto(URL + '#/attendance')
        await a.wait_for_selector('#a-q')
        await a.fill('#a-q', '000124')
        await a.wait_for_selector('[data-out="000124"]', timeout=20000)
        await a.click('[data-out="000124"]'); await a.locator('.modal-foot .btn-danger').click()
        await a.wait_for_selector('[data-in="000124"]', timeout=15000)
        for _ in range(40):
            if FS.count(EV, 'attendance') == 1: break
            await a.wait_for_timeout(250)
        assert FS.count(EV, 'attendance') == 1 and FS.count(EV, 'participants') == 1

        # 6. Tutup pendaftaran → telefon nampak "ditutup"
        await a.fill('#a-q', '')
        await a.click('#a-open')
        await a.wait_for_timeout(600)
        await ph.reload(); await ph.wait_for_selector('text=Pendaftaran ditutup')
        await shot(ph, 'P6-closed')
        await a.click('#a-open'); await a.wait_for_timeout(400)

        # 7. QR skrin penuh
        await a.click('#a-qr-full')
        await a.wait_for_selector('.qr-full svg')
        await a.wait_for_timeout(800)
        await shot(a, 'A4-qr-fullscreen')
        await a.keyboard.press('Escape')

        # 8. Tukar QR → pautan lama tidak sah
        await a.click('#a-rotate'); await a.locator('.modal-foot .btn-danger').click()
        await a.wait_for_timeout(1500)
        ph2 = await phone_ctx.new_page()
        await ph2.goto(link.replace('checkin.html', 'checkin.html?x=1'))
        await ph2.wait_for_selector('text=Kod QR tidak sah')
        new_link = await a.get_attribute('#a-open-link', 'href')
        assert new_link != link

        # 9. Peserta muncul dalam cabutan
        await a.goto(URL + '#/draw')
        await a.wait_for_selector('.big-num')
        assert (await a.inner_text('.big-num')).startswith('1'), await a.inner_text('.big-num')
        await b.close()

    bad = [e for e in errors if 'favicon' not in e]
    if bad:
        print('Ralat konsol:\n  ' + '\n  '.join(bad[:20])); sys.exit(1)
    print('✔ E2E kehadiran lulus')

if __name__ == '__main__':
    asyncio.run(main())
