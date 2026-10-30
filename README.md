# Bible Song Pro + EasyWorship Plugin untuk OBS Studio

Sistem presentasi gereja modern untuk **OBS Studio** yang menggabungkan fitur lengkap **[Bible Song Pro](https://github.com/Johnbatey/bible-song-pro)** dengan kemampuan **Impor Jadwal (.ewsx) & Database EasyWorship 7/6 (Songs.db & SongWords.db)** tanpa internet (100% offline).

---

## 🌟 Fitur Utama

- **Real-time Bible Display:** Navigasi cepat kitab, pasal, ayat, pencarian teks, dual-version Alkitab, dan bookmark ayat. Bundled dengan 4 versi Alkitab resmi: **KJV, NKJV, NLT, dan NASB** (dapat mengimpor Alkitab XML lainnya).
- **Import File & Database EasyWorship (Tetap Dipertahankan):**
  - **Import Jadwal `.ewsx`**: Ekstrak jadwal EasyWorship (seperti file contoh `2_September.ewsx`) langsung ke tab **Setlist** (urutan ibadah teratur) dan perpustakaan lagu secara otomatis!
  - **Import Database Lagu EasyWorship (`Songs.db` & `SongWords.db`)**: Muat ribuan lagu gereja sekaligus lengkap dengan lirik berformat RTF yang otomatis dibersihkan dan dipisah per bait/reff.
  - **Dukungan Istilah Lagu Rohani Indonesia:** Pengenalan otomatis bait/seksi lagu seperti `Bait 1`, `Bait 2`, `Reff`, `Refrain`, `Koor`, `Jembatan`, `Pembuka`, `Penutup` menjadi tombol interaktif sekali klik.
  - **100% Offline:** Menggunakan WebAssembly lokal (`lib/sql-wasm.js`, `lib/sql-wasm-binary.js`, `lib/jszip.min.js`), tidak membutuhkan koneksi internet.
- **Tampilan Khusus OBS (Browser Source & Custom Dock):**
  - **OBS Custom Browser Dock (`Bible Song Pro panel.html`)**: Panel kontrol terintegrasi langsung di dalam jendela OBS Studio.
  - **OBS Browser Source (`BSP_display.html`)**: Output tampilan transparan berperforma tinggi dengan akselerasi GPU hardware, mendukung **Lower Third** (teks di bawah untuk live streaming) dan **Full Screen** (layar penuh untuk proyektor/LCD).
  - **BroadcastChannel Real-Time Sync:** Komunikasi instan antar dock dan layar tanpa lag.
- **Studio Previewer (`index.html`):** Bisa dibuka di browser apa pun (Chrome, Edge, Firefox) untuk latihan atau testing tanpa harus membuka OBS Studio.
- **Integrasi Skrip Python EasyWorship Asli Tetap Tersedia:** Skrip `easyworship_obs.py` dan `ew_companion.py` tetap disertakan bagi pengguna yang ingin sinkronisasi otomatis dari PC EasyWorship via jaringan (network share).

---

## 📁 Struktur File & Direktori

| File / Folder | Fungsi & Keterangan |
|---|---|
| `Bible Song Pro panel.html` | **OBS Custom Browser Dock** — Panel kendali utama (Alkitab, Lagu, Setlist/Jadwal, Media, Styling, dan Impor EasyWorship). |
| `BSP_display.html` | **OBS Browser Source** — Layar output transparan untuk scene OBS (Lower Third / Full Screen, kustomisasi font, efek teks, transisi). |
| `index.html` | **Studio Preview** — Halaman preview browser yang menampilkan control panel dan layar output berdampingan. |
| `js/panel/easyworship-import.js` | Modul importer EasyWorship (membaca `.ewsx`, `Songs.db`, `SongWords.db`, RTF parser). |
| `bibles/` | Folder Alkitab bawaan: KJV, NKJV, NLT, NASB dan manifest Alkitab. |
| `lib/` | Library offline: WebAssembly SQLite (`sql-wasm.js`, `sql-wasm-binary.js`) dan ZIP parser (`jszip.min.js`). |
| `2_September.ewsx` | File contoh jadwal ibadah EasyWorship yang siap diuji dengan sekali klik. |
| `easyworship_overlay.html` | Overlay HTML EasyWorship versi standalone (juga terhubung via BroadcastChannel). |
| `easyworship_obs.py` | Skrip OBS Python untuk sinkronisasi teks lirik EasyWorship via shared network folder. |
| `ew_companion.py` | Skrip pendamping di PC EasyWorship untuk membaca slide aktif secara otomatis. |

---

## 🚀 Panduan Setup di OBS Studio (2 Menit)

### Langkah 1: Tambahkan Output Display ke Scene OBS
1. Buka **OBS Studio**.
2. Pada panel **Sources** di scene Anda, klik tanda **`+`** dan pilih **Browser**.
3. Beri nama: `Bible_Song_Display`.
4. Centang **Local file**, lalu klik **Browse** dan pilih file:
   ```
   D:\LCD\obs-easyworship-plugin\BSP_display.html
   ```
5. Atur resolusi:
   - **Width:** `1920`
   - **Height:** `1080`
6. Centang opsi:
   - ✅ *Shutdown source when not visible* (opsional)
   - ✅ *Refresh browser when scene becomes active* (opsional)
7. Klik **OK**.

---

### Langkah 2: Pasang Control Panel di Dock OBS
1. Di menu atas OBS Studio, klik **Docks** → **Custom Browser Docks...**
2. Isi nama dock dan URL file:
   - **Dock Name:** `Bible Song Pro`
   - **URL:** Path lengkap ke file panel, contoh:
     ```
     D:\LCD\obs-easyworship-plugin\Bible Song Pro panel.html
     ```
     *(atau klik Browse jika tersedia, atau gunakan `file:///D:/LCD/obs-easyworship-plugin/Bible%20Song%20Pro%20panel.html`)*
3. Klik **Apply**.
4. Panel **Bible Song Pro** akan muncul di OBS! Anda bisa mendock/menempelkan panel ini di sisi kanan, kiri, atau bawah OBS Studio.

---

## 📥 Cara Impor File EasyWorship

### A. Impor File Jadwal Ibadah (`.ewsx`)
1. Di panel kontrol, klik tombol **"📂 Import EasyWorship"** di pojok kanan atas atau klik tombol **"EW"** di toolbar.
2. Klik tombol **"⚡ Muat Contoh: 2_September.ewsx"** untuk langsung memuat contoh jadwal yang ada di folder ini, ATAU klik **"📄 Pilih File (.ewsx / .db)"** lalu pilih file `.ewsx` jadwal ibadah Anda.
3. Anda juga dapat langsung melakukan **Drag & Drop** file `.ewsx` ke jendela panel!
4. Hasil impor:
   - Seluruh item ibadah terurut rapi di tab **Setlist** (siap ditampilkan live satu per satu).
   - Lagu-lagu baru otomatis tersimpan permanen di tab **Songs**.

### B. Impor Database Lagu EasyWorship (`Songs.db` & `SongWords.db`)
1. Buka modal **Import EasyWorship**.
2. Klik tombol **"📁 Pilih Folder Database EW"** lalu arahkan ke folder database EasyWorship di PC Anda:
   ```
   C:\Users\Public\Documents\Softouch\EasyWorship 7\Default\Databases\Data
   ```
   *(Gunakan tombol "Salin Path" untuk memudahkan pencarian folder di File Explorer)*
3. Ribuan lagu akan langsung diproses, lirik dibersihkan dari kode RTF, dan otomatis disimpan di memori browser/OBS (IndexedDB) sehingga tetap ada saat OBS dibuka kembali.

---

## 📖 Cara Menggunakan Panel

### 1. Menampilkan Ayat Alkitab
1. Buka tab **Bible**.
2. Pilih versi Alkitab (KJV, NKJV, NLT, NASB) di bar versi.
3. Pilih Kitab dan Pasal melalui dropdown atau ketik di kotak pencarian (contoh: `Yohanes 3:16` atau `John 3:16`).
4. Klik ayat yang ingin ditampilkan.
5. Klik **Project** (atau klik langsung pada tombol ayat jika mode Live aktif) untuk menampilkan ke layar OBS!

### 2. Menampilkan Lirik Lagu
1. Buka tab **Songs**.
2. Cari judul lagu atau kata dalam lirik di kotak pencarian.
3. Klik lagu yang dipilih.
4. Di panel tengah akan muncul tombol-tombol bait/bagian lirik (`Verse 1`, `Chorus`, `Bait 1`, `Reff`, dll.).
5. Klik tombol bait yang ingin ditampilkan untuk live stream!

### 3. Menggunakan Setlist (Urutan Ibadah)
1. Buka tab **Setlist**.
2. Item dari jadwal EasyWorship yang sudah diimpor akan tampil di sini.
3. Anda dapat menambah ayat atau lagu baru ke Setlist kapan saja dengan tombol `+ Set`.
4. Atur urutan ibadah dengan drag-and-drop atau panah naik/turun.
5. Klik item untuk langsung mengontrol bagian-bagiannya secara berurutan selama ibadah berlangsung.

### 4. Mengubah Tampilan (Lower Third vs Layar Penuh)
1. Buka menu **Settings** (ikon roda gigi) di panel.
2. Pilih mode tampilan yang diinginkan:
   - **Lower Third:** Sangat ideal untuk live streaming streaming YouTube/Facebook dengan latar transparan di bagian bawah video.
   - **Full Screen:** Tampilan teks besar di tengah layar untuk proyektor LCD ruangan gereja.
3. Anda dapat mengatur font (Segoe UI, Montserrat, Arial, dll.), ukuran font, warna teks, bayangan teks (text shadow), background semi-transparan, hingga efek animasi transisi fade/slide.

---

## 🛠️ Pilihan Alternatif: Skrip Python Network Share (Bawaan Lama)

Jika Anda tetap ingin menggunakan EasyWorship asli di PC operator dan membuat OBS di PC streaming membaca slide aktif secara real-time melalui jaringan lokal:
1. Jalankan `ew_companion.py` di PC EasyWorship:
   ```powershell
   python ew_companion.py --share-path "C:\EWShare"
   ```
2. Di OBS Studio PC streaming:
   - Masuk ke menu **Tools** → **Scripts**
   - Tambahkan skrip `easyworship_obs.py`
   - Atur path ke folder jaringan dan arahkan ke Text Source `EW_Lyrics`.
   - Klik **Start Monitoring**.

---

## 📄 Lisensi

- Bible Song Pro dilisensikan di bawah lisensi terbuka oleh Johnson Olakotan ([github.com/Johnbatey/bible-song-pro](https://github.com/Johnbatey/bible-song-pro)).
- Modul integrasi EasyWorship dan skrip plugin disediakan bebas untuk pelayanan gereja dan live streaming.
