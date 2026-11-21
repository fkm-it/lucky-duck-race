"""Pelayan Supabase TIRUAN untuk ujian E2E (Playwright route).

Meniru semantik fungsi SQL dalam supabase/migrations/003_luckyduck_central_db.sql:
Supabase Auth (token kata laluan / segar semula / daftar), peranan, ldr_sync_pull/push (rev, tombstone,
konflik base_rev, Peranti Kawalan), kehadiran → peserta (atomik, tiada pendua), ldr_draw (pelayan),
RPC awam telefon (ldr_event_info / ldr_lookup / ldr_checkin), pengguna & majlis.
"""
import json, secrets, hashlib, datetime, random, threading

H = lambda s: hashlib.sha256((s or '').encode()).hexdigest()
now = lambda: datetime.datetime.now(datetime.timezone.utc).isoformat().replace('+00:00', 'Z')
norm = lambda s: ' '.join((s or '').split()).upper()
STORES = ('staff', 'attendance', 'participants', 'prizes', 'draws', 'winners', 'audit', 'settings')
ROLE_W = {'operator': {'participants', 'draws', 'winners', 'audit'}, 'registrar': {'attendance', 'audit'}}


class Err(Exception):
    def __init__(self, code, status=400, hint=None):
        super().__init__(code); self.code = code; self.status = status; self.hint = hint


