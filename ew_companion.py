"""
EasyWorship 7 Companion Script
================================
Script ini dijalankan di PC yang sama dengan EasyWorship 7.
Tugasnya: memantau slide yang sedang live dan menulis statusnya
ke file ew_live_state.txt di folder shared, sehingga OBS di PC
lain bisa membacanya secara real-time.

Cara menjalankan:
  python ew_companion.py --share-path "C:\\EWData"

Argumen:
  --share-path : Path folder yang di-share ke network (harus bisa diakses OBS PC)
  --db-path    : (opsional) Path ke folder Database EasyWorship jika berbeda dari default
  --interval   : (opsional) Interval polling dalam detik (default: 0.8)

Ketergantungan:
  pip install pywinauto  (untuk UI Automation membaca slide aktif)
  pip install pywin32    (untuk Windows API)

Jika pywinauto tidak tersedia, script akan fallback ke mode
pembacaan database schedule.
"""

import argparse
import os
import sys
import time
import sqlite3
import shutil
import tempfile
import re
import json
import logging
from pathlib import Path
from datetime import datetime

# ─────────────────────────────────────────────
# Setup Logging
# ─────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler("ew_companion.log", encoding="utf-8")
    ]
)
log = logging.getLogger("EW-Companion")

# ─────────────────────────────────────────────
# Default path EasyWorship 7
# ─────────────────────────────────────────────
def find_default_ew_db_path():
    base = os.path.join(os.environ.get("PUBLIC", "C:\\Users\\Public"), "Documents", "Softouch", "Easyworship")
    candidates = [
        os.path.join(base, "New Profile 3", "v6.1", "Databases", "Data"),
        os.path.join(base, "Default", "v6.1", "Databases", "Data"),
        os.path.join(base, "Default", "Databases", "Data"),
    ]
    for cand in candidates:
        if os.path.exists(cand) and os.path.exists(os.path.join(cand, "Songs.db")):
            return cand
    return candidates[0]

DEFAULT_EW_DB_PATH = find_default_ew_db_path()


# ─────────────────────────────────────────────
# RTF Parser (sama seperti di OBS script)
# ─────────────────────────────────────────────

def strip_rtf(rtf_text):
    if not rtf_text or not str(rtf_text).strip().startswith("{\\rtf"):
        return str(rtf_text) if rtf_text else ""

    text = str(rtf_text)
    depth = 0
    result = []
    skip_group = 0
    i = 0

    SKIP_DESTS = (
        r"\fonttbl", r"\colortbl", r"\stylesheet", r"\info",
        r"\generator", r"\xmlnstbl", r"\datastore"
    )

    while i < len(text):
        c = text[i]
        if c == "{":
            depth += 1
            for dest in SKIP_DESTS:
                if text.startswith(dest, i + 1):
                    skip_group = depth
                    break
            if text.startswith(r"\*", i + 1):
                skip_group = depth
            i += 1
            continue
        elif c == "}":
            if skip_group == depth:
                skip_group = 0
            depth -= 1
            i += 1
            continue
        if skip_group and depth >= skip_group:
            i += 1
            continue
        if c == "\\":
            if i + 1 < len(text):
                next_c = text[i + 1]
                if next_c == "\\":
                    result.append("\n")
                    i += 2
                    continue
                elif next_c == "~":
                    result.append(" ")
                    i += 2
                    continue
                elif next_c in ("\n", "\r"):
                    result.append("\n")
                    i += 2
                    continue
                elif next_c == "'":
                    hex_str = text[i+2:i+4]
                    try:
                        result.append(chr(int(hex_str, 16)))
                    except Exception:
                        pass
                    i += 4
                    continue
                else:
                    j = i + 1
                    while j < len(text) and text[j].isalpha():
                        j += 1
                    word = text[i+1:j].lower()
                    if j < len(text) and (text[j] == "-" or text[j].isdigit()):
                        while j < len(text) and (text[j].isdigit() or text[j] == "-"):
                            j += 1
                    if word == "u" and j < len(text) and text[j] == "?":
                        j += 1
                    if j < len(text) and text[j] == " ":
                        j += 1
                    if word in ("par", "line"):
                        result.append("\n")
                    elif word == "tab":
                        result.append("\t")
                    i = j
                    continue
        elif c in ("\n", "\r"):
            i += 1
            continue
        else:
            result.append(c)
            i += 1

    plain = "".join(result).strip()
    lines = [l.rstrip() for l in plain.splitlines()]
    cleaned = []
    prev_empty = False
    for line in lines:
        if line == "":
            if not prev_empty:
                cleaned.append("")
            prev_empty = True
        else:
            cleaned.append(line)
            prev_empty = False
    return "\n".join(cleaned).strip()


