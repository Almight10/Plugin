r"""
EasyWorship 7 → OBS Integration Script
=======================================
Script OBS Python yang membaca database EasyWorship 7 (songs.db & SongWords.db)
dari shared network folder dan menampilkan teks slide saat ini ke OBS Text Source.

Cara Pakai:
  1. Share folder database EasyWorship di PC EasyWorship:
     C:\Users\Public\Documents\Softouch\EasyWorship\New Profile 3\v6.1\Databases\Data\
  2. Di OBS: Tools -> Scripts -> tambahkan file ini
  3. Isi path UNC atau drive letter ke folder database tersebut
  4. Buat Text Source di OBS bernama "EW_Lyrics" (bisa dikustomisasi)
  5. Jalankan ew_companion.py di PC EasyWorship
  6. Klik "Start Monitoring"

Dependensi: Hanya Python stdlib (sqlite3, os, re, threading)
"""

import obspython as obs
import sqlite3
import os
import re
import threading
import time
import shutil
import tempfile

# ──────────────────────────────────────────────
# Konfigurasi Global (diisi via OBS Properties)
# ──────────────────────────────────────────────
g_db_path        = ""
g_source_name    = "EW_Lyrics"
g_poll_interval  = 1.5
g_show_section   = True
g_max_lines      = 6
g_monitor_active = False
g_monitor_thread = None
g_last_slide_hash = None
g_status_text    = "Idle"


# ──────────────────────────────────────────────
# RTF Parser
# ──────────────────────────────────────────────

def strip_rtf(rtf_text):
    """Ubah RTF menjadi plain text."""
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
                    # Lewati parameter numerik
                    if j < len(text) and (text[j] == "-" or text[j].isdigit()):
                        while j < len(text) and (text[j].isdigit() or text[j] == "-"):
                            j += 1
                    # Unicode char \uN?
                    if word == "u" and j < len(text) and text[j] == "?":
                        j += 1
                    # Spasi opsional setelah control word
                    if j < len(text) and text[j] == " ":
                        j += 1
                    if word == "par" or word == "line":
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


# ──────────────────────────────────────────────
# Database Utilities
# ──────────────────────────────────────────────

def resolve_ew_folder(folder_path):
    """Auto-resolve subfolder v6.1/Databases/Data jika user mengarahkan ke root folder profil."""
    if not folder_path or not os.path.exists(folder_path):
        return folder_path
    if os.path.exists(os.path.join(folder_path, "Songs.db")):
        return folder_path
    candidates = [
        os.path.join(folder_path, "v6.1", "Databases", "Data"),
        os.path.join(folder_path, "New Profile 3", "v6.1", "Databases", "Data"),
        os.path.join(folder_path, "Default", "v6.1", "Databases", "Data"),
        os.path.join(folder_path, "Databases", "Data"),
    ]
    for cand in candidates:
        if os.path.exists(os.path.join(cand, "Songs.db")):
            return cand
    return folder_path


def copy_db_to_temp(db_path):
    """Copy DB ke temp untuk menghindari file lock EasyWorship."""
    suffix = os.path.splitext(db_path)[1]
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
    tmp.close()
    shutil.copy2(db_path, tmp.name)
    return tmp.name


