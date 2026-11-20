# Changelog

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
