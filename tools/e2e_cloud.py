#!/usr/bin/env python3
"""E2E penyegerakan awan: dua pelayar (Laptop Kawalan + pelayar kedua) + telefon, dengan pelayan Supabase TIRUAN.
   python3 tools/e2e_cloud.py [URL]
"""
import asyncio, os, sys, json, secrets
from playwright.async_api import async_playwright

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import e2e_attendance as A  # pelayan tiruan kehadiran (rpc, EV, STAFF, H, Err)

URL = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:8080/'
SHOTS = A.SHOTS
PW = 'Majlis2026'
errors = []

DOCS, SESS = {}, {}
REV = [0]
OFFLINE = set()  # konteks yang "tiada internet"


def cloud(fn, a):
    def sess():
        d = SESS.get(a.get('p_session'))
        if not d or d['event'] != a['p_event']: raise A.Err('SESSION')
        return d['device']

    def meta(e_id, extra=None):
        e = A.EV[e_id]
        m = {'event_id': e_id, 'name': e['name'], 'code': e.get('code'), 'qr_token': e.get('qr'), 'control_device': e.get('ctl'), 'control_name': e.get('ctl_name')}
        m.update(extra or {}); return m

    def new_session(e_id, dev, name):
        t = secrets.token_hex(24); SESS[t] = {'event': e_id, 'device': dev, 'name': name}; return t

    if fn == 'ldr_cloud_enable':
        e = A.EV.get(a['p_event'])
        if not e or e['admin'] != A.H(a['p_admin_key']): raise A.Err('FORBIDDEN')
        if e['token'] != A.H(a['p_qr_token']): raise A.Err('BAD_INPUT')
        e.update(code=e.get('code') or 'RTD-' + secrets.token_hex(3).upper(), pw=a['p_password'], qr=a['p_qr_token'], ctl=a['p_device'], ctl_name=a['p_device_name'])
        return meta(a['p_event'], {'session': new_session(a['p_event'], a['p_device'], a['p_device_name'])})
    if fn == 'ldr_cloud_join':
        hit = [(i, e) for i, e in A.EV.items() if e.get('code') == a['p_code'].strip().upper() and e.get('pw') == a['p_password']]
        if not hit: raise A.Err('BAD_LOGIN')
        i = hit[0][0]
        return meta(i, {'session': new_session(i, a['p_device'], a['p_device_name'])})
    if fn == 'ldr_cloud_push':
        dev = sess(); e = A.EV[a['p_event']]; ctl = e.get('ctl') == dev
        applied, rejected = [], []
        for r in a['p_rows']:
            k = (a['p_event'], r['s'], r['k']); cur = DOCS.get(k)
            if cur and not ctl and cur['r'] > (r.get('b') or 0):
                rejected.append(cur); continue
            REV[0] += 1
            DOCS[k] = {'s': r['s'], 'k': r['k'], 'r': REV[0], 'd': None if r.get('x') else r.get('d'), 'x': bool(r.get('x'))}
            applied.append({'s': r['s'], 'k': r['k'], 'r': REV[0]})
        return {'applied': applied, 'rejected': rejected, 'control': ctl}
    if fn == 'ldr_cloud_pull':
        sess()
        rows = sorted([d for (ev, _, _), d in DOCS.items() if ev == a['p_event'] and d['r'] > (a.get('p_since') or 0)], key=lambda d: d['r'])[: a.get('p_limit') or 1000]
        return {'rows': rows, 'more': len(rows) >= (a.get('p_limit') or 1000), 'meta': meta(a['p_event'])}
    if fn == 'ldr_cloud_claim':
        dev = sess(); e = A.EV[a['p_event']]
        e['ctl'] = dev; e['ctl_name'] = [s['name'] for s in SESS.values() if s['device'] == dev][0]
        return meta(a['p_event'])
    if fn == 'ldr_cloud_leave':
        SESS.pop(a.get('p_session'), None); return None
    raise A.Err('UNKNOWN')


def rpc(fn, a):
    if fn.startswith('ldr_cloud_'): return cloud(fn, a)
    # fungsi kehadiran: kunci admin ATAU token sesi
    if 'p_admin_key' in a and a.get('p_admin_key') in SESS:
        e = A.EV[a['p_event']]
        saved = e['admin']; e['admin'] = A.H(a['p_admin_key'])
        try: return A.rpc(fn, a)
        finally: e['admin'] = saved
    return A.rpc(fn, a)