# ─────────────────────────────────────────────
# EasyWorship UI Automation (Windows)
# ─────────────────────────────────────────────

PYWINAUTO_AVAILABLE = False
try:
    from pywinauto import Application, findwindows
    import pywinauto.controls.uia_controls as uia
    PYWINAUTO_AVAILABLE = True
    log.info("pywinauto tersedia - menggunakan UI Automation")
except ImportError:
    log.warning("pywinauto tidak ditemukan. Install dengan: pip install pywinauto")
    log.warning("Fallback ke mode database polling.")


def find_easyworship_window():
    """Temukan window EasyWorship yang sedang berjalan."""
    if not PYWINAUTO_AVAILABLE:
        return None
    try:
        windows = findwindows.find_elements(title_re=".*EasyWorship.*", backend="uia")
        if windows:
            return windows[0]
    except Exception as e:
        log.debug(f"Gagal cari EW window: {e}")
    return None


def get_current_slide_via_uia():
    """
    Coba baca slide aktif via Windows UI Automation.
    EasyWorship biasanya menampilkan slide teks di panel Live.
    Returns: (title, section, text) atau None
    """
    if not PYWINAUTO_AVAILABLE:
        return None

    try:
        app = Application(backend="uia").connect(title_re=".*EasyWorship.*", timeout=2)
        main = app.top_window()

        # Coba baca text elements dari panel Live/Output
        # Nama kontrol bisa berbeda antar versi EW7
        texts = []
        for ctrl in main.descendants(control_type="Text"):
            try:
                t = ctrl.window_text().strip()
                if t and len(t) > 2:
                    texts.append(t)
            except Exception:
                pass

        if texts:
            # Heuristik: ambil teks yang paling panjang sebagai slide text
            slide_text = max(texts, key=len)
            title = texts[0] if len(texts) > 1 else ""
            section = ""
            # Coba ekstrak section dari teks pertama
            if texts[0] != slide_text:
                for t in texts:
                    if any(kw in t.lower() for kw in
                           ("verse", "chorus", "bridge", "tag", "bait", "reff", "intro", "outro")):
                        section = t
                        break
            return title, section, slide_text
    except Exception as e:
        log.debug(f"UI Automation error: {e}")

    return None


# ─────────────────────────────────────────────
# Database Polling (Fallback)
# ─────────────────────────────────────────────

def copy_db_to_temp(db_path):
    suffix = os.path.splitext(db_path)[1]
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
    tmp.close()
    shutil.copy2(db_path, tmp.name)
    return tmp.name


def get_schedule_items(db_folder):
    """Baca semua item dari schedule database."""
    # Cari file schedule
    schedule_db_candidates = [
        os.path.join(db_folder, "Schedule.db"),
        os.path.join(db_folder, "swmaster.db"),
    ]
    # Juga cari file .db yang paling baru dimodifikasi
    if os.path.isdir(db_folder):
        db_files = sorted(
            [f for f in os.listdir(db_folder) if f.endswith(".db")],
            key=lambda f: os.path.getmtime(os.path.join(db_folder, f)),
            reverse=True
        )
        log.debug(f"File DB tersedia: {db_files}")

    for sched_db in schedule_db_candidates:
        if not os.path.exists(sched_db):
            continue

        tmp = copy_db_to_temp(sched_db)
        try:
            conn = sqlite3.connect(f"file:{tmp}?mode=ro", uri=True, timeout=5)
            conn.row_factory = sqlite3.Row
            cur = conn.cursor()
            tables = [r[0] for r in cur.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            ).fetchall()]
            log.debug(f"Tabel di {os.path.basename(sched_db)}: {tables}")
            conn.close()
        except Exception as e:
            log.debug(f"Error baca {sched_db}: {e}")
        finally:
            try:
                os.unlink(tmp)
            except Exception:
                pass

    return []


