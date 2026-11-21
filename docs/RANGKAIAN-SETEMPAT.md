# Mod rangkaian setempat (LAN) — berbilang peranti tanpa internet

## Status: **belum dibina** (didokumentasikan sahaja, atas keputusan v4)

Penting untuk difahami: **storan pelayar (IndexedDB) adalah khusus peranti.** Tanpa internet, Chrome di laptop A dan telefon B **tidak boleh** berkongsi data secara automatik. Aplikasi ini tidak berpura-pura sebaliknya:

| Keadaan | Yang berfungsi | Yang tidak |
|---|---|---|
| Internet ada | Semua peranti berkongsi pangkalan data pusat (masa nyata) | — |
| Internet terputus | Setiap peranti terus bekerja dengan data terakhir yang disegerak: kaunter sahkan kehadiran (baris gilir), Peranti Kawalan jalankan cabutan | Peranti tidak nampak perubahan peranti lain sehingga internet pulih. Telefon staf (QR) tidak boleh mendaftar sendiri. |
| Internet pulih | Semua baris gilir dihantar automatik; pendua kehadiran ditolak oleh pelayan; Peranti Kawalan menang untuk keputusan cabutan | — |

## Pilihan jika WiFi dewan memang tidak boleh diharap

### Pilihan A (disyorkan, tiada pembangunan): internet sandaran
Hotspot telefon / router 4G/5G khusus untuk kaunter & laptop pentas. Trafik aplikasi sangat kecil (≈ beberapa KB setiap pengesahan).

### Pilihan B: pelayan LAN pada laptop (pembangunan tambahan)
Laptop pentas menjalankan pelayan kecil; semua telefon & laptop disambung ke router WiFi yang sama (tanpa internet).

```
 Telefon / laptop kaunter ──WiFi──► Laptop pelayan (Node.js + SQLite/PostgreSQL setempat)
                                        │  API sama seperti RPC ldr_* (sync_pull / sync_push / checkin / draw)
                                        └──► bila internet pulih: hantar baris gilir ke Supabase (ldr_sync_push)
```

Keperluan pelaksanaan (anggaran 3–5 hari kerja + ujian):
1. `server/` Node.js (Fastify) + SQLite: jadual & peraturan yang sama (kekangan unik kehadiran, pencetus kehadiran → peserta, cabutan atomik).
2. Sijil HTTPS setempat (mkcert) — Service Worker & kamera memerlukan konteks selamat; atau akses melalui `http://` dengan had PWA.
3. Klien: `CLOUD.url` boleh ditukar kepada alamat LAN (cth. `https://192.168.1.10:8443`) melalui Tetapan.
4. Pengesahan: pengguna log masuk dalam talian sekali dahulu; pelayan LAN menerima token yang telah disahkan / senarai pengguna yang disegerak.
5. Penyegerakan naik: pelayan LAN bertindak sebagai "Peranti Kawalan" tunggal ke Supabase.
6. Ujian 11 spesifikasi: beberapa peranti mendaftar serentak melalui LAN tanpa internet → satu pangkalan data majlis, tiada pendua.

Beritahu jika Pilihan B diperlukan; seni bina v4 (RPC & format baris gilir yang sama) direka supaya pelayan LAN boleh ditambah tanpa mengubah aplikasi pelayar.
