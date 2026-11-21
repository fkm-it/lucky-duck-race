#!/usr/bin/env python3
"""E2E v4 — UJIAN PENERIMAAN pangkalan data pusat (spesifikasi §10), dengan pelayan Supabase TIRUAN
yang meniru fungsi SQL (tools/fake_supabase.py). Beberapa konteks pelayar = pelayar / komputer berbeza.

   python3 tools/e2e_cloud.py [URL]
Mencetak laporan ujian (UJIAN 1–10) dan menyimpan tangkapan skrin C*.png dalam e2e-shots/.
"""
import asyncio, os, sys, json
from playwright.async_api import async_playwright

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fake_supabase import FakeSupabase, IGNORE_CONSOLE

URL = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:8080/'
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOTS = os.path.join(ROOT, 'e2e-shots')
os.makedirs(SHOTS, exist_ok=True)
errors, report = [], []
FS = FakeSupabase()
ADMIN, APW = 'admin@fkm.utm.my', 'Admin1234'
FS.add_user(ADMIN, APW, 'admin', 'Za')
FS.add_user('operator@fkm.utm.my', 'Operator123', 'operator', 'Operator Pentas')
FS.add_user('kaunter1@fkm.utm.my', 'Kaunter123', 'registrar', 'Kaunter 1')
FS.add_user('kaunter2@fkm.utm.my', 'Kaunter123', 'registrar', 'Kaunter 2')
EV = FS.add_event('Majlis Anugerah Inspirasi Mekanikal 2026')
# 201 staf dalam senarai kehadiran (seperti majlis sebenar)
for i in range(1, 202):
    FS.put(EV, 'staff', 'S%04d' % i, {'name': 'Staf %d' % i, 'department': 'FKM'})


def ok(n, text):
    report.append('UJIAN %s: LULUS — %s' % (n, text)); print(report[-1])


async def shot(page, name):
    await page.screenshot(path=os.path.join(SHOTS, name + '.png'))


async def until(page, js, timeout=25):
    for _ in range(timeout * 4):
        if await page.evaluate(js):
            return
        await page.wait_for_timeout(250)
    raise AssertionError('tidak berlaku dalam %ss: %s' % (timeout, js))


STATS = "import('./js/store.js').then(S => S.stats())"
WINNERS = "import('./js/store.js').then(S => S.listWinners()).then(ws => ws.map(w => w.id + ':' + w.staffId + ':' + (w.revoked ? 'R' : 'A')).sort().join(','))"


async def browser(b, name, **kw):
    ctx = await b.new_context(viewport=kw.pop('viewport', {'width': 1440, 'height': 900}), **kw)
    await FS.attach(ctx, name)
    pg = await ctx.new_page()
    pg.on('console', lambda m: m.type == 'error' and not any(x in m.text for x in IGNORE_CONSOLE) and errors.append(name + ': ' + m.text))
    pg.on('pageerror', lambda e: errors.append(name + ': ' + str(e)))
    return ctx, pg


