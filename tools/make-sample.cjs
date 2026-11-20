// Jana fail contoh: samples/peserta-contoh-500.xlsx & .csv (Staff ID teks dengan sifar di hadapan)
const XLSX = require('xlsx');
const fs = require('fs');
const first = ['Ahmad','Siti','Muhammad','Nur','Lim','Tan','Kumar','Priya','Aisyah','Hafiz','Farah','Wong','Raj','Zainab','Amir','Mei Ling','Daniel','Aina','Faizal','Syafiqah'];
const last = ['bin Ali','binti Hassan','bin Ismail','binti Omar','Wei Jie','Chee Keong','a/l Muthu','a/p Rajan','binti Yusof','bin Rahman','binti Ahmad','Kok Leong','a/l Singh','binti Salleh','bin Abdullah','Chen','Lee','binti Zakaria','bin Kassim','binti Ibrahim'];
const depts = ['Unit IT','Kewangan','Sumber Manusia','Pentadbiran','Akademik','Makmal Pembuatan','Penyelidikan','Perpustakaan','Keselamatan','Fasiliti'];
const rows = [['Staff Name','Staff ID','Department']];
for (let i = 1; i <= 500; i++) rows.push([first[i % 20] + ' ' + last[(i * 7) % 20], String(i).padStart(6, '0'), depts[(i * 3) % 10]]);
const ws = XLSX.utils.aoa_to_sheet(rows);
for (let r = 2; r <= 501; r++) { ws['B' + r].t = 's'; ws['B' + r].z = '@'; }
ws['!cols'] = [{ wch: 30 }, { wch: 12 }, { wch: 22 }];
const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Participants');
XLSX.writeFile(wb, 'samples/peserta-contoh-500.xlsx');
fs.writeFileSync('samples/peserta-contoh-500.csv', '﻿' + rows.map((r) => r.join(',')).join('\r\n'));
console.log('ok');