def get_songs_list(db_folder):
    """Ambil daftar semua lagu dari Songs.db"""
    resolved_folder = resolve_ew_folder(db_folder)
    songs_db = os.path.join(resolved_folder, "Songs.db")
    if not os.path.exists(songs_db):
        log(f"[DB] Songs.db tidak ditemukan di: {db_folder} (mencoba: {resolved_folder})")
        return []

    tmp = copy_db_to_temp(songs_db)
    songs = []
    try:
        conn = sqlite3.connect(f"file:{tmp}?mode=ro", uri=True, timeout=5)
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()

        tables = [r[0] for r in cur.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        ).fetchall()]
        log(f"[DB] Tabel di Songs.db: {tables}")

        song_table = None
        for t in tables:
            if "song" in t.lower():
                song_table = t
                break
        if not song_table and tables:
            song_table = tables[0]

        if song_table:
            cols = [c[1] for c in cur.execute(f"PRAGMA table_info({song_table})").fetchall()]
            log(f"[DB] Kolom {song_table}: {cols}")
            title_col = next((c for c in cols if "title" in c.lower()), cols[1] if len(cols) > 1 else cols[0])
            id_col    = next((c for c in cols if c.lower() in ("rowid", "id", "kid", "guid", "uid")), "rowid")
            cur.execute(f"SELECT {id_col}, {title_col} FROM {song_table} ORDER BY {title_col}")
            for row in cur.fetchall():
                songs.append({"id": row[0], "title": str(row[1])})

        conn.close()
    except Exception as e:
        log(f"[DB] Error baca Songs.db: {e}")
    finally:
        try:
            os.unlink(tmp)
        except Exception:
            pass
    return songs


def get_song_lyrics(db_folder, song_id):
    """Ambil lirik dari SongWords.db"""
    resolved_folder = resolve_ew_folder(db_folder)
    candidates = ["SongWords.db", "Songs Words.db", "songwords.db", "SongWord.db"]
    words_db = None
    for name in candidates:
        path = os.path.join(resolved_folder, name)
        if os.path.exists(path):
            words_db = path
            break

    if not words_db:
        return "(SongWords.db tidak ditemukan)"

    tmp = copy_db_to_temp(words_db)
    lyrics = ""
    try:
        conn = sqlite3.connect(f"file:{tmp}?mode=ro", uri=True, timeout=5)
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()

        tables = [r[0] for r in cur.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        ).fetchall()]

        words_table = None
        for t in tables:
            if any(k in t.lower() for k in ("word", "lyric", "song")):
                words_table = t
                break
        if not words_table and tables:
            words_table = tables[0]

        if words_table:
            cols = [c[1] for c in cur.execute(f"PRAGMA table_info({words_table})").fetchall()]
            log(f"[DB] Kolom {words_table}: {cols}")

            text_col = next(
                (c for c in cols if any(k in c.lower() for k in ("word", "lyric", "text", "rtf", "content", "data"))),
                cols[-1] if cols else None
            )
            ref_col = next(
                (c for c in cols if any(k in c.lower() for k in ("song", "parent", "ref", "fk", "id")) and c.lower() != text_col.lower() if text_col),
                None
            )

            if text_col:
                if ref_col:
                    rows = cur.execute(
                        f"SELECT {text_col} FROM {words_table} WHERE {ref_col}=?",
                        (song_id,)
                    ).fetchall()
                else:
                    rows = cur.execute(f"SELECT {text_col} FROM {words_table}").fetchall()

                parts = []
                for row in rows:
                    raw = row[0]
                    if raw:
                        plain = strip_rtf(str(raw))
                        if plain:
                            parts.append(plain)
                lyrics = "\n\n".join(parts)

        conn.close()
    except Exception as e:
        log(f"[DB] Error baca SongWords.db: {e}")
    finally:
        try:
            os.unlink(tmp)
        except Exception:
            pass
    return lyrics


def detect_current_live_slide(db_folder):
    """
    Deteksi slide yang sedang live.
    Membaca file ew_live_state.txt yang ditulis oleh ew_companion.py
    di PC EasyWorship lewat shared folder.
    Format file:
      Baris 1: Judul lagu
      Baris 2: Label seksi (Verse 1, Chorus, dst.)
      Baris 3+: Teks slide
    """
    live_state_file = os.path.join(db_folder, "ew_live_state.txt")
    if not os.path.exists(live_state_file):
        return None

    try:
        mtime = os.path.getmtime(live_state_file)
        # File dianggap stale jika lebih dari 60 detik tidak diupdate
        if time.time() - mtime > 60:
            return None

        with open(live_state_file, "r", encoding="utf-8") as f:
            content = f.read().strip()

        if not content:
            return None

        lines = content.splitlines()
        title   = lines[0] if len(lines) > 0 else ""
        section = lines[1] if len(lines) > 1 else ""
        body    = "\n".join(lines[2:]) if len(lines) > 2 else ""
        return title, body, section
    except Exception as e:
        log(f"[Live] Error baca live state: {e}")
        return None


