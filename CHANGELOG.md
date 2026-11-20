# Changelog

## 1.2.1 — 2026-11-20
- Semakan bahasa: istilah & ayat Bahasa Melayu Malaysia di seluruh sistem (No. Pekerja, Panel Pentadbir, Laporan & Eksport, Imbas Kod QR, Set semula, komputer).
- Kategori hadiah dalam BM: Hadiah Utama / Pertama / Kedua / Ketiga / Sagu Hati / Istimewa (kategori lama dipetakan automatik).
- Tajuk lajur eksport Excel/CSV/PDF & templat import dalam BM; import menerima tajuk BM atau Inggeris.
- "Segerak sekarang" → "Kemas kini sekarang"; butang Batal → Cancel.

## 1.2.0 — 2026-11-20
- Antara muka baharu ikut mockup: tema ungu/emas, maskot itik bergoggle, logo LUCKY DUCK RACE.
- **Paparan Utama** awam: butang Pendaftaran Kehadiran Staf (papar QR) & Cabutan Bertuah, menu ikon admin.
- Panel admin: sidebar baharu (Dashboard, Data Staf, Pendaftaran Kehadiran, Peserta Cabutan, Cabutan Bertuah, Rekod Pemenang, Laporan & Export, Tetapan Sistem, Log Keluar).
- **Dashboard Acara**: maklumat majlis (tarikh, lokasi), 4 kad statistik, carta donat kehadiran, aktiviti terkini.
- Laman kehadiran telefon & poster QR (standee) direka semula; halaman **Laporan & Export** baharu (pemenang, peserta, kehadiran, audit, sandaran).
- Pentas: itik bergoggle + bib, trek ungu/merah jambu, garisan FINISH berpetak, bar HUD bawah dengan butang **MULA CABUTAN**; skrin **TAHNIAH!** dengan jadual pemenang.

## 1.1.0 — 2026-11-20
- Modul **Kehadiran (QR)**: senarai staf dimuat naik ke pelayan majlis (Supabase); staf imbas QR → masukkan No. Pekerja → maklumat dipaparkan → **Sahkan Kehadiran**.
- Staf yang hadir **automatik menjadi peserta cabutan** (laptop menyegerak setiap 5 saat, nombor itik diberi). Batal kehadiran membuang peserta yang belum menang.
- Panel kehadiran: statistik langsung, buka/tutup pendaftaran, sahkan/batal manual di kaunter, QR skrin penuh & poster cetak, tukar kod QR.
- Keselamatan: jadual dalam skema tidak terdedah; semua akses melalui RPC bertoken (token QR & kunci admin disimpan sebagai hash), had kadar setiap IP.

## 1.0.0 — 2026-11-20
- Keluaran pertama Lucky Duck Race: perlumbaan itik 3D (Three.js, InstancedMesh) + mod 2D sandaran.
- Import Excel/CSV (.xlsx, .xls, .csv) dengan pemetaan lajur, pratonton, validasi, pengesanan pendua; Staff ID sentiasa teks.
- Pemilihan rawak kriptografi (Web Crypto, tanpa bias) dalam satu transaksi IndexedDB; pemenang dibuang automatik daripada kumpulan layak.
- Pengurusan hadiah (kategori, imej, bilangan, turutan), mod pendedahan Satu-demi-satu / Grand Finale.
- Sejarah pemenang, kod integriti SHA-256, pulih kelayakan (dengan sebab), reset, log audit.
- Eksport Excel / CSV / Laporan PDF (cetak), sandaran & pulih JSON.
- Bunyi sintesis (7 saluran, kelantangan berasingan, senyap lalai), konfeti & bunga api.
- PWA luar talian (service worker), log masuk pentadbir PBKDF2.
