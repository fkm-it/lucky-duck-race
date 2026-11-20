# 🤘 ROCK THE DRAW — *Let's Rock. Let's Win!*

(dahulunya Lucky Duck Race)

Sistem cabutan bertuah **perlumbaan itik 3D** untuk majlis korporat, universiti, makan malam tahunan dan majlis penghargaan staf. Setiap peserta = seekor itik. Pemenang dipilih secara **rawak kriptografi** sebelum perlumbaan, animasi memaparkan keputusan itu, dan pemenang **dibuang automatik** daripada kumpulan layak.

**Live:** `https://<owner>.github.io/<repo>/` · berfungsi **luar talian** selepas lawatan pertama.

## Ciri utama

| Modul | Ringkasan |
|---|---|
| Pentas perlumbaan | 3D (Three.js, 1 draw call / bahagian itik → 1,000+ itik lancar), kiraan detik 3-2-1-GO, kamera dinamik, penonton bersorak, mahkota emas, sorotan, konfeti, bunga api. Mod 2D untuk komputer lemah. Skrin penuh 16:9. |
| Keadilan | `crypto.getRandomValues` + *rejection sampling* + Fisher–Yates → setiap peserta berkebarangkalian sama. Pemilihan berlaku dalam **satu transaksi IndexedDB** sebelum animasi; animasi tidak boleh mempengaruhi keputusan. Kod integriti SHA-256 bagi setiap cabutan. |
| Peserta | Import .xlsx / .xls / .csv, pemetaan lajur, pratonton, validasi (wajib, pendua dalam fail, sudah wujud, format saintifik Excel). **Staff ID disimpan sebagai TEKS** (sifar di hadapan kekal). Tambah / sunting / padam / cari / tapis jabatan / status. |
| Hadiah | Grand / First / Second / Third / Consolation / Special — nama, imej, bilangan, keterangan, turutan. Jumlah pemenang dikira automatik. |
| Cabutan | Pilih hadiah & bilangan, mod **A: Satu demi satu** atau **B: Grand Finale**. Pemenang tidak boleh menang lagi (kecuali tetapan admin). |
| Sejarah | Draw ID, No. pemenang, nama, Staff ID, jabatan, kategori, hadiah, tarikh, masa. Pulih kelayakan (dengan sebab), main semula perlumbaan, eksport **Excel / CSV / PDF**. |
| Admin | Log masuk (PBKDF2-SHA256), statistik langsung, log audit, sandaran/pulih JSON, reset (taip `RESET`). |
| Bunyi | Kiraan detik, hon, larian, muzik, kemenangan, tepukan, bunga api — disintesis (tiada fail), kelantangan setiap saluran + utama. **Senyap secara lalai.** |

## Pendaftaran kehadiran (QR) — pilihan

1. **Kehadiran (QR)** → *Cipta majlis dalam talian* → muat naik **senarai semua staf** (Excel: Staff Name, Staff ID, Department).
2. Paparkan QR di meja pendaftaran (*Papar skrin penuh*) atau *Cetak poster*.
3. Staf imbas QR → masukkan **No. Pekerja** → semak maklumat → **Sahkan Kehadiran**.
4. Laptop menyegerak setiap 5 saat → staf yang hadir **automatik menjadi peserta cabutan**. Staf tanpa telefon boleh disahkan manual di kaunter.

Pelayan: Supabase projek `dashboard-unit-it-fkm`, skema `luckyduck` (lihat `supabase/migrations/`). Pendaftaran memerlukan internet; perlumbaan tidak.

## Aliran majlis

1. Buka aplikasi → tetapkan kata laluan pentadbir (kali pertama).
2. **Import Excel** (`samples/peserta-contoh-500.xlsx` untuk cubaan) → padankan lajur → semak → sahkan.
3. **Hadiah** → tambah kategori (atau "Guna susunan contoh").
4. **Mula Perlumbaan** → pilih hadiah, bilangan, mod pendedahan → *Buka Pentas*.
5. Tekan **F** (skrin penuh) → **MULA / Space** → itik berlumba → pengumuman pemenang.
6. Ulang untuk hadiah seterusnya → **Sejarah Pemenang** → eksport laporan.

Pintasan pentas: `Space` mula / seterusnya · `F` skrin penuh · `M` bunyi · `Esc` tutup.

## Seni bina

```
index.html            kerangka + CSP ketat (script-src 'self')
css/app.css           gaya admin (minimal) + pentas (LED/projektor)
js/main.js            log masuk, hash router, statistik
js/store.js           peraturan perniagaan + transaksi (cabutan, pulih, reset, sandaran)
js/db.js              IndexedDB (participants, prizes, draws, winners, audit, settings)
js/rng.js             rawak kriptografi tanpa bias, SHA-256
js/logic.js           logik tulen: validasi import, status hadiah, pelan perlumbaan, susun atur
js/race.js            pengawal pentas (MULA → cabutan → kiraan detik → perlumbaan → pengumuman)
js/race3d.js          pemapar Three.js (InstancedMesh)        js/race2d.js  pemapar kanvas 2D
js/audio.js           bunyi Web Audio                          js/fx.js      konfeti & bunga api
js/io.js              SheetJS: baca Excel/CSV, eksport XLSX/CSV, laporan cetak
js/views/*.js         Dashboard, Peserta, Import, Hadiah, Cabutan, Sejarah, Audit, Tetapan
vendor/               three.module.min.js, xlsx.full.min.js (luar talian, tiada CDN masa jalan)
sw.js                 DIJANA (npm run build:sw) — cache semua aset
```

Asas PWA & aliran deploy diambil daripada templat `gas-pwa-starter` (service worker cache-dahulu, manifest, ikon, GitHub Actions → Pages). Data disimpan dalam **IndexedDB** pelayar (bukan Apps Script) supaya majlis tidak bergantung pada internet.

## Pembangunan

```bash
npm ci
npm test            # ujian unit + aliran storan penuh (fake-indexeddb)
npm run check       # sintaks, corak XSS, sw.js terkini
npm run dev         # http://localhost:8080
npm run e2e         # Playwright: import → hadiah → 2 cabutan 3D → pulih → eksport → 2D → telefon 360px → luar talian
npm run build:sw    # WAJIB selepas mengubah mana-mana fail aset
```

## Deploy (GitHub Pages)

Setiap push ke `main` → `.github/workflows/deploy.yml` (ujian → binaan → Pages). Persediaan sekali: **Settings → Pages → Source: GitHub Actions**. CI menggantikan SheetJS dengan versi 0.20.3 daripada CDN rasmi SheetJS (membetulkan CVE dalam versi npm 0.18.x).

## Keselamatan & had

- Semua HTML dinamik melalui `html```(auto-escape); CSP ketat; sel eksport dineutralkan daripada *formula injection*.
- Log masuk melindungi panel pada komputer majlis. Oleh kerana tiada pelayan, sesiapa yang mempunyai akses penuh kepada pelayar/komputer boleh memeriksa IndexedDB — gunakan akaun komputer yang dikunci.
- Data hanya wujud pada **pelayar & komputer itu**. Muat turun **sandaran JSON** selepas majlis. Mengosongkan data pelayar akan memadam rekod.
- Supabase digunakan untuk modul kehadiran sahaja; cabutan & sejarah pemenang kekal di laptop (IndexedDB).
- Token QR mengesahkan staf berada di majlis, bukan identiti mereka — sesiapa yang mempunyai QR dan No. Pekerja orang lain boleh mengesahkan bagi pihaknya. Tukar kod QR jika tersebar.
