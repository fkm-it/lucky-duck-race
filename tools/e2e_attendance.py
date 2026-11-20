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

# ---------------------------------------------------------------- pelayan tiruan
H = lambda s: hashlib.sha256((s or '').encode()).hexdigest()
now = lambda: datetime.datetime.now(datetime.timezone.utc).isoformat()
norm = lambda s: ' '.join((s or '').split()).upper()
EV, STAFF = {}, {}


class Err(Exception):
    pass


def rpc(fn, a):
    def admin():
        e = EV.get(a['p_event'])
        if not e or e['admin'] != H(a['p_admin_key']): raise Err('FORBIDDEN')
        return e

    def token():
        e = EV.get(a['p_event'])
        if not e or e['token'] != H(a['p_token']): raise Err('INVALID_QR')
        if not e['open']: raise Err('CLOSED')
        return e

    if fn == 'ldr_create_event':
        i = str(uuid.uuid4()); EV[i] = {'name': a['p_name'], 'token': H(a['p_token']), 'admin': H(a['p_admin_key']), 'open': True}; STAFF[i] = {}
        return i
    if fn == 'ldr_admin_update_event':
        e = admin()
        if a.get('p_name') is not None: e['name'] = a['p_name']
        if a.get('p_is_open') is not None: e['open'] = a['p_is_open']
        if a.get('p_new_token') is not None: e['token'] = H(a['p_new_token'])
        return None
    if fn == 'ldr_admin_upsert_staff':
        admin(); n = 0
        for r in a['p_rows']:
            sid = norm(r['staff_id']); cur = STAFF[a['p_event']].get(sid, {'checked_in_at': None, 'checked_in_via': None})
            cur.update(staff_id=sid, name=r['name'], department=r.get('department', ''), updated_at=now()); STAFF[a['p_event']][sid] = cur; n += 1
        return n
    if fn == 'ldr_admin_delete_staff':
        admin(); n = len(STAFF[a['p_event']]); STAFF[a['p_event']] = {}; return n
    if fn == 'ldr_admin_list':
        admin(); since = a.get('p_since')
        return sorted([s for s in STAFF[a['p_event']].values() if not since or s['updated_at'] > since], key=lambda s: s['updated_at'])
    if fn == 'ldr_admin_event':
        e = admin(); st = STAFF[a['p_event']].values()
        return [{'name': e['name'], 'is_open': e['open'], 'total': len(st), 'present': sum(1 for s in st if s['checked_in_at'])}]
    if fn == 'ldr_admin_set_checkin':
        admin(); s = STAFF[a['p_event']].get(norm(a['p_staff_id']))
        if not s: raise Err('NOT_FOUND')
        if a['p_present']:
            s['checked_in_at'] = s['checked_in_at'] or now(); s['checked_in_via'] = s['checked_in_via'] or 'manual'
        else:
            s['checked_in_at'] = None; s['checked_in_via'] = None
        s['updated_at'] = now(); return s['checked_in_at']
    if fn == 'ldr_event_info':
        e = EV.get(a['p_event'])
        if not e or e['token'] != H(a['p_token']): raise Err('INVALID_QR')
        return [{'name': e['name'], 'is_open': e['open']}]
    if fn == 'ldr_lookup':
        token(); s = STAFF[a['p_event']].get(norm(a['p_staff_id']))
        if not s: raise Err('NOT_FOUND')
        return [{k: s[k] for k in ('staff_id', 'name', 'department', 'checked_in_at')}]
    if fn == 'ldr_checkin':
        token(); s = STAFF[a['p_event']].get(norm(a['p_staff_id']))
        if not s: raise Err('NOT_FOUND')
        already = s['checked_in_at'] is not None
        if not already: s['checked_in_at'] = now(); s['checked_in_via'] = 'qr'; s['updated_at'] = now()
        return [{**{k: s[k] for k in ('staff_id', 'name', 'department', 'checked_in_at')}, 'already': already}]
    raise Err('UNKNOWN')


