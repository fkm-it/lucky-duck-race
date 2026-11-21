#!/usr/bin/env python3
"""E2E pelayar (Playwright): aliran penuh majlis.
   python3 tools/e2e.py [URL]   (lalai http://localhost:8080/)  — tangkapan skrin ke e2e-shots/
"""
import asyncio, os, sys, re
from playwright.async_api import async_playwright
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fake_supabase import FakeSupabase, IGNORE_CONSOLE

URL = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:8080/'
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOTS = os.path.join(ROOT, 'e2e-shots')
os.makedirs(SHOTS, exist_ok=True)
PW = 'Admin1234'
EMAIL = 'admin@fkm.utm.my'
errors = []
FS = FakeSupabase()
FS.add_user(EMAIL, PW, 'admin', 'Za')
EV = FS.add_event('Majlis Ujian E2E')


async def login(page, email=EMAIL, pw=PW):
    await page.wait_for_selector('#au-email')
    await page.fill('#au-email', email)
    await page.fill('#pw1', pw)
    await page.click('#auth-form button[type=submit]')


async def shot(page, name):
    await page.screenshot(path=os.path.join(SHOTS, name + '.png'))


async def confirm(page):
    await page.locator('.modal-foot .btn-primary, .modal-foot .btn-danger').last.click()