# ──────────────────────────────────────────────
# OBS Source Update
# ──────────────────────────────────────────────

def log(msg):
    try:
        obs.script_log(obs.LOG_INFO, str(msg))
    except Exception:
        pass


def update_obs_text(text):
    """Update teks pada OBS Text Source (GDI+ atau FreeType2)."""
    source = obs.obs_get_source_by_name(g_source_name)
    if source is None:
        log(f"[OBS] Source '{g_source_name}' tidak ditemukan!")
        return
    settings = obs.obs_data_create()
    obs.obs_data_set_string(settings, "text", str(text))
    obs.obs_source_update(source, settings)
    obs.obs_data_release(settings)
    obs.obs_source_release(source)


def format_slide_text(title, section, body):
    """Format teks untuk ditampilkan di OBS."""
    parts = []
    if g_show_section and section and section.strip():
        parts.append(f"[{section.strip()}]")
    if body:
        lines = body.splitlines()
        if g_max_lines > 0:
            lines = lines[:g_max_lines]
        parts.append("\n".join(lines))
    return "\n".join(parts)


# ──────────────────────────────────────────────
# Monitor Thread
# ──────────────────────────────────────────────

def monitor_loop():
    global g_last_slide_hash, g_status_text
    log("[Monitor] Thread dimulai")

    while g_monitor_active:
        try:
            result = detect_current_live_slide(g_db_path)
            if result:
                title, slide_text, section = result
                current_hash = hash((title, slide_text, section))
                if current_hash != g_last_slide_hash:
                    g_last_slide_hash = current_hash
                    formatted = format_slide_text(title, section, slide_text)
                    obs.calldata_create()
                    # Update di main thread via timer
                    _pending_text[0] = formatted
                    log(f"[Monitor] Update slide: {title} | {section}")
        except Exception as e:
            log(f"[Monitor] Error: {e}")

        time.sleep(g_poll_interval)

    log("[Monitor] Thread berhenti")


# Buffer untuk transfer data ke main thread
_pending_text = [None]


def tick(seconds):
    """Dipanggil OBS setiap frame — update OBS source dari main thread."""
    if _pending_text[0] is not None:
        update_obs_text(_pending_text[0])
        _pending_text[0] = None


def start_monitor():
    global g_monitor_active, g_monitor_thread
    if g_monitor_active:
        log("[Monitor] Sudah berjalan.")
        return
    if not g_db_path:
        update_obs_text("⚠ Isi path database EasyWorship terlebih dahulu!")
        return
    if not os.path.isdir(g_db_path):
        update_obs_text(f"⚠ Path tidak valid atau tidak dapat diakses:\n{g_db_path}")
        log(f"[Monitor] Path tidak valid: {g_db_path}")
        return

    g_monitor_active = True
    g_monitor_thread = threading.Thread(target=monitor_loop, daemon=True, name="EW-Monitor")
    g_monitor_thread.start()
    update_obs_text("✅ Monitoring dimulai...\nMenunggu slide dari EasyWorship.")
    log("[Monitor] Monitoring dimulai")


def stop_monitor():
    global g_monitor_active, g_last_slide_hash
    was_active = g_monitor_active
    g_monitor_active = False
    g_last_slide_hash = None
    if was_active:
        update_obs_text("")
        log("[Monitor] Monitoring dihentikan")


# ──────────────────────────────────────────────
# OBS Script API
# ──────────────────────────────────────────────

def script_description():
    return (
        "<h2>🎵 EasyWorship 7 → OBS Bridge</h2>"
        "<p>Menampilkan teks slide/lirik EasyWorship 7 ke OBS Text Source secara real-time.</p>"
        "<hr>"
        "<b>Setup cepat:</b><br>"
        "1. Share folder <code>...\\EasyWorship\\Default\\Databases\\Data</code> di PC EasyWorship<br>"
        "2. Jalankan <b>ew_companion.py</b> di PC EasyWorship<br>"
        "3. Isi path network share di bawah (contoh: <code>\\\\192.168.1.10\\EWData</code>)<br>"
        "4. Buat Text source di OBS bernama <b>EW_Lyrics</b><br>"
        "5. Klik <b>Start Monitoring</b>"
    )


