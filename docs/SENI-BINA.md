# Seni bina v4 — pangkalan data pusat + dalam talian / luar talian

## 1. Komponen

| Lapisan | Fail | Peranan |
|---|---|---|
| Pangkalan data pusat | `supabase/migrations/003_luckyduck_central_db.sql` | Jadual ternormal, pencetus, RPC `ldr_*`, RLS |
| Auth | `js/auth.js`, `js/cloud.js` | Supabase Auth (REST GoTrue), token segar semula, pengesah luar talian |
| Enjin segerak | `js/sync.js`, `js/db.js` | Baris gilir `outbox`, push/pull ikut `rev`, Realtime, cabutan pelayan |
| Cache luar talian | IndexedDB `lucky-duck-race` v3 | `staff`, `attendance`, `participants`, `prizes`, `draws`, `winners`, `audit`, `settings`, `outbox`, `syncrev` |
| PWA | `sw.js` (dijana), `manifest.webmanifest` | Semua aset dicache (cache-dahulu); aplikasi dibuka tanpa internet |

## 2. Skema (skema `luckyduck`)

| Jadual | Kunci | Kekangan penting |
|---|---|---|
| `app_users` | `user_id` → `auth.users` | `role ∈ {admin, registrar, operator}` atau null (menunggu kelulusan) |
| `events` | `id` uuid | satu `is_active`; `token_hash` + `qr_token` (QR); `control_device` (Peranti Kawalan); `duck_seq`, `winner_seq` |
| `staff` | (`event_id`, No. Pekerja) | No. Pekerja = **teks** unik setiap majlis |
| `attendance` | (`event_id`, No. Pekerja) | **satu kehadiran** setiap staf (PK) |
| `participants` | (`event_id`, No. Pekerja) | unik (`event_id`, `duck_no`); status `ELIGIBLE/WINNER` |
| `prize_categories` | `code` | 6 kategori standard |
| `prizes` | (`event_id`, id) | `quantity` 1–10000 |
| `draw_sessions` | (`event_id`, id) | `integrity` SHA-256, `mode` online/offline |
| `winners` | (`event_id`, id) | unik (`event_id`, `draw_id`, `staff_id`) |
| `audit_logs` | (`event_id`, id) | siapa, peranti, bila, tindakan |
| `settings` | (`event_id`, key) | `app` (tetapan majlis dikongsi) |
| `tombstones` | (`event_id`, store, key) | rekod padam untuk penyegerakan |
| `sync_queue` | identity | log operasi segerak yang **ditolak / gagal** (audit & siasatan) |

Setiap jadual entiti menyimpan **lajur bertaip** (untuk kekangan, indeks dan laporan SQL) dan `doc jsonb` (rekod penuh seperti yang digunakan aplikasi). Pencetus `tg_doc` mengisi lajur bertaip daripada `doc`, menetapkan `rev = nextval(doc_rev)` dan memastikan nombor itik unik. Pencetus `tg_tombstone` merekod padam.

**Kehadiran → peserta** (`tg_attendance_in`): sebaik rekod kehadiran dimasukkan (QR telefon, kaunter, atau baris gilir luar talian), pelayan mencipta peserta `ELIGIBLE` dengan nombor itik seterusnya — dalam transaksi yang sama. `on conflict do nothing` pada kunci utama kehadiran menjadikan pengesahan serentak selamat (tiada pendua).

## 3. Enjin penyegerakan

```
 tulis setempat (store.js) ──► db.tx() membalut object store:
      put/add/delete/clear pada data disegerak  ──► rekod {store,key,t} dalam 'outbox' (transaksi SAMA)
                                                      │  (kekal walaupun pelayar dimuat semula / ditutup)
 sync.tick():  push  ──► ldr_sync_push(rows[{s,k,d,x,b=rev asas}])  ──► applied[{rev, doc muktamad}] / rejected
               pull  ──► ldr_sync_pull(since=rev terakhir)            ──► rows (termasuk tombstone) ikut rev
 pencetus: Realtime (postgres_changes pada public.ldr_pulse) · tinjauan 5 s (20 s jika Realtime aktif)
           · selepas setiap tulisan setempat (250 ms) · peristiwa 'online'
```

**Peraturan konflik**
- Setiap peranti menyimpan `rev` terakhir bagi setiap rekod (`syncrev`). Push menghantar `b` (rev asas).
- Jika rekod di pelayan lebih baharu (`rev > b`) → **ditolak (`CONFLICT`)**, versi pusat dikembalikan ke peranti dan pengguna dimaklumkan. *Pengecualian:* **Peranti Kawalan** (admin/operator) sentiasa menang — keputusan cabutan luar talian tidak boleh hilang.
- Kehadiran: rekod pertama menang (tiada pendua).
- Tiada kebenaran (`FORBIDDEN`) / data tidak sah → ditolak, direkod dalam `sync_queue`, versi pusat dipulihkan.
- Ralat rangkaian → baris gilir kekal dan dicuba semula secara automatik.

**Cabutan**
- *Dalam talian:* `store.executeDraw` → hantar perubahan tertunggak → `ldr_draw` (pelayan memilih, mengemas kini peserta, merekod pemenang, sesi cabutan & audit secara atomik, memulangkan `pool` untuk animasi + `revs`). Animasi memaparkan keputusan pelayan.
- *Luar talian:* hanya **Peranti Kawalan** (`events.control_device`) — cabutan dibuat setempat (Web Crypto, transaksi IndexedDB, kod integriti) dan dihantar bila online.

## 4. Keselamatan

- **Tiada kunci `service_role`** dalam kod hadapan. Hanya kunci *publishable* + JWT pengguna.
- Jadual dalam skema `luckyduck` yang **tidak didedahkan** melalui REST; **RLS dihidupkan pada semua jadual tanpa polisi** → akses terus ditolak sepenuhnya. Semua akses melalui RPC `public.ldr_*` (`SECURITY DEFINER`, `search_path = ''`) yang memanggil `luckyduck.need(peranan…)`.
- `public.ldr_pulse` (hanya `event_id` + `rev`) — RLS: hanya ahli berperanan boleh baca (untuk Realtime).
- Telefon staf (awam): hanya `ldr_event_info`, `ldr_lookup`, `ldr_checkin` dengan token QR, dihadkan kadar per IP; memulangkan rekod staf yang dicari sahaja.
- Kod pentadbir pertama: hash SHA-256 disimpan di pelayan (bukan dalam repo), sekali guna, dihadkan kadar.
- Log masuk luar talian: PBKDF2-SHA256 (210k lelaran, garam rawak) bagi pengguna yang **pernah** log masuk dalam talian di peranti itu; peranan = peranan terakhir yang disahkan pelayan. Pengguna baharu mesti log masuk dalam talian dahulu.
- HTML dinamik melalui `html``…``` (auto-escape); CSP ketat; eksport dineutralkan daripada *formula injection*.

## 5. Had yang diketahui

- IndexedDB adalah khusus peranti. Tanpa internet, peranti **tidak** berkongsi data antara satu sama lain — lihat `RANGKAIAN-SETEMPAT.md`.
- Jika Peranti Kawalan membuat cabutan luar talian **dan** operator lain membuat cabutan dalam talian pada masa yang sama, peserta yang sama boleh menang di kedua-duanya (Peranti Kawalan menang semasa segerak; kedua-dua rekod pemenang disimpan untuk semakan). Amalan: hanya satu peranti menjalankan cabutan pada satu masa.
