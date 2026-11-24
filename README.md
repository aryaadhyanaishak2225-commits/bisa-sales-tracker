# BISA — Sales Tracker

Aplikasi web/PWA untuk rekap penjualan harian, mingguan, dan bulanan SA Home Credit.

## Isi aplikasi

- Input Sales Volume, Pelanggan Baru, Premi VAS, dan Premi SAI.
- Target otomatis berdasarkan vintage.
- Dashboard target, realisasi, persentase, skor berbobot, serta kekurangan target.
- Riwayat transaksi dan rekap periode.
- Ekspor PDF, Excel (.xls), serta backup/pemulihan JSON.
- Jam dan tanggal berjalan, splash screen, dan desain merah-putih.
- Penyimpanan lokal di perangkat dan cache offline setelah kunjungan pertama.

## Publikasi dengan GitHub Pages

1. Buat repository baru bernama `bisa-sales-tracker`.
2. Atur repository menjadi **Public** jika menggunakan GitHub Free.
3. Upload seluruh isi folder ini ke **root** repository. Pastikan `index.html` berada langsung di root, bukan di dalam subfolder.
4. Buka **Settings → Pages**.
5. Di **Build and deployment**, pilih **Deploy from a branch**.
6. Pilih branch `main` dan folder `/(root)`, lalu tekan **Save**.
7. Setelah deployment selesai, buka alamat yang ditampilkan di bagian GitHub Pages.
8. Di Chrome Android, buka alamat tersebut, tekan menu `⋮`, lalu pilih **Install app** atau **Tambahkan ke layar utama**.

## Privasi dan backup

Repository dan situs GitHub Pages dapat terlihat publik. Jangan menyimpan data pelanggan, nomor telepon, nomor kontrak, atau informasi pribadi di file repository.

Catatan penjualan yang dimasukkan ke aplikasi disimpan di penyimpanan browser/perangkat (localStorage), bukan ke GitHub dan tidak otomatis tersinkron ke perangkat lain. Gunakan fitur **Backup data** secara berkala dan simpan file JSON di tempat aman.

## Catatan teknis

- Ini adalah Progressive Web App (PWA), bukan APK Android native.
- GitHub Pages menyediakan HTTPS, yang dibutuhkan untuk service worker dan instalasi PWA.
- Service worker memakai cache bernama khusus agar tidak menghapus cache aplikasi lain pada origin GitHub Pages.
- File PDF dibuat melalui dialog cetak browser (pilih Save as PDF). Ekspor Excel menghasilkan file `.xls` yang dapat dibuka oleh Excel atau aplikasi spreadsheet kompatibel.