async def stage_draw(page, name, reveal_one):
    await page.click('#d-open')
    await page.wait_for_selector('#stg-start', timeout=20000)
    await page.wait_for_timeout(1500)
    await shot(page, name + '-1-prarace')
    await page.click('#stg-start')
    try:
        await page.wait_for_selector('.cd-num', timeout=20000)
    except Exception:
        await shot(page, name + '-ERR')
        print('TOASTS:', await page.locator('#toasts').inner_text() if await page.locator('#toasts').count() else '-')
        print('ERRORS:', errors)
        print('STORES:', await page.evaluate('''async () => { const db = await import('./js/db.js'); const out = {};
          for (const n of ['participants','winners','draws','prizes','audit','settings']) {
            out[n] = await Promise.race([db.count(n).then(c => 'ok '+c), new Promise(r => setTimeout(() => r('BLOCKED'), 1500))]); }
          return JSON.stringify(out); }'''))
        print('LOCKS:', await page.evaluate('navigator.locks.query().then(q => JSON.stringify(q))'))
        print('CALLS:', FS.calls[-10:])
        raise
    await page.wait_for_timeout(400)
    await shot(page, name + '-2-countdown')
    await page.wait_for_selector('#stg-lead:not([hidden])', timeout=20000)
    await page.wait_for_timeout(4000)
    await shot(page, name + '-3-race')
    await page.wait_for_selector('.fs-chip', state='attached', timeout=60000)
    await page.wait_for_timeout(600)
    await shot(page, name + '-4-finish')
    if reveal_one:
        await page.wait_for_selector('#ann-next', timeout=60000)
        await page.wait_for_timeout(1200)
        await shot(page, name + '-5-reveal')
        while await page.locator('#ann-next').count():
            await page.click('#ann-next')
            await page.wait_for_timeout(2300)
    await page.wait_for_selector('#ann-done', timeout=60000)
    await page.wait_for_timeout(1500)
    await shot(page, name + '-6-gallery')
    await page.click('#ann-done')
    await page.wait_for_selector('#stage[hidden]', state='attached', timeout=10000)


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
        ctx = await b.new_context(viewport={'width': 1600, 'height': 900}, accept_downloads=True)
        await FS.attach(ctx, 'main')
        page = await ctx.new_page()
        page.on('console', lambda m: m.type == 'error' and not any(x in m.text for x in IGNORE_CONSOLE) and errors.append(m.text))
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.on('console', lambda m: os.environ.get('DBG') and print('CONSOLE', m.type, m.text[:300]))
        await page.goto(URL)
        await page.wait_for_selector('.home-cta')
        await page.wait_for_timeout(600)
        await shot(page, '00-home')
        await page.click('.home-nav [data-go=dashboard]')

        # 1. Log masuk (Supabase Auth)
        await page.wait_for_selector('#au-email')
        await shot(page, '01-login')
        await page.fill('#au-email', EMAIL); await page.fill('#pw1', 'salah999'); await page.click('#auth-form button[type=submit]')
        await page.wait_for_selector('.toast:has-text("salah")')
        await login(page)
        await page.wait_for_selector('.event-card')

        # 2. Import Excel (500, Staff ID sifar di hadapan)
        await page.goto(URL + '#/import')
        await page.set_input_files('#file', os.path.join(ROOT, 'samples/peserta-contoh-500.xlsx'))
        await page.wait_for_selector('#do-import')
        await shot(page, '02-import-preview')
        txt = await page.inner_text('#preview')
        assert 'Sah 500' in txt, txt[:300]
        assert '000001' in txt, 'sifar di hadapan hilang'
        await page.click('#do-import')
        await confirm(page)
        await page.wait_for_selector('#p-tbl tbody tr')
        await shot(page, '03-participants')
        assert '000001' in await page.inner_text('#p-tbl')
        for _ in range(40):
            if FS.count(EV, 'participants') == 500: break
            await page.wait_for_timeout(250)
        assert FS.count(EV, 'participants') == 500, 'peserta dihantar ke pangkalan data pusat: %d' % FS.count(EV, 'participants')

        # 3. Hadiah contoh
        await page.goto(URL + '#/prizes')
        await page.click('#pz-preset')
        await page.wait_for_selector('.prize-card')
        await shot(page, '04-prizes')

        # 4. Tetapan: perlumbaan pendek untuk ujian
        await page.goto(URL + '#/settings')
        await page.fill('#s-dur', '8')
        await page.fill('#s-event', 'Majlis Makan Malam Tahunan FKM 2026')
        await page.click('#s-save')
        await page.wait_for_timeout(300)

        # 5. Cabutan Grand Prize (1, satu demi satu)
        await page.goto(URL + '#/draw')
        await page.wait_for_selector('#d-open')
        await shot(page, '05-draw-config')
        await stage_draw(page, '06-grand', True)

        # 6. Cabutan Consolation (20, grand finale)
        await page.goto(URL + '#/draw')
        await page.wait_for_selector('#d-prize')
        opt = await page.eval_on_selector('#d-prize', "s => [...s.options].find(o => o.text.includes('Sagu Hati')).value")
        await page.select_option('#d-prize', opt)
        await page.check('input[name=rv][value=finale]')
        assert await page.input_value('#d-count') == '20'
        await stage_draw(page, '07-consolation', False)

        # 7. Sejarah & statistik
        await page.wait_for_selector('#h-body table')
        await shot(page, '08-history')
        rows = await page.locator('#h-body tbody tr').count()
        assert rows == 21, rows
        stats = await page.inner_text('#topstats')
        assert '479' in stats, stats
        assert FS.count(EV, 'winners') == 21 and FS.count(EV, 'participants', lambda d: d['status'] == 'WINNER') == 21, 'pemenang dalam pangkalan data pusat'

        # 8. Pulihkan seorang pemenang
        await page.locator('[data-restore]').first.click()
        await page.fill('#rs', 'Tiada di dewan')
        await confirm(page)
        await page.wait_for_timeout(500)
        stats = await page.inner_text('#topstats')
        assert '480' in stats, stats

        # 9. Eksport Excel
        async with page.expect_download() as dl:
            await page.click('[data-exp=xlsx]')
        d = await dl.value
        assert d.suggested_filename.endswith('.xlsx')

        # 10. Rekod cabutan & dashboard
        await page.click('[data-tab=draws]')
        await shot(page, '09-draws')
        await page.goto(URL + '#/dashboard')
        await page.wait_for_selector('.kpi-grid')
        await shot(page, '10-dashboard')

        # 11. Mod 2D
        await page.goto(URL + '#/settings')
        await page.select_option('#s-mode', '2d')
        await page.click('#s-save')
        await page.goto(URL + '#/draw')
        await page.wait_for_selector('#d-open')
        await page.click('#d-open')
        await page.wait_for_selector('#stg-start')
        await page.click('#stg-start')
        await page.wait_for_selector('#stg-lead:not([hidden])', timeout=20000)
        await page.wait_for_timeout(3500)
        await shot(page, '11-race-2d')
        await page.keyboard.press('Escape')
        await confirm(page)

        # 12. Telefon 360px
        m = await b.new_context(viewport={'width': 360, 'height': 740}, device_scale_factor=2)
        await FS.attach(m, 'mobile')
        mp = await m.new_page()
        await mp.goto(URL)
        await mp.wait_for_selector('.home-cta')
        await shot(mp, '12a-mobile-home')
        assert await mp.evaluate('document.documentElement.scrollWidth') <= 360, 'home mendatar'
        await mp.click('.home-nav [data-go=dashboard]')
        await login(mp)
        await mp.wait_for_selector('.event-card')
        want = str(FS.count(EV, 'participants', lambda d: d['status'] == 'ELIGIBLE'))
        for _ in range(40):
            if want in await mp.inner_text('#topstats'): break
            await mp.wait_for_timeout(250)
        assert want in await mp.inner_text('#topstats'), 'telefon nampak data pusat yang sama'
        await shot(mp, '12-mobile-dashboard')
        sw = await mp.evaluate('document.documentElement.scrollWidth')
        wide = await mp.evaluate('''() => { const out = []; document.querySelectorAll('body *').forEach(e => { const r = e.getBoundingClientRect(); if (r.right > 362 && r.width > 0 && !e.closest('.table-wrap')) out.push(e.tagName + '.' + e.className + ' ' + Math.round(r.right)); }); return out.slice(0, 6); }''')
        assert sw <= 360, 'skrol mendatar pada telefon: %s %s' % (sw, wide)

        # 13. Luar talian (selepas SW dipasang)
        await page.goto(URL + '#/dashboard')
        await page.wait_for_timeout(1500)
        await page.evaluate('navigator.serviceWorker.ready')
        FS.offline.add('main')
        await ctx.set_offline(True)
        await page.reload()
        await page.wait_for_selector('.kpi-grid', timeout=15000)
        assert want in await page.inner_text('#topstats'), 'data setempat kekal selepas muat semula luar talian'
        await page.wait_for_selector('#net-pill:has-text("OFFLINE")', timeout=15000)
        await shot(page, '13-offline')
        await ctx.set_offline(False)
        FS.offline.discard('main')
        await b.close()

    bad = [e for e in errors if 'favicon' not in e]
    if bad:
        print('Ralat konsol:\n  ' + '\n  '.join(bad[:20]))
        sys.exit(1)
    print('✔ E2E lulus — tangkapan skrin di e2e-shots/')

asyncio.run(main())