class FakeSupabase:
    def __init__(self):
        self.lock = threading.Lock()
        self.rev = 0
        self.users = {}       # email → {id,email,password,role,name,active}
        self.tokens = {}      # token → email
        self.events = {}      # id → {...}
        self.docs = {}        # (ev, store, key) → {s,k,r,d}
        self.tomb = {}
        self.offline = set()  # nama konteks yang "tiada internet"
        self.bootstrap = None
        self.calls = []

    # ------------------------------------------------------------ pembantu
    def add_user(self, email, password, role=None, name=''):
        u = {'id': 'u-' + secrets.token_hex(6), 'email': email, 'password': password, 'role': role, 'name': name, 'active': True, 'last': None}
        self.users[email] = u
        return u

    def add_event(self, name, active=True):
        if active:
            for e in self.events.values(): e['active'] = False
        i = str(__import__('uuid').uuid4())
        self.events[i] = {'id': i, 'name': name, 'token': secrets.token_hex(16), 'open': True, 'active': active, 'duck_seq': 1, 'winner_seq': 1, 'ctl': None, 'ctl_name': None}
        return i

    def meta(self, ev):
        e = self.events[ev]
        return {'event_id': ev, 'name': e['name'], 'is_open': e['open'], 'is_active': e['active'], 'qr_token': e['token'],
                'control_device': e['ctl'], 'control_name': e['ctl_name'], 'created_at': now(), 'legacy': False}

    def active_event(self):
        return next((i for i, e in self.events.items() if e['active']), None)

    def count(self, ev, store, pred=None):
        return sum(1 for (e, s, _), x in self.docs.items() if e == ev and s == store and (pred is None or pred(x['d'])))

    def put(self, ev, s, k, d):
        d = dict(d)
        if s in ('staff', 'attendance', 'participants'): d['staffId'] = k
        if s == 'participants':
            n = d.get('duckNo')
            others = [x for (e, ss, kk), x in self.docs.items() if e == ev and ss == 'participants' and kk != k]
            if not n or any(x['d'].get('duckNo') == n for x in others):
                n = max(self.events[ev]['duck_seq'], 1 + max([x['d'].get('duckNo') or 0 for x in others] or [0]))
                d['duckNo'] = n
            self.events[ev]['duck_seq'] = max(self.events[ev]['duck_seq'], n + 1)
        if s == 'attendance': d.setdefault('checkedInAt', now())
        self.rev += 1
        self.docs[(ev, s, k)] = {'s': s, 'k': k, 'r': self.rev, 'd': d}
        self.tomb.pop((ev, s, k), None)
        if s == 'attendance':
            p = self.docs.get((ev, 'participants', k))
            st = self.docs.get((ev, 'staff', k))
            if not p:
                self.put(ev, 'participants', k, {'name': st['d']['name'] if st else k, 'department': st['d'].get('department', '') if st else '',
                                                 'status': 'ELIGIBLE', 'winCount': 0, 'source': 'attendance', 'checkedInAt': d['checkedInAt'], 'createdAt': now(), 'updatedAt': now()})
            elif not p['d'].get('checkedInAt'):
                self.put(ev, 'participants', k, {**p['d'], 'checkedInAt': d['checkedInAt']})
        return self.docs[(ev, s, k)]

    def delete(self, ev, s, k):
        if (ev, s, k) not in self.docs: return
        del self.docs[(ev, s, k)]
        self.rev += 1
        self.tomb[(ev, s, k)] = {'s': s, 'k': k, 'r': self.rev, 'x': True}
        if s == 'attendance':
            p = self.docs.get((ev, 'participants', k))
            if p and p['d'].get('source') == 'attendance' and p['d'].get('status') == 'ELIGIBLE' and not p['d'].get('winCount'):
                self.delete(ev, 'participants', k)
            elif p:
                self.put(ev, 'participants', k, {**p['d'], 'checkedInAt': None})

    # ------------------------------------------------------------ auth
    def user_of(self, token):
        em = self.tokens.get(token)
        return self.users.get(em) if em else None

    def issue(self, u):
        t = 'tok-' + secrets.token_hex(12); self.tokens[t] = u['email']; u['last'] = now()
        return {'access_token': t, 'refresh_token': 'r' + t, 'expires_in': 3600, 'token_type': 'bearer', 'user': {'id': u['id'], 'email': u['email']}}

    def auth(self, path, body):
        if path.startswith('token?grant_type=password'):
            u = self.users.get((body.get('email') or '').lower())
            if not u or u['password'] != body.get('password'): raise Err('invalid_credentials')
            return self.issue(u)
        if path.startswith('token?grant_type=refresh_token'):
            u = self.user_of((body.get('refresh_token') or '')[1:])
            if not u: raise Err('invalid_grant')
            return self.issue(u)
        if path == 'signup':
            em = body['email'].lower()
            if em in self.users: raise Err('user_already_exists')
            u = self.add_user(em, body['password'], None, (body.get('data') or {}).get('name', ''))
            return self.issue(u)   # pengesahan e-mel dimatikan (seperti tetapan projek ujian)
        if path in ('logout', 'recover'): return {}
        raise Err('not_found', 404)

    # ------------------------------------------------------------ RPC
    def need(self, u, *roles):
        if not u: raise Err('AUTH', 401)
        if not u['role'] or not u['active'] or u['role'] not in roles: raise Err('FORBIDDEN')
        return u['role']

    def rpc(self, fn, a, u):
        f = getattr(self, 'r_' + fn, None)
        if not f: raise Err('UNKNOWN', 404)
        return f(a, u)

    def r_ldr_me(self, a, u):
        if not u: raise Err('AUTH', 401)
        ev = self.active_event()
        return {'user_id': u['id'], 'email': u['email'], 'name': u['name'], 'role': u['role'] if u['active'] else None, 'active': u['active'],
                'admins': sum(1 for x in self.users.values() if x['role'] == 'admin' and x['active']),
                'event': self.meta(ev) if (u['role'] and u['active'] and ev) else None}

    def r_ldr_bootstrap_admin(self, a, u):
        if not u: raise Err('AUTH', 401)
        if not self.bootstrap or a.get('p_code', '').strip() != self.bootstrap or any(x['role'] == 'admin' for x in self.users.values()): raise Err('BAD_CODE')
        u['role'] = 'admin'; u['name'] = a.get('p_name') or u['name']; self.bootstrap = None
        return self.r_ldr_me(a, u)

    def r_ldr_set_my_name(self, a, u):
        u['name'] = a['p_name']; return None

    def r_ldr_users_list(self, a, u):
        self.need(u, 'admin')
        return [{'user_id': x['id'], 'email': x['email'], 'name': x['name'], 'role': x['role'], 'active': x['active'], 'created_at': now(), 'last_sign_in_at': x['last']} for x in self.users.values()]

    def r_ldr_user_set(self, a, u):
        self.need(u, 'admin')
        x = next(v for v in self.users.values() if v['id'] == a['p_user'])
        x['role'] = a['p_role']; x['active'] = a['p_active'] if a['p_active'] is not None else x['active']
        return None

    def r_ldr_events_list(self, a, u):
        self.need(u, 'admin')
        return [{**self.meta(i), 'participants': self.count(i, 'participants'), 'staff': self.count(i, 'staff')} for i in self.events]

    def r_ldr_event_create(self, a, u):
        self.need(u, 'admin')
        i = self.add_event(a['p_name']); self.events[i]['token'] = a['p_token']
        return self.meta(i)

    def r_ldr_event_activate(self, a, u):
        self.need(u, 'admin')
        for i, e in self.events.items(): e['active'] = i == a['p_event']
        return self.meta(a['p_event'])

    def r_ldr_event_update(self, a, u):
        self.need(u, 'admin')
        e = self.events[a['p_event']]
        if a.get('p_name') is not None: e['name'] = a['p_name']
        if a.get('p_is_open') is not None: e['open'] = a['p_is_open']
        if a.get('p_new_token') is not None: e['token'] = a['p_new_token']
        self.rev += 1
        return self.meta(a['p_event'])

    def r_ldr_claim_control(self, a, u):
        self.need(u, 'admin', 'operator')
        e = self.events[a['p_event']]; e['ctl'] = a['p_device']; e['ctl_name'] = a['p_device_name']; self.rev += 1
        return self.meta(a['p_event'])

    def r_ldr_sync_pull(self, a, u):
        self.need(u, 'admin', 'operator', 'registrar')
        ev = a['p_event']
        rows = [{'s': x['s'], 'k': x['k'], 'r': x['r'], 'd': x['d'], 'x': False} for (e, _, _), x in self.docs.items() if e == ev and x['r'] > a['p_since']]
        rows += [{'s': x['s'], 'k': x['k'], 'r': x['r'], 'd': None, 'x': True} for (e, _, _), x in self.tomb.items() if e == ev and x['r'] > a['p_since']]
        rows.sort(key=lambda r: r['r'])
        lim = a.get('p_limit') or 1000
        return {'rows': rows[:lim], 'more': len(rows) > lim, 'meta': self.meta(ev)}

    def r_ldr_sync_push(self, a, u):
        role = self.need(u, 'admin', 'operator', 'registrar')
        ev = a['p_event']; e = self.events[ev]
        ctl = role in ('admin', 'operator') and e['ctl'] == a['p_device']
        applied, rejected = [], []
        for r in a['p_rows']:
            s, k = r['s'], r['k']; cur = self.docs.get((ev, s, k))
            if s not in STORES: rejected.append({'s': s, 'k': k, 'e': 'BAD_INPUT', 'x': True}); continue
            if not (role == 'admin' or s in ROLE_W.get(role, set())):
                rejected.append({'s': s, 'k': k, 'r': cur and cur['r'], 'd': cur and cur['d'], 'x': cur is None, 'e': 'FORBIDDEN'}); continue
            if cur and not ctl and s != 'attendance' and cur['r'] > (r.get('b') or 0):
                rejected.append({'s': s, 'k': k, 'r': cur['r'], 'd': cur['d'], 'x': False, 'e': 'CONFLICT'}); continue
            if r.get('x'):
                self.delete(ev, s, k); t = self.tomb.get((ev, s, k))
                applied.append({'s': s, 'k': k, 'r': t['r'] if t else 0, 'x': True}); continue
            if s == 'attendance':
                if (ev, 'staff', k) not in self.docs: rejected.append({'s': s, 'k': k, 'x': True, 'e': 'NOT_FOUND'}); continue
                x = cur or self.put(ev, s, k, r['d'])
            else:
                x = self.put(ev, s, k, r['d'])
            applied.append({'s': s, 'k': k, 'r': x['r'], 'd': x['d']})
        if rejected and __import__('os').environ.get('FS_DEBUG'): print('FS REJECT', [(r['s'], r['k'], r.get('e')) for r in rejected][:10])
        return {'applied': applied, 'rejected': rejected, 'control': ctl, 'role': role}

    def r_ldr_draw(self, a, u):
        self.need(u, 'admin', 'operator')
        ev = a['p_event']; e = self.events[ev]; k = a['p_count']
        if (ev, 'draws', a['p_draw_id']) in self.docs: raise Err('DUPLICATE')
        st = (self.docs.get((ev, 'settings', 'app')) or {'d': {'value': {}}})['d'].get('value', {})
        multi = bool(st.get('allowMultipleWins'))
        prize = None
        if a.get('p_prize_id'):
            if (ev, 'prizes', a['p_prize_id']) not in self.docs: raise Err('PRIZE_NOT_FOUND')
            prize = self.docs[(ev, 'prizes', a['p_prize_id'])]['d']
            awarded = self.count(ev, 'winners', lambda d: d.get('prizeId') == prize['id'] and not d.get('revoked'))
            if awarded + k > prize['quantity']: raise Err('PRIZE_EXHAUSTED', hint=str(prize['quantity'] - awarded))
            pno = awarded + 1
        pool = sorted([x['d'] for (ee, s, _), x in self.docs.items() if ee == ev and s == 'participants' and (multi or x['d'].get('status') == 'ELIGIBLE')], key=lambda d: d['duckNo'])
        if not pool: raise Err('NO_ELIGIBLE')
        if k > len(pool): raise Err('TOO_MANY', hint=str(len(pool)))
        picks = random.SystemRandom().sample(range(len(pool)), k)
        wno = max(e['winner_seq'], 1 + max([x['d'].get('winnerNo') or 0 for (ee, s, _), x in self.docs.items() if ee == ev and s == 'winners'] or [0]))
        iso = now(); winners = []; revs = []
        for n, i in enumerate(picks):
            p = pool[i]
            x = self.put(ev, 'participants', p['staffId'], {**p, 'status': 'WINNER', 'winCount': (p.get('winCount') or 0) + 1, 'lastWonAt': iso, 'updatedAt': iso})
            revs.append({'s': 'participants', 'k': p['staffId'], 'r': x['r']})
            w = {'id': 'W-%s-%d' % (a['p_draw_id'], n + 1), 'drawId': a['p_draw_id'], 'winnerNo': wno, 'rankInDraw': n + 1,
                 'prizeId': a.get('p_prize_id') or '', 'prizeCategory': prize['category'] if prize else 'Cabutan Khas', 'prizeName': prize['name'] if prize else 'Cabutan Khas',
                 'prizeNumber': (pno if prize else 1) + n, 'staffId': p['staffId'], 'name': p['name'], 'department': p.get('department', ''), 'duckNo': p['duckNo'], 'drawAt': iso, 'revoked': False}
            x = self.put(ev, 'winners', w['id'], w); winners.append(w); wno += 1
            revs.append({'s': 'winners', 'k': w['id'], 'r': x['r']})
        e['winner_seq'] = wno
        salt = secrets.token_hex(16)
        ids = [p['staffId'] for p in pool]
        integ = hashlib.sha256('|'.join([a['p_draw_id'], salt, ','.join(ids), ','.join(w['staffId'] for w in winners)]).encode()).hexdigest()
        draw = {'id': a['p_draw_id'], 'createdAt': iso, 'prizeId': a.get('p_prize_id') or '', 'prizeCategory': prize['category'] if prize else 'Cabutan Khas',
                'prizeName': prize['name'] if prize else 'Cabutan Khas', 'count': k, 'poolSize': len(pool), 'poolIds': ids, 'winnerIds': [w['staffId'] for w in winners],
                'revealMode': 'all' if a.get('p_reveal') == 'all' else 'one', 'status': 'COMMITTED', 'salt': salt, 'allowMultipleWins': multi, 'integrity': integ, 'mode': 'online', 'by': u['name']}
        x = self.put(ev, 'draws', draw['id'], draw); revs.append({'s': 'draws', 'k': draw['id'], 'r': x['r']})
        return {'draw': draw, 'winners': winners, 'pool': pool, 'prize': prize, 'revs': revs}

    # --- awam (telefon, token QR)
    def tok(self, a):
        e = self.events.get(a['p_event'])
        if not e or e['token'] != a['p_token']: raise Err('INVALID_QR')
        return e

    def r_ldr_event_info(self, a, u):
        e = self.tok(a); return [{'name': e['name'], 'is_open': e['open']}]

    def r_ldr_lookup(self, a, u):
        e = self.tok(a)
        if not e['open']: raise Err('CLOSED')
        sid = norm(a['p_staff_id']); s = self.docs.get((a['p_event'], 'staff', sid))
        if not s: raise Err('NOT_FOUND')
        at = self.docs.get((a['p_event'], 'attendance', sid))
        return [{'staff_id': sid, 'name': s['d']['name'], 'department': s['d'].get('department', ''), 'checked_in_at': at['d']['checkedInAt'] if at else None}]

    def r_ldr_checkin(self, a, u):
        e = self.tok(a)
        if not e['open']: raise Err('CLOSED')
        ev = a['p_event']; sid = norm(a['p_staff_id']); s = self.docs.get((ev, 'staff', sid))
        if not s: raise Err('NOT_FOUND')
        at = self.docs.get((ev, 'attendance', sid)); already = at is not None
        if not at: at = self.put(ev, 'attendance', sid, {'checkedInAt': now(), 'via': 'qr'})
        return [{'staff_id': sid, 'name': s['d']['name'], 'department': s['d'].get('department', ''), 'checked_in_at': at['d']['checkedInAt'], 'already': already}]

    # ------------------------------------------------------------ Playwright
    def handler(self, name):
        async def h(route):
            req = route.request
            cors = {'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, PUT, GET'}
            if req.method == 'OPTIONS':
                return await route.fulfill(status=204, headers=cors)
            if name in self.offline:
                return await route.abort('internetdisconnected')
            url = req.url.split('.supabase.co', 1)[1]
            body = json.loads(req.post_data or '{}') if req.post_data else {}
            tok = (req.headers.get('authorization') or '').replace('Bearer ', '')
            self.calls.append((name, url))
            try:
                with self.lock:
                    if url.startswith('/auth/v1/'):
                        out = self.auth(url[len('/auth/v1/'):], body)
                    else:
                        out = self.rpc(url.rsplit('/', 1)[1], body, self.user_of(tok))
                await route.fulfill(status=200, body=json.dumps(out), headers={**cors, 'content-type': 'application/json'})
            except Exception as e:
                if not isinstance(e, Err):
                    print('FAKE SERVER ERROR', url, repr(e)); e = Err('SERVER', 500)
                payload = {'message': e.code, 'hint': e.hint, 'error_code': e.code} if not url.startswith('/auth/') else {'error_code': e.code, 'msg': e.code}
                await route.fulfill(status=e.status, body=json.dumps(payload), headers={**cors, 'content-type': 'application/json'})
        return h

    async def attach(self, ctx, name):
        await ctx.route('https://ajlxptgbwxnswcmyassf.supabase.co/**', self.handler(name))


IGNORE_CONSOLE = ('favicon', 'status of 400', 'status of 401', 'INTERNET_DISCONNECTED', 'WebSocket', 'realtime', 'ERR_NAME_NOT_RESOLVED', 'ERR_TUNNEL', 'net::')
