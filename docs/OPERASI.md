# Operasi — persediaan, konfigurasi, sandaran & hari majlis

## 1. Komponen yang dideploy

| Komponen | Lokasi | Cara deploy |
|---|---|---|
| Aplikasi web (PWA) | GitHub Pages — https://fkm-it.github.io/lucky-duck-race/ | Push ke `main` → `.github/workflows/deploy.yml` (ujian → binaan → Pages) |
| Pangkalan data, Auth, Realtime | Supabase projek `dashboard-unit-it-fkm` (`ajlxptgbwxnswcmyassf`) | Migrasi SQL dalam `supabase/migrations/` (001 → 003), digunakan mengikut turutan |

## 2. Konfigurasi persekitaran

Tiada fail `.env` atau rahsia dalam pelayar. Satu-satunya konfigurasi ialah dalam `js/cloud.js`:

```js
export const CLOUD = { url: 'https://ajlxptgbwxnswcmyassf.supabase.co', key: 'sb_publishable_…' };
```

Kunci *publishable* memang selamat untuk pelayar. **Jangan sekali-kali** letak kunci `service_role` / `secret` dalam repo atau kod hadapan.
Jika menukar projek Supabase: kemas kini `CLOUD` dan `connect-src` dalam CSP `index.html` + `checkin.html` (https:// dan wss://).

## 3. Tetapan Supabase (sekali, di Dashboard)

1. **Authentication → URL Configuration**
   - *Site URL:* `https://fkm-it.github.io/lucky-duck-race/`
   - *Redirect URLs:* tambah `https://fkm-it.github.io/lucky-duck-race/**`
   (Pautan pengesahan e-mel & set semula kata laluan akan kembali ke aplikasi.)
2. **Authentication → Providers → Email**: hidup. *Confirm email* disyorkan **hidup** (akaun baharu mengesahkan e-mel; peranan masih perlu diluluskan pentadbir).
3. (Pilihan) **Authentication → SMTP**: gunakan SMTP UTM untuk penghantaran e-mel yang lebih dipercayai (SMTP lalai Supabase terhad bilangan e-mel sejam).
4. **Database → Replication / Realtime**: jadual `public.ldr_pulse` sudah ditambah ke `supabase_realtime` oleh migrasi.

## 4. Pentadbir pertama

1. Buka aplikasi → **Daftar akaun baharu** (nama, e-mel, kata laluan ≥ 8 aksara dengan huruf + nombor).
2. Sahkan e-mel (jika diminta) → log masuk → skrin *Akaun menunggu kelulusan* memaparkan medan **Kod pentadbir pertama**.
3. Masukkan kod yang diberikan secara peribadi (sekali guna). Akaun anda menjadi **Pentadbir**.
4. Pengguna lain: daftar sendiri → **Tetapan Sistem → Pengguna & peranan** → pilih peranan / gantung akaun.

## 5. Memindahkan data dari pelayar versi lama

Pada pelayar yang ada data lama (cth. 201 peserta), log masuk sebagai **pentadbir** → dialog *Data dalam pelayar ini* → **Muat naik ke pangkalan data pusat**. Rekod yang sudah wujud di pusat tidak ditimpa; tiada rekod setempat dipadam sebelum dimuat naik. Pelayar lain pilih **Guna data pusat sahaja**.
Kod QR yang sudah dicetak (majlis lama): di laptop asal, **Tetapan → Kekalkan kod QR bercetak**.

## 6. Sandaran & pemulihan

| Jenis | Bila | Cara |
|---|---|---|
| Sandaran aplikasi (JSON) | Sebelum & selepas setiap majlis | **Tetapan → Muat turun sandaran** (pentadbir). Mengandungi staf, kehadiran, peserta, hadiah, cabutan, pemenang, audit, tetapan majlis aktif. Tanpa kata laluan / token. |
| Laporan | Selepas majlis | **Laporan & Eksport** → Excel / CSV / PDF |
| Pangkalan data penuh | Harian (automatik) | Supabase Dashboard → *Database → Backups* (pelan berbayar: PITR). Pelan percuma: jalankan `pg_dump` mingguan: `pg_dump "$DB_URL" -n luckyduck -Fc -f luckyduck-$(date +%F).dump` |

**Pemulihan**
- Dari JSON: **Tetapan → Pulihkan sandaran** (taip `PULIH`) → data majlis aktif digantikan dan disegerak ke pusat.
- Dari `pg_dump`: `pg_restore --clean --if-exists -n luckyduck -d "$DB_URL" fail.dump` (lakukan di luar waktu majlis; semua pelayar akan menarik semula data).

## 7. Senarai semak hari majlis

- [ ] Semua akaun kaunter & operator boleh log masuk (lakukan **dalam talian** sekurang-kurangnya sekali di setiap peranti — membolehkan log masuk luar talian).
- [ ] Laptop pentas: **Tetapan → Jadikan peranti ini Peranti Kawalan**, mod paparan 3D/2D, bunyi diuji.
- [ ] Bilangan peserta / layak sama di semua peranti (lihat bar atas).
- [ ] QR dipaparkan / dicetak; uji satu imbasan.
- [ ] Penunjuk sambungan `ONLINE`. Jika `OFFLINE`: kaunter terus sahkan kehadiran (baris gilir), cabutan hanya di Peranti Kawalan.
- [ ] Selepas majlis: pastikan semua peranti `SYNC COMPLETE` (0 menunggu) **sebelum** log keluar / tutup pelayar, kemudian eksport laporan & sandaran.

## 8. Penyelesaian masalah

| Gejala | Punca / tindakan |
|---|---|
| `SYNCING (n)` tidak berkurang | Semak internet. Rekod ditolak dipaparkan sebagai notis merah (konflik / tiada kebenaran). Log terperinci: jadual `luckyduck.sync_queue`. |
| "Sesi log masuk tamat" | Log keluar & log masuk semula dalam talian. |
| Log masuk luar talian ditolak | Pengguna belum pernah log masuk dalam talian di peranti ini. |
| Akaun "menunggu kelulusan" | Pentadbir tetapkan peranan di Tetapan → Pengguna & peranan. |
| Kod QR "tidak sah" | QR telah ditukar — cetak / papar QR terkini. |
| Butang MULA dikelabukan | Luar talian dan peranti ini bukan Peranti Kawalan, atau peranan bukan Operator/Pentadbir. |
