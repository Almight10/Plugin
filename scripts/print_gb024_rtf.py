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

c.execute("SELECT rowid, title, presentation_type, order_index FROM presentation WHERE title LIKE '%GB 024%' LIMIT 1")
it = c.fetchone()
pid = it[0]
print(f"Presentation {it[1]}")

c.execute("SELECT rowid, title, order_index FROM slide WHERE presentation_id = ? ORDER BY order_index", (pid,))
slides = c.fetchall()

for sIdx, s in enumerate(slides):
    sid = s[0]
    stitle = s[1]
    c.execute("""
        SELECT e.element_uid, rt.rtf
        FROM element e
        JOIN resource_text rt ON rt.resource_id = e.foreground_resource_id
        WHERE e.slide_id = ? AND e.element_uid = 'CONTENT_SONG'
    """, (sid,))
    row = c.fetchone()
    print(f"\n--- Slide {sIdx+1} (sid={sid}, title={stitle}) ---")
    if row:
        print("RTF FULL:")
        print(row[1])
    else:
        print("NO CONTENT_SONG ROW FOUND")

conn.close()
os.unlink(tmp_name)