def make_handler(name):
    async def handler(route):
        req = route.request
        if req.method == 'OPTIONS':
            return await route.fulfill(status=204, headers={'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST'})
        if name in OFFLINE:
            return await route.abort('internetdisconnected')
        fn = req.url.rsplit('/', 1)[1]
        try:
            body = json.dumps(rpc(fn, json.loads(req.post_data or '{}')))
            await route.fulfill(status=200, body=body, headers={'content-type': 'application/json', 'access-control-allow-origin': '*'})
        except A.Err as e:
            await route.fulfill(status=400, body=json.dumps({'code': 'P0001', 'message': str(e)}), headers={'content-type': 'application/json', 'access-control-allow-origin': '*'})
    return handler


async def until(page, js, timeout=20):
    for _ in range(timeout * 4):
        if await page.evaluate(js):
            return
        await page.wait_for_timeout(250)
    raise AssertionError('tidak berlaku dalam %ss: %s' % (timeout, js))


STATS = "import('./js/store.js').then(S => S.stats())"


async def shot(page, name):
    await page.screenshot(path=os.path.join(SHOTS, name + '.png'))


async def browser_ctx(b, name, **kw):
    ctx = await b.new_context(viewport=kw.pop('viewport', {'width': 1440, 'height': 900}), **kw)
    await ctx.route('https://ajlxptgbwxnswcmyassf.supabase.co/**', make_handler(name))
    pg = await ctx.new_page()
    pg.on('console', lambda m: m.type == 'error' and 'status of 400' not in m.text and 'INTERNET_DISCONNECTED' not in m.text and errors.append(name + ': ' + m.text))
    pg.on('pageerror', lambda e: errors.append(name + ': ' + str(e)))
    return pg


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome')

        # ---------------------------------------------------------------- Laptop Kawalan (Edge)
        a = await browser_ctx(b, 'kawalan')
        await a.goto(URL + '#/dashboard')
        await a.wait_for_selector('#pw1')
        assert await a.locator('#auth-join').count() == 1, 'pilihan sertai majlis pada skrin pertama'
        await a.fill('#pw1', 'Admin1234'); await a.fill('#pw2', 'Admin1234'); await a.click('#auth-form button[type=submit]')
        await a.wait_for_selector('.event-card')
        await a.evaluate("""import('./js/store.js').then(async S => {
            await S.importParticipants(Array.from({length: 40}, (_, i) => ({ name: 'Staf ' + i, staffId: String(i).padStart(6, '0'), department: 'IT' })), 'skip', 'e2e');
            await S.savePrize({ category: 'Hadiah Utama', name: 'Televisyen', quantity: 1, sequence: 1 });
            await S.savePrize({ category: 'Sagu Hati', name: 'Baucar', quantity: 10, sequence: 5 });
        })""")
        await a.goto(URL + '#/settings')
        await a.wait_for_selector('#cl-enable')
        await shot(a, 'C1-cloud-off')
        await a.click('#cl-enable')
        await a.fill('#ce-name', 'Majlis Makan Malam FKM 2026')
        await a.fill('#ce-pw1', PW); await a.fill('#ce-pw2', PW)
        await a.locator('.modal-foot .btn-primary').click()
        await a.wait_for_selector('.cloud-code', timeout=30000)
        code = (await a.inner_text('.cloud-code')).strip()
        assert code.startswith('RTD-'), code
        await until(a, "import('./js/sync.js').then(s => s.state.pending === 0 && s.isControl())")
        await a.wait_for_timeout(600)
        await shot(a, 'C2-cloud-on-control')
        assert '★ Peranti Kawalan' in await a.inner_text('#net-status'), await a.inner_text('#net-status')
        assert len([d for d in DOCS.values() if d['s'] == 'participants']) == 40

        # ---------------------------------------------------------------- Pelayar kedua (Brave) — sertai
        bb = await browser_ctx(b, 'kedua')
        await bb.goto(URL + '#/dashboard')
        await bb.wait_for_selector('#auth-join')
        await bb.click('#auth-join')
        await bb.fill('#cj-code', code.lower()); await bb.fill('#cj-pw', 'salah999')
        await bb.locator('.modal-foot .btn-primary').click()
        await bb.wait_for_selector('.toast:has-text("salah")')
        await bb.fill('#cj-pw', PW)
        await bb.locator('.modal-foot .btn-primary').click()
        await bb.wait_for_selector('.event-card', timeout=30000)
        sb = await bb.evaluate(STATS)
        assert sb['total'] == 40 and sb['prizeCategories'] == 2, sb
        await bb.wait_for_timeout(500)
        await shot(bb, 'C3-second-browser-dashboard')

        # kata laluan yang sama berfungsi untuk log masuk semula di pelayar kedua
        await bb.click('#btn-lock'); await bb.goto(URL + '#/dashboard')
        await bb.wait_for_selector('#pw1'); await bb.fill('#pw1', PW); await bb.click('#auth-form button[type=submit]')
        await bb.wait_for_selector('.event-card')

        # ---------------------------------------------------------------- dua hala
        await bb.evaluate("import('./js/store.js').then(S => S.savePrize({ category: 'Hadiah Istimewa', name: 'Basikal', quantity: 1, sequence: 3 }))")
        await until(a, STATS + ".then(s => s.prizeCategories === 3)")
        await a.evaluate("import('./js/store.js').then(S => S.listPrizes()).then(ps => import('./js/store.js').then(S => S.executeDraw({ prizeId: ps.find(p => p.name === 'Baucar').id, count: 5 })))")
        await until(bb, STATS + ".then(s => s.winners === 5 && s.eligible === 35)")

        # pelayar kedua bukan Peranti Kawalan → tiada cabutan
        await bb.goto(URL + '#/draw')
        await bb.wait_for_selector('#d-warn .alert')
        assert 'bukan Peranti Kawalan' in await bb.inner_text('#d-warn')
        assert await bb.is_disabled('#d-open')
        await shot(bb, 'C4-second-browser-draw-blocked')

        # ---------------------------------------------------------------- luar talian
        OFFLINE.add('kawalan'); OFFLINE.add('kedua')
        await until(a, "import('./js/sync.js').then(s => (s.tick().catch(()=>{}), !s.state.online))")
        await a.evaluate("import('./js/store.js').then(S => S.executeDraw({ count: 3 }))")
        await until(a, "import('./js/sync.js').then(s => s.state.pending > 0)")
        await a.goto(URL + '#/dashboard'); await a.wait_for_selector('.event-card'); await a.wait_for_timeout(300)
        assert 'Luar talian' in await a.inner_text('#net-status'), await a.inner_text('#net-status')
        await shot(a, 'C5-control-offline')
        await until(bb, "import('./js/sync.js').then(s => (s.tick().catch(()=>{}), !s.state.online))")
        err = await bb.evaluate("import('./js/store.js').then(S => S.savePrize({ category: 'Sagu Hati', name: 'X', quantity: 1, sequence: 9 })).then(() => '', e => e.message)")
        assert 'BACA SAHAJA' in err, err
        OFFLINE.clear()
        await until(a, "import('./js/sync.js').then(s => s.state.pending === 0 && s.state.online)", 30)
        await until(bb, STATS + ".then(s => s.winners === 8)", 30)

        # ---------------------------------------------------------------- kehadiran QR → Peranti Kawalan → pelayar kedua
        ev = list(A.EV.keys())[0]
        A.STAFF[ev]['777777'] = {'staff_id': '777777', 'name': 'Staf QR', 'department': 'Pentadbiran', 'checked_in_at': A.now(), 'checked_in_via': 'qr', 'updated_at': A.now()}
        await until(bb, "import('./js/store.js').then(S => S.listParticipants()).then(ps => ps.some(p => p.staffId === '777777'))", 30)
        nos = await bb.evaluate("import('./js/store.js').then(S => S.listParticipants()).then(ps => ps.map(p => p.duckNo))")
        assert len(nos) == len(set(nos)), 'nombor itik unik'

        # QR boleh dipapar di pelayar kedua (token dari awan)
        await bb.goto(URL + '#/attendance')
        await bb.wait_for_selector('#a-qr svg', timeout=15000)

        # ambil alih kawalan
        await bb.goto(URL + '#/settings')
        await bb.wait_for_selector('#cl-claim')
        await bb.click('#cl-claim'); await bb.locator('.modal-foot .btn-primary').click()
        await bb.wait_for_selector('.cloud-card .tag-gold', timeout=15000)
        await until(a, "import('./js/sync.js').then(s => !s.isControl())", 20)
        await shot(bb, 'C6-second-browser-now-control')

        # telefon: tetapan awan pada 360px
        m = await browser_ctx(b, 'kedua', viewport={'width': 360, 'height': 780}, is_mobile=True, has_touch=True, device_scale_factor=2)
        await m.goto(URL + '#/dashboard')
        await m.wait_for_selector('#auth-join'); await m.click('#auth-join')
        await m.fill('#cj-code', code); await m.fill('#cj-pw', PW)
        await m.locator('.modal-foot .btn-primary').click()
        await m.wait_for_selector('.event-card', timeout=30000)
        await m.goto(URL + '#/settings'); await m.wait_for_selector('.cloud-code')
        assert await m.evaluate('document.documentElement.scrollWidth') <= 360
        await shot(m, 'C7-mobile-cloud')
        await b.close()

    bad = [e for e in errors if 'favicon' not in e]
    if bad:
        print('Ralat konsol:\n  ' + '\n  '.join(bad[:20])); sys.exit(1)
    print('✔ E2E awan lulus')

if __name__ == '__main__':
    asyncio.run(main())
