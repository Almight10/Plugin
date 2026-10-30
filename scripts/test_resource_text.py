import zipfile
import sqlite3
import tempfile
import os

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
    print(f"Total slides: {len(slides)}")
    for s in slides:
        sid = s[0]
        stitle = s[1]
        c.execute("""
            SELECT e.rowid, e.element_uid, e.element_type, e.foreground_resource_id, rt.rtf
            FROM element e
            LEFT JOIN resource_text rt ON e.foreground_resource_id = rt.resource_id
            WHERE e.slide_id = ?
        """, (sid,))
        elements = c.fetchall()
        print(f"  Slide {sid} ({stitle}): {len(elements)} elements")
        for el in elements:
            rtf = el[4]
            rtf_len = len(rtf) if rtf else 0
            snippet = repr(rtf[:100]) if rtf else 'NONE'
            print(f"    el {el[0]}: type={el[2]}, fg_res={el[3]}, rtf_len={rtf_len}, rtf={snippet}")

conn.close()
os.unlink(tmp_name)

