import zipfile
import sqlite3
import tempfile
import os
import re

def strip_rtf(rtf_text):
    # Quick RTF stripper
    if not rtf_text:
        return ''
    # remove rtf control words
    text = re.sub(r'\\[a-z]+(-?\d+)? ?', '', rtf_text)
    text = re.sub(r'[{}]', '', text)
    return text.strip()

ewsx_path = r"D:\LCD\2026\23 Agustus\23 Agustus 2026.ewsx"
with zipfile.ZipFile(ewsx_path, 'r') as z:
    tmp_fd, tmp_name = tempfile.mkstemp()
    os.write(tmp_fd, z.read('main.db'))
    os.close(tmp_fd)

conn = sqlite3.connect(tmp_name)
c = conn.cursor()

c.execute("SELECT rowid, title, presentation_type, order_index FROM presentation WHERE title LIKE '%GB 024%'")
items = c.fetchall()

for it in items:
    pid = it[0]
    print(f"\n=== Presentation ID {pid}: {it[1]} ===")
    c.execute("SELECT rowid, title, order_index FROM slide WHERE presentation_id = ? ORDER BY order_index", (pid,))
    slides = c.fetchall()
    for sIdx, s in enumerate(slides):
        sid = s[0]
        stitle = s[1]
        c.execute("""
            SELECT e.element_uid, rt.rtf
            FROM element e
            JOIN resource_text rt ON rt.resource_id = e.foreground_resource_id
            WHERE e.slide_id = ? AND e.element_type = 6
        """, (sid,))
        elRows = c.fetchall()
        print(f"Slide {sIdx+1} (sid={sid}, title={stitle}): elRows count={len(elRows)}")
        for er in elRows:
            uid = er[0] or ''
            rtf = er[1] or ''
            print(f"  uid={uid}, rtf_snippet={repr(rtf[:120])}")

conn.close()
os.unlink(tmp_name)