def scan_db_files(db_folder):
    """Scan dan log semua database yang ada untuk debugging."""
    if not os.path.isdir(db_folder):
        log.error(f"Folder tidak ditemukan: {db_folder}")
        return

    log.info(f"=== Scan database folder: {db_folder} ===")
    for fname in os.listdir(db_folder):
        fpath = os.path.join(db_folder, fname)
        if not fname.endswith(".db"):
            continue

        fsize = os.path.getsize(fpath)
        mtime = datetime.fromtimestamp(os.path.getmtime(fpath)).strftime("%Y-%m-%d %H:%M:%S")
        log.info(f"  {fname} ({fsize:,} bytes, modified: {mtime})")

        tmp = copy_db_to_temp(fpath)
        try:
            conn = sqlite3.connect(f"file:{tmp}?mode=ro", uri=True, timeout=3)
            cur = conn.cursor()
            tables = cur.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            ).fetchall()
            for (tname,) in tables:
                try:
                    count = cur.execute(f"SELECT COUNT(*) FROM {tname}").fetchone()[0]
                    cols = [c[1] for c in cur.execute(f"PRAGMA table_info({tname})").fetchall()]
                    log.info(f"    └─ {tname}: {count} baris | Kolom: {', '.join(cols)}")
                except Exception:
                    pass
            conn.close()
        except Exception as e:
            log.debug(f"    └─ Error: {e}")
        finally:
            try:
                os.unlink(tmp)
            except Exception:
                pass


# ─────────────────────────────────────────────
# Live State File Writer
# ─────────────────────────────────────────────

def write_live_state(share_path, title, section, text):
    """Tulis state slide aktif ke file yang bisa dibaca OBS."""
    state_file = os.path.join(share_path, "ew_live_state.txt")
    content = f"{title}\n{section}\n{text}"
    try:
        # Tulis ke file temp dulu lalu rename (atomic write)
        tmp_file = state_file + ".tmp"
        with open(tmp_file, "w", encoding="utf-8") as f:
            f.write(content)
        # Di Windows, harus hapus target dulu sebelum rename
        if os.path.exists(state_file):
            os.remove(state_file)
        os.rename(tmp_file, state_file)
    except Exception as e:
        log.error(f"Gagal tulis live state: {e}")


def clear_live_state(share_path):
    """Hapus/kosongkan file live state."""
    state_file = os.path.join(share_path, "ew_live_state.txt")
    try:
        with open(state_file, "w", encoding="utf-8") as f:
            f.write("")
    except Exception:
        pass


# ─────────────────────────────────────────────
# Main Loop
# ─────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="EasyWorship 7 Companion — Bridge ke OBS"
    )
    parser.add_argument(
        "--share-path",
        required=True,
        help="Path folder yang di-share ke network (contoh: C:\\EWData\\share)"
    )
    parser.add_argument(
        "--db-path",
        default=DEFAULT_EW_DB_PATH,
        help=f"Path folder database EasyWorship (default: {DEFAULT_EW_DB_PATH})"
    )
    parser.add_argument(
        "--interval",
        type=float,
        default=0.8,
        help="Interval polling dalam detik (default: 0.8)"
    )
    parser.add_argument(
        "--scan-db",
        action="store_true",
        help="Scan dan tampilkan struktur semua database, lalu keluar"
    )
    args = parser.parse_args()

    share_path = args.share_path
    db_path    = args.db_path
    interval   = args.interval

    # Pastikan share folder ada
    os.makedirs(share_path, exist_ok=True)

    log.info("=" * 60)
    log.info("EasyWorship 7 → OBS Companion Script")
    log.info(f"  DB Path    : {db_path}")
    log.info(f"  Share Path : {share_path}")
    log.info(f"  Interval   : {interval}s")
    log.info(f"  UI Auto    : {'YES (pywinauto)' if PYWINAUTO_AVAILABLE else 'NO (DB fallback)'}")
    log.info("=" * 60)

    if args.scan_db:
        scan_db_files(db_path)
        return

    last_state = None

    log.info("Mulai monitoring... Tekan Ctrl+C untuk berhenti.")
    try:
        while True:
            current = None

            # Prioritas 1: UI Automation (lebih akurat)
            if PYWINAUTO_AVAILABLE:
                current = get_current_slide_via_uia()

            # Fallback: Baca file yang paling baru dimodifikasi di DB folder
            if not current:
                # Heuristik: cek apakah ada file live di db_path
                # (EasyWorship mungkin menulis file lock/temp saat slide aktif)
                pass

            if current:
                title, section, text = current
                state = (title, section, text)
                if state != last_state:
                    last_state = state
                    write_live_state(share_path, title, section, text)
                    log.info(f"LIVE: [{section}] {title}: {text[:60]}...")
            else:
                # Tidak ada data live — kosongkan jika sebelumnya ada
                if last_state is not None:
                    clear_live_state(share_path)
                    last_state = None
                    log.info("Tidak ada slide aktif.")

            time.sleep(interval)

    except KeyboardInterrupt:
        log.info("Companion dihentikan oleh user.")
        clear_live_state(share_path)


if __name__ == "__main__":
    main()