async def handler(route):
    req = route.request
    if req.method == 'OPTIONS':
        return await route.fulfill(status=204, headers={'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST'})
    fn = req.url.rsplit('/', 1)[1]
    assert req.headers.get('apikey', '').startswith('sb_publishable_'), 'apikey hilang'
    try:
        body = json.dumps(rpc(fn, json.loads(req.post_data or '{}')))
        await route.fulfill(status=200, body=body, headers={'content-type': 'application/json', 'access-control-allow-origin': '*'})
    except Err as e:
        await route.fulfill(status=400, body=json.dumps({'code': 'P0001', 'message': str(e)}), headers={'content-type': 'application/json', 'access-control-allow-origin': '*'})


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
        await admin_ctx.route('https://ajlxptgbwxnswcmyassf.supabase.co/**', handler)
        a = await admin_ctx.new_page()
        a.on('console', lambda m: m.type == 'error' and errors.append('admin: ' + m.text))
        a.on('pageerror', lambda e: errors.append('admin: ' + str(e)))
        await a.goto(URL)
        await a.fill('#pw1', PW); await a.fill('#pw2', PW); await a.click('#auth-form button')
        await a.wait_for_selector('.hero-card')

        # 1. Cipta majlis
        await a.goto(URL + '#/attendance')
        await a.wait_for_selector('#s-create')
        await shot(a, 'A1-setup')
        await a.fill('#s-name', 'Majlis Makan Malam Tahunan FKM 2026')
        await a.click('#s-create')
        # 2. Muat naik senarai staf (500)
        await a.wait_for_selector('input[name=tgt][value=attendance]:checked')
        await a.set_input_files('#file', os.path.join(ROOT, 'samples/peserta-contoh-500.xlsx'))
        await a.wait_for_selector('#do-import')
        assert 'pelayan kehadiran' in await a.inner_text('#do-import')
        await a.click('#do-import')
        await a.locator('.modal-foot .btn-primary').click()
        await a.wait_for_selector('#a-tbl tbody tr td.mono')
        await a.wait_for_timeout(800)
        await shot(a, 'A2-attendance')
        stats = await a.inner_text('#a-stats')
        assert '500' in stats, stats
        local = await a.evaluate("import('./js/store.js').then(S => S.stats()).then(s => s.total)")
        assert local == 0, 'staf belum hadir tidak patut jadi peserta'
        link = await a.get_attribute('#a-open-link', 'href')
        assert '/checkin.html#e=' in link and '&t=' in link, link

        # 3. Telefon staf
        phone_ctx = await b.new_context(viewport={'width': 360, 'height': 740}, device_scale_factor=2, is_mobile=True, has_touch=True)
        await phone_ctx.route('https://ajlxptgbwxnswcmyassf.supabase.co/**', handler)
        ph = await phone_ctx.new_page()
        ph.on('console', lambda m: m.type == 'error' and 'status of 400' not in m.text and errors.append('phone: ' + m.text))
        ph.on('pageerror', lambda e: errors.append('phone: ' + str(e)))
        await ph.goto(link)
        await ph.wait_for_selector('#ci-id')
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
        # sahkan semula → "telah disahkan"
        await ph.click('#ci-next'); await ph.fill('#ci-id', '000123'); await ph.click('#ci-go')
        await ph.wait_for_selector('.ci-already')
        await shot(ph, 'P5-already')
        await ph.reload(); await ph.wait_for_selector('#ci-id')  # token kekal dalam sesi selepas refresh

        # 4. Laptop menyegerak → peserta
        await wait_text(a, '#a-stats', 'Hadir 1')
        local = await a.evaluate("import('./js/store.js').then(S => S.listParticipants())")
        assert [x['staffId'] for x in local] == ['000123'], local
        # manual di kaunter
        await a.fill('#a-q', '000124')
        await a.wait_for_selector('[data-in="000124"]')
        await a.click('[data-in="000124"]')
        await wait_text(a, '#a-stats', 'Hadir 2')
        await a.fill('#a-q', '')
        await a.wait_for_timeout(500)
        await shot(a, 'A3-two-present')
        # batal
        await a.fill('#a-q', '000124')
        await a.click('[data-out="000124"]'); await a.locator('.modal-foot .btn-danger').click()
        await a.wait_for_selector('[data-in="000124"]', timeout=15000)
        local = await a.evaluate("import('./js/store.js').then(S => S.listParticipants())")
        assert [x['staffId'] for x in local] == ['000123'], local

        # 5. Tutup pendaftaran → telefon nampak "ditutup"
        await a.click('#a-open')
        await a.wait_for_timeout(500)
        await ph.reload(); await ph.wait_for_selector('text=Pendaftaran ditutup')
        await shot(ph, 'P6-closed')
        await a.click('#a-open'); await a.wait_for_timeout(300)

        # 6. QR skrin penuh
        await a.fill('#a-q', '')
        await a.click('#a-qr-full')
        await a.wait_for_selector('.qr-full svg')
        await a.wait_for_timeout(800)
        await shot(a, 'A4-qr-fullscreen')
        await a.keyboard.press('Escape')

        # 7. Tukar QR → pautan lama tidak sah
        await a.click('#a-rotate'); await a.locator('.modal-foot .btn-danger').click()
        await a.wait_for_timeout(1200)
        ph2 = await phone_ctx.new_page()
        await ph2.goto(link.replace('checkin.html', 'checkin.html?x=1'))
        await ph2.wait_for_selector('text=Kod QR tidak sah')
        new_link = await a.get_attribute('#a-open-link', 'href')
        assert new_link != link

        # 8. Peserta muncul dalam cabutan
        await a.goto(URL + '#/draw')
        await a.wait_for_selector('.big-num')
        assert (await a.inner_text('.big-num')).startswith('1'), await a.inner_text('.big-num')
        await b.close()

    bad = [e for e in errors if 'favicon' not in e]
    if bad:
        print('Ralat konsol:\n  ' + '\n  '.join(bad[:20])); sys.exit(1)
    print('✔ E2E kehadiran lulus')

asyncio.run(main())