def script_properties():
    props = obs.obs_properties_create()

    obs.obs_properties_add_text(
        props, "db_path",
        "Folder Data EasyWorship (UNC path atau drive letter):",
        obs.OBS_TEXT_DEFAULT
    )
    obs.obs_properties_add_text(
        props, "source_name",
        "Nama OBS Text Source:",
        obs.OBS_TEXT_DEFAULT
    )
    obs.obs_properties_add_float_slider(
        props, "poll_interval",
        "Interval Polling (detik):",
        0.5, 10.0, 0.5
    )
    obs.obs_properties_add_int_slider(
        props, "max_lines",
        "Maks Baris Teks Ditampilkan:",
        1, 20, 1
    )
    obs.obs_properties_add_bool(
        props, "show_section",
        "Tampilkan Label Seksi (Verse 1, Chorus, dll.)"
    )

    obs.obs_properties_add_button(
        props, "btn_start",
        "▶  Start Monitoring",
        lambda p, prop: start_monitor() or True
    )
    obs.obs_properties_add_button(
        props, "btn_stop",
        "⏹  Stop Monitoring",
        lambda p, prop: stop_monitor() or True
    )
    obs.obs_properties_add_button(
        props, "btn_test",
        "🔍  Test Koneksi & Tampilkan Lagu Pertama",
        on_test_connection
    )
    obs.obs_properties_add_button(
        props, "btn_clear",
        "🗑  Bersihkan Text Source",
        lambda p, prop: update_obs_text("") or True
    )

    return props


def script_defaults(settings):
    obs.obs_data_set_default_string(settings, "db_path", "")
    obs.obs_data_set_default_string(settings, "source_name", "EW_Lyrics")
    obs.obs_data_set_default_double(settings, "poll_interval", 1.5)
    obs.obs_data_set_default_int(settings, "max_lines", 6)
    obs.obs_data_set_default_bool(settings, "show_section", True)


def script_update(settings):
    global g_db_path, g_source_name, g_poll_interval, g_max_lines, g_show_section
    g_db_path       = obs.obs_data_get_string(settings, "db_path")
    g_source_name   = obs.obs_data_get_string(settings, "source_name")
    g_poll_interval = obs.obs_data_get_double(settings, "poll_interval")
    g_max_lines     = obs.obs_data_get_int(settings, "max_lines")
    g_show_section  = obs.obs_data_get_bool(settings, "show_section")


def script_unload():
    stop_monitor()


def on_test_connection(props, prop):
    """Uji koneksi ke database EasyWorship dan tampilkan preview lagu pertama."""
    if not g_db_path:
        update_obs_text("⚠ Path database belum diisi!")
        return True
    if not os.path.isdir(g_db_path):
        update_obs_text(f"❌ Tidak bisa mengakses folder:\n{g_db_path}\n\nPastikan shared folder sudah benar.")
        return True

    songs = get_songs_list(g_db_path)
    if not songs:
        update_obs_text("⚠ Folder bisa diakses, tapi Songs.db tidak ditemukan atau kosong.")
        return True

    first = songs[0]
    lyrics = get_song_lyrics(g_db_path, first["id"])
    preview = "\n".join(lyrics.splitlines()[:g_max_lines]) if lyrics else "(lirik kosong)"

    display = (
        f"✅ KONEKSI BERHASIL!\n"
        f"Ditemukan {len(songs)} lagu.\n\n"
        f"Contoh: {first['title']}\n"
        f"─────────────────\n"
        f"{preview}"
    )
    update_obs_text(display)
    log(f"[Test] OK. {len(songs)} lagu. Contoh: {first['title']}")
    return True
