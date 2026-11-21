# 🤘 ROCK THE DRAW — *Let's Rock. Let's Win!*

Sistem **pendaftaran kehadiran (QR)** dan **cabutan bertuah perlumbaan itik 3D** untuk majlis korporat dan universiti.

**Live:** https://fkm-it.github.io/lucky-duck-race/ · **Versi 4**: satu pangkalan data pusat, satu sistem log masuk, data sama di semua pelayar & peranti, dan terus berfungsi tanpa internet.

## Ringkasan seni bina (v4)

```
 Telefon staf (QR) ──► RPC awam (token QR) ─┐
 Chrome / Edge / laptop / tablet            │        Supabase (projek dashboard-unit-it-fkm)
   ├─ Supabase Auth (e-mel + kata laluan) ──┼──►  ┌─────────────────────────────────────────┐
   ├─ IndexedDB = cache luar talian         │     │ skema luckyduck (tidak didedahkan, RLS)  │
   │   + baris gilir 'outbox'               │     │ staff · attendance · participants        │
   └─ enjin segerak (push/pull ikut rev) ───┘     │ prize_categories · prizes · draw_sessions│
            ▲                                     │ winners · audit_logs · settings          │
            └──── Realtime (public.ldr_pulse) ────│ app_users · events · tombstones · sync_queue
                                                  │ RPC public.ldr_* (SECURITY DEFINER +     │
                                                  │ semakan peranan) · ldr_draw (atomik)     │
                                                  └─────────────────────────────────────────┘
```

- **Pangkalan data pusat** ialah sumber kebenaran. IndexedDB hanya cache luar talian + baris gilir.
- **Kehadiran → peserta cabutan** dicipta **di pelayan** secara atomik (kekangan unik: satu kehadiran & satu kelayakan bagi setiap No. Pekerja).
- **Cabutan dalam talian** dibuat **di pelayan** (`ldr_draw`: kunci baris majlis + `gen_random_bytes` + Fisher–Yates + kod integriti SHA-256) → mustahil dua peranti memilih pemenang bertindih.
- **Luar talian:** pengguna yang pernah log masuk di peranti itu boleh masuk semula (pengesah PBKDF2 setempat, peranan terakhir). Rekod baharu disimpan dalam baris gilir dan dihantar automatik bila internet pulih. Cabutan luar talian hanya di **Peranti Kawalan** yang ditetapkan.
- **Penunjuk sambungan:** `ONLINE` · `OFFLINE` · `SYNCING (n)` · `SYNC COMPLETE`.

## Peranan

| Peranan | Boleh |
|---|---|
| **Pentadbir** | Semua: staf, kehadiran, peserta, hadiah, cabutan, pengguna & peranan, majlis, tetapan, import/eksport, sandaran |
| **Operator Cabutan** | Jalankan cabutan, lihat peserta layak & sejarah pemenang, pulih pemenang. Tidak boleh ubah data staf / hadiah |
| **Staf Pendaftaran** | Cari & sahkan staf, sahkan / batal kehadiran (termasuk luar talian), lihat rekod kehadiran |
| *Telefon staf (awam)* | Hanya semak No. Pekerja sendiri & sahkan kehadiran melalui token QR. Senarai staf tidak pernah didedahkan |

Peranan dikuatkuasa **di pelayan** (setiap RPC menyemak `auth.uid()` + peranan) dan disembunyikan di UI.

## Aliran majlis

1. Pentadbir log masuk → **Pendaftaran Kehadiran** → cipta majlis (sekali) → **Data Staf** → muat naik Excel staf.
2. Pengguna lain daftar akaun di skrin log masuk → pentadbir tetapkan peranan di **Tetapan Sistem → Pengguna & peranan**.
3. Hari majlis: paparkan QR di kaunter. Staf imbas → No. Pekerja → **Sahkan Kehadiran** → terus jadi peserta (semua peranti nampak serta-merta).
4. Laptop pentas: **Tetapan → Jadikan peranti ini Peranti Kawalan** → **Cabutan Bertuah** → pilih hadiah → MULA.
5. Selepas majlis: **Laporan & Eksport** (Excel/CSV/PDF) dan sandaran.

Pintasan pentas: `Space` mula / seterusnya · `F` skrin penuh · `M` bunyi · `Esc` tutup.

## Dokumentasi

| Dokumen | Kandungan |
|---|---|
| [docs/SENI-BINA.md](docs/SENI-BINA.md) | Skema pangkalan data, enjin penyegerakan, peraturan konflik, keselamatan (RLS, RPC, Auth) |
| [docs/OPERASI.md](docs/OPERASI.md) | Persediaan Supabase & GitHub Pages, konfigurasi persekitaran, pengguna pertama, sandaran & pemulihan, senarai semak hari majlis |
| [docs/RANGKAIAN-SETEMPAT.md](docs/RANGKAIAN-SETEMPAT.md) | Mod pelayan rangkaian setempat (LAN) tanpa internet — had & pilihan pelaksanaan |
| [docs/LAPORAN-UJIAN.md](docs/LAPORAN-UJIAN.md) | Laporan ujian penerimaan (Ujian 1–11) |
| [CHANGELOG.md](CHANGELOG.md) | Sejarah versi |

## Pembangunan

```bash
npm ci
npm test            # ujian unit: rawak, storan, enjin segerak + Auth (pelayan palsu)
npm run check       # sintaks, corak XSS, sw.js terkini
npm run dev         # http://localhost:8080
npm run e2e         # Playwright: aliran majlis, kehadiran QR, ujian penerimaan pangkalan data pusat
npm run build:sw    # WAJIB selepas mengubah mana-mana fail aset
```

Push ke `main` → GitHub Actions (ujian → binaan → GitHub Pages).