async def login(page, email, pw, route='dashboard'):
    await page.goto(URL + '#/' + route)
    await page.wait_for_selector('#au-email')
    await page.fill('#au-email', email)
    await page.fill('#pw1', pw)
    await page.click('#auth-form button[type=submit]')


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome')

        # ---------------------------------------------------------------- Migrasi: pelayar dengan data versi lama
        lctx, L = await browser(b, 'lama')
        await L.goto(URL + '#/home'); await L.wait_for_selector('.home-cta')
        await L.evaluate("""import('./js/store.js').then(async S => {
            await S.importParticipants(Array.from({length: 12}, (_, i) => ({ name: 'Peserta Lama ' + i, staffId: 'L' + String(i).padStart(3, '0'), department: 'IT' })), 'skip', 'lama.xlsx');
            await S.savePrize({ category: 'Hadiah Utama', name: 'Televisyen 55"', quantity: 1, sequence: 1 });
        })""")
        await login(L, ADMIN, APW)
        await L.wait_for_selector('.modal:has-text("Data dalam pelayar ini")', timeout=20000)
        await shot(L, 'C0-migrate-prompt')
        await L.locator('.modal-foot .btn-primary').click()
        await L.wait_for_selector('.toast:has-text("berjaya dipindahkan")', timeout=60000)
        assert FS.count(EV, 'participants') == 12 and FS.count(EV, 'prizes') == 1
        ok('M', 'data pelayar versi lama (12 peserta, 1 hadiah) dipindahkan ke pangkalan data pusat tanpa dipadam')
        await lctx.close()

        # ---------------------------------------------------------------- UJIAN 1: Chrome import 201 peserta
        actx, A = await browser(b, 'chrome')
        await login(A, ADMIN, APW)
        await A.wait_for_selector('.event-card')
        await A.evaluate("""import('./js/store.js').then(S => S.importParticipants(Array.from({length: 201}, (_, i) => ({ name: 'Staf ' + (i + 1), staffId: 'S' + String(i + 1).padStart(4, '0'), department: 'FKM' })), 'skip', 'staf.xlsx'))""")
        await until(A, "import('./js/sync.js').then(s => s.state.pending === 0)")
        assert FS.count(EV, 'participants') == 213, FS.count(EV, 'participants')
        ok(1, 'Chrome mengimport 201 staf → pangkalan data pusat ada %d peserta (201 + 12 dimigrasi)' % FS.count(EV, 'participants'))

        # ---------------------------------------------------------------- UJIAN 2: Edge memaparkan jumlah sama
        ectx, E = await browser(b, 'edge')
        await login(E, ADMIN, APW)
        await E.wait_for_selector('.event-card')
        await until(E, STATS + ".then(s => s.total === 213)")
        sa, se = await A.evaluate(STATS), await E.evaluate(STATS)
        assert (sa['total'], sa['eligible'], sa['winners'], sa['prizeCategories']) == (se['total'], se['eligible'], se['winners'], se['prizeCategories']), (sa, se)
        await E.wait_for_timeout(500)
        await shot(E, 'C1-edge-dashboard')
        ok(2, 'Edge memaparkan %d peserta, %d layak, %d kategori hadiah — sama dengan Chrome' % (se['total'], se['eligible'], se['prizeCategories']))

        # ---------------------------------------------------------------- UJIAN 3: telefon sahkan kehadiran → dashboard dikemas kini
        token = FS.events[EV]['token']
        pctx, P = await browser(b, 'phone', viewport={'width': 360, 'height': 740}, is_mobile=True, has_touch=True)
        await P.goto(URL + 'checkin.html#e=%s&t=%s' % (EV, token))
        await P.wait_for_selector('#ci-id')
        await P.fill('#ci-id', 's0007'); await P.click('#ci-go')
        await P.wait_for_selector('#ci-confirm'); await P.click('#ci-confirm')
        await P.wait_for_selector('.ci-ok')
        await A.goto(URL + '#/attendance')
        await A.wait_for_selector('#a-stats')
        for _ in range(60):
            if 'Hadir1' in (await A.inner_text('#a-stats')).replace('\n', '').replace(' ', ''): break
            await A.wait_for_timeout(250)
        assert 'Hadir1' in (await A.inner_text('#a-stats')).replace('\n', '').replace(' ', ''), await A.inner_text('#a-stats')
        await shot(A, 'C2-chrome-attendance-auto')
        ok(3, 'kehadiran dari telefon muncul di dashboard Chrome secara automatik (tanpa muat semula)')

        # ---------------------------------------------------------------- UJIAN 4: komputer lain (operator) — data sama
        octx, O = await browser(b, 'operator')
        await login(O, 'operator@fkm.utm.my', 'Operator123')
        await O.wait_for_selector('.event-card')
        await until(O, "import('./js/store.js').then(S => S.listParticipants()).then(ps => ps.length === %d)" % FS.count(EV, 'participants'))
        nav = await O.inner_text('.side-nav')
        assert 'Data Staf' not in nav and 'Pendaftaran Kehadiran' not in nav and 'Cabutan Bertuah' in nav, nav
        att_o = await O.evaluate("import('./js/attendance.js').then(a => a.eventInfo())")
        assert att_o['present'] == 1 and att_o['total'] == 201, att_o
        ok(4, 'komputer lain (Operator Cabutan) — %d peserta & kehadiran %d/%d sama; menu ikut peranan' % (FS.count(EV, 'participants'), att_o['present'], att_o['total']))

        # ---------------------------------------------------------------- UJIAN 8 & 9: cabutan pada satu peranti → disimpan berpusat
        pid = await O.evaluate("import('./js/store.js').then(S => S.listPrizes()).then(ps => ps[0].id)")
        res = json.loads(await O.evaluate("import('./js/store.js').then(S => S.executeDraw({ prizeId: '%s', count: 1 })).then(r => JSON.stringify({ mode: r.draw.mode, w: r.winners[0].staffId, id: r.winners[0].id }))" % pid))
        assert res['mode'] == 'online'
        assert FS.docs[(EV, 'participants', res['w'])]['d']['status'] == 'WINNER'
        await until(E, "import('./js/store.js').then(S => S.eligiblePool()).then(p => !p.some(x => x.staffId === '%s'))" % res['w'])
        ok(8, 'cabutan di komputer Operator dibuat di pelayan (%s menang) → disimpan berpusat & dibuang daripada kumpulan layak di Edge' % res['w'])
        await until(A, WINNERS + ".then(x => x.length > 0)")
        await until(E, WINNERS + ".then(x => x.length > 0)")
        wa, we = await A.evaluate(WINNERS), await E.evaluate(WINNERS)
        assert wa == we, (wa, we)
        await E.goto(URL + '#/history'); await E.wait_for_selector('#h-body table')
        await shot(E, 'C3-edge-history')
        ok(9, 'sejarah pemenang di Chrome dan Edge sama: %s' % we)

        # ---------------------------------------------------------------- UJIAN 5–7: luar talian (Peranti Kawalan Chrome)
        await A.goto(URL + '#/settings'); await A.wait_for_selector('#db-claim')
        await A.click('#db-claim'); await A.locator('.modal-foot .btn-primary').click()
        await until(A, "import('./js/sync.js').then(s => s.isControl())")
        FS.offline.add('chrome'); await actx.set_offline(True)
        await A.evaluate("import('./js/sync.js').then(s => s.tick().catch(() => {}))")
        await until(A, "import('./js/sync.js').then(s => s.phase() === 'offline')")
        off = json.loads(await A.evaluate("import('./js/store.js').then(S => S.executeDraw({ count: 2 })).then(r => JSON.stringify({ mode: r.draw.mode, ws: r.winners.map(w => w.staffId) }))"))
        assert off['mode'] == 'offline'
        await A.evaluate("import('./js/attendance.js').then(a => a.setCheckin('S0050', true))")
        await A.goto(URL + '#/dashboard'); await A.wait_for_selector('.kpi-grid')
        await A.wait_for_selector('#net-pill:has-text("OFFLINE")')
        await shot(A, 'C4-chrome-offline')
        ok(5, 'luar talian: pengguna yang telah disahkan terus bekerja — cabutan di Peranti Kawalan + kehadiran di kaunter disimpan setempat')
        pend = await A.evaluate("import('./js/sync.js').then(s => s.state.pending)")
        await A.reload()
        await A.wait_for_selector('.kpi-grid', timeout=20000)
        pend2 = await A.evaluate("import('./js/sync.js').then(s => s.state.pending)")
        wl = await A.evaluate("import('./js/store.js').then(S => S.listWinners()).then(ws => ws.length)")
        assert pend2 == pend and pend2 > 0 and wl == 3, (pend, pend2, wl)
        ok(6, 'muat semula semasa luar talian: data tersegerak & %d rekod menunggu masih ada' % pend2)
        FS.offline.discard('chrome'); await actx.set_offline(False)
        await A.evaluate("window.dispatchEvent(new Event('online'))")
        await until(A, "import('./js/sync.js').then(s => s.state.pending === 0 && s.state.online)", 40)
        for w in off['ws']:
            assert FS.docs[(EV, 'participants', w)]['d']['status'] == 'WINNER'
        assert FS.count(EV, 'winners') == 3 and FS.count(EV, 'attendance') == 2
        await until(E, WINNERS + ".then(x => x.split(',').length === 3)")
        await shot(A, 'C5-chrome-synced')
        ok(7, 'sambungan pulih: rekod menunggu disegerak automatik tanpa pendua (3 pemenang, 2 kehadiran di pelayan)')

        # ---------------------------------------------------------------- UJIAN 10: kehadiran serentak dari beberapa peranti
        k1ctx, K1 = await browser(b, 'kaunter1')
        k2ctx, K2 = await browser(b, 'kaunter2')
        await login(K1, 'kaunter1@fkm.utm.my', 'Kaunter123', 'attendance')
        await login(K2, 'kaunter2@fkm.utm.my', 'Kaunter123', 'attendance')
        await K1.wait_for_selector('#a-tbl tbody tr td.mono', timeout=30000)
        await K2.wait_for_selector('#a-tbl tbody tr td.mono', timeout=30000)
        before = FS.count(EV, 'attendance'), FS.count(EV, 'participants')
        # dua kaunter + dua telefon mengesahkan staf yang SAMA pada masa yang sama
        await asyncio.gather(
            K1.evaluate("import('./js/attendance.js').then(a => a.setCheckin('S0100', true))"),
            K2.evaluate("import('./js/attendance.js').then(a => a.setCheckin('S0100', true))"),
            P.evaluate("fetch('https://ajlxptgbwxnswcmyassf.supabase.co/rest/v1/rpc/ldr_checkin', {method: 'POST', headers: {'content-type': 'application/json', apikey: 'x'}, body: JSON.stringify({p_event: '%s', p_token: '%s', p_staff_id: 'S0100'})})" % (EV, token)),
            P.evaluate("fetch('https://ajlxptgbwxnswcmyassf.supabase.co/rest/v1/rpc/ldr_checkin', {method: 'POST', headers: {'content-type': 'application/json', apikey: 'x'}, body: JSON.stringify({p_event: '%s', p_token: '%s', p_staff_id: 'S0100'})})" % (EV, token)),
        )
        await until(K1, "import('./js/sync.js').then(s => s.state.pending === 0)")
        await until(K2, "import('./js/sync.js').then(s => s.state.pending === 0)")
        att100 = [k for (e, s, k) in FS.docs if e == EV and s == 'attendance' and k == 'S0100']
        assert len(att100) == 1 and FS.count(EV, 'attendance') == before[0] + 1, (att100, FS.count(EV, 'attendance'), before)
        err = await K1.evaluate("import('./js/store.js').then(S => S.savePrize({ category: 'Sagu Hati', name: 'X', quantity: 1, sequence: 9 })).then(() => '', e => e.message)")
        assert 'tidak dibenarkan' in err, err
        ok(10, 'pengesahan serentak (2 kaunter + 2 telefon) bagi staf sama → 1 rekod kehadiran, tiada pendua; Staf Pendaftaran tidak boleh ubah hadiah')

        # ---------------------------------------------------------------- Akaun baharu → kelulusan pentadbir
        nctx, N = await browser(b, 'baru')
        await N.goto(URL + '#/dashboard'); await N.wait_for_selector('#au-to-signup'); await N.click('#au-to-signup')
        await N.fill('#au-name', 'Pegawai Baharu'); await N.fill('#au-email', 'baru@fkm.utm.my'); await N.fill('#pw1', 'Baharu123'); await N.fill('#pw2', 'Baharu123')
        await N.click('#auth-form button[type=submit]')
        await N.wait_for_selector('text=Akaun menunggu kelulusan')
        await shot(N, 'C6-pending-approval')
        await E.goto(URL + '#/settings'); await E.wait_for_selector('#c-users select')
        uid = FS.users['baru@fkm.utm.my']['id']
        await E.select_option('select[data-role="%s"]' % uid, 'registrar')
        await E.wait_for_selector('.toast:has-text("Pengguna dikemas kini")')
        await shot(E, 'C7-users-roles')
        await N.click('#pd-check')
        await N.wait_for_selector('.side-nav')
        assert 'Pendaftaran Kehadiran' in await N.inner_text('.side-nav')
        ok('A', 'akaun baharu menunggu kelulusan → pentadbir tetapkan peranan di Tetapan → akses diberi')

        # ---------------------------------------------------------------- Paparan telefon 360px
        mctx, M = await browser(b, 'mobile', viewport={'width': 360, 'height': 780}, is_mobile=True, has_touch=True, device_scale_factor=2)
        await login(M, ADMIN, APW, 'settings')
        await M.wait_for_selector('#c-db')
        await M.wait_for_timeout(800)
        assert await M.evaluate('document.documentElement.scrollWidth') <= 360
        await shot(M, 'C8-mobile-settings')
        await b.close()

    bad = [e for e in errors if 'favicon' not in e]
    if bad:
        print('Ralat konsol:\n  ' + '\n  '.join(bad[:20])); sys.exit(1)
    with open(os.path.join(SHOTS, 'laporan-ujian-v4.txt'), 'w') as f:
        f.write('\n'.join(report) + '\n')
    print('✔ E2E pangkalan data pusat lulus (%d ujian)' % len(report))

if __name__ == '__main__':
    asyncio.run(main())
