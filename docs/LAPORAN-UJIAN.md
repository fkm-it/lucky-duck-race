# Laporan ujian — v4.0.0 (21 Nov 2026)

## Ringkasan

| Suite | Alat | Keputusan |
|---|---|---|
| Ujian unit (rawak, logik, storan, enjin segerak + Auth) | `npm test` (node:test + fake-indexeddb) | **24 / 24 lulus** |
| Semakan statik (sintaks, XSS, sw.js) | `npm run check` | lulus |
| Fungsi SQL pada pangkalan data Supabase sebenar | blok `DO` dengan pengguna ujian sementara (data ujian dibuang selepas itu) | lulus — lihat §3 |
| E2E aliran majlis (import 500, hadiah, 2 cabutan 3D, pulih, eksport, 2D, telefon 360px, muat semula luar talian) | `tools/e2e.py` (Playwright, Chrome) | lulus |
| E2E kehadiran QR (telefon, kaunter luar talian, batal, tutup, QR skrin penuh, tukar QR) | `tools/e2e_attendance.py` | lulus |
| E2E penerimaan pangkalan data pusat (spesifikasi §10) | `tools/e2e_cloud.py` | **12 / 12 lulus** |

Ujian E2E menggunakan pelayan Supabase **tiruan** (`tools/fake_supabase.py`) yang meniru semantik fungsi SQL, kerana persekitaran ujian tidak boleh mencapai `supabase.co`. Logik pelayan sebenar diuji berasingan terus pada pangkalan data (§3).

## 1. Ujian penerimaan (spesifikasi §10)

| # | Ujian | Keputusan |
|---|---|---|
| 1 | Import staf di Chrome | LULUS — 201 staf diimport; pangkalan data pusat 213 peserta (201 + 12 dipindahkan dari pelayar lama) |
| 2 | Buka di Edge | LULUS — jumlah peserta, layak, kategori hadiah sama dengan Chrome |
| 3 | Sahkan kehadiran di telefon | LULUS — dashboard Chrome dikemas kini automatik tanpa muat semula |
| 4 | Komputer lain | LULUS — Operator Cabutan melihat peserta & kehadiran yang sama; menu ikut peranan |
| 5 | Putuskan internet | LULUS — pengguna yang telah disahkan terus bekerja (cabutan di Peranti Kawalan, kehadiran di kaunter) |
| 6 | Muat semula semasa luar talian | LULUS — data tersegerak & rekod menunggu kekal |
| 7 | Sambung semula | LULUS — rekod menunggu disegerak automatik, tiada pendua |
| 8 | Cabutan pada satu peranti | LULUS — pemenang dipilih di pelayan, disimpan berpusat, dibuang daripada kumpulan layak di peranti lain |
| 9 | Sejarah pemenang di pelayar lain | LULUS — senarai pemenang Chrome = Edge |
| 10 | Pengesahan serentak | LULUS — 2 kaunter + 2 telefon untuk staf sama → 1 rekod kehadiran |
| 11 | Berbilang peranti luar talian melalui pelayan LAN | **TIDAK DIUJI — mod LAN belum dibina** (keputusan v4; lihat `RANGKAIAN-SETEMPAT.md`) |
| M | Migrasi data pelayar lama | LULUS — 12 peserta + 1 hadiah dipindahkan, tiada data dipadam |
| A | Akaun baharu → kelulusan | LULUS — menunggu kelulusan → pentadbir tetapkan peranan → akses diberi |

Tangkapan skrin: `e2e-shots/C0…C8*.png`, `A1…A4*.png`, `P1…P6*.png`.

## 2. Ujian unit enjin segerak (`tests/sync.test.mjs`)

1. Data pelayar lama dikesan; penyegerakan dijeda sehingga pentadbir memilih; muat naik lengkap.
2. Perubahan dari pusat (termasuk peserta yang dicipta oleh kehadiran QR) ditarik; jumlah sama.
3. Cabutan dalam talian melalui `ldr_draw`; pemenang berpusat; baki hadiah dikuatkuasa; pulih pemenang sejurus selepas itu bukan konflik.
4. Luar talian: cabutan ditolak bukan-Peranti-Kawalan; dibenarkan di Peranti Kawalan; baris gilir dalam IndexedDB; segerak tanpa pendua.
5. Staf Pendaftaran: kehadiran luar talian → peserta dicipta pelayan; tidak boleh ubah hadiah / cabut.
6. Log masuk luar talian: kata laluan salah ditolak; pengguna yang belum pernah log masuk ditolak; pengguna sah diterima dengan peranan terakhir.
7. Akaun tanpa peranan tidak nampak majlis / data.
8. Konflik: peranti biasa menyunting rekod yang telah berubah di pusat → ditolak, versi pusat dikekalkan.

## 3. Fungsi SQL pada pangkalan data sebenar

Dijalankan dalam transaksi dengan pengguna & majlis ujian sementara:

| Semakan | Keputusan |
|---|---|
| `ldr_me` akaun baharu | peranan `null` (menunggu) |
| `ldr_bootstrap_admin` kod salah / betul | `BAD_CODE` / menjadi `admin` |
| `ldr_sync_push` staf, hadiah, tetapan | 5 diterima, 0 ditolak |
| `ldr_checkin` (telefon) ×2, No. Pekerja tidak wujud | `already=false` → `already=true`; `NOT_FOUND` |
| Akaun menunggu memanggil `ldr_sync_pull` | `FORBIDDEN` |
| Staf Pendaftaran: kehadiran luar talian ×2 + cuba ubah hadiah | 2 diterima (1 rekod), hadiah `FORBIDDEN` |
| Peserta dicipta oleh pencetus kehadiran | `001:#1`, `002:#2` (sumber `attendance`) |
| Staf Pendaftaran memanggil `ldr_draw` | `FORBIDDEN` |
| `ldr_draw` oleh pentadbir | pemenang dipilih, kod integriti disemak semula = sama; cabutan kedua untuk hadiah habis → `PRIZE_EXHAUSTED` |
| Konflik `base_rev` lama | `CONFLICT` |
| Batal kehadiran | peserta `attendance` yang belum menang dibuang; tombstone dicipta |
| Realtime `ldr_pulse` | dikemas kini |

Penasihat keselamatan Supabase: tiada isu kritikal. Amaran "SECURITY DEFINER boleh dipanggil" adalah reka bentuk yang disengajakan (semua akses melalui RPC yang menyemak peranan); "RLS tanpa polisi" = akses terus ditolak sepenuhnya.
