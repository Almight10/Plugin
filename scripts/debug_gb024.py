import zipfile
import sqlite3
import tempfile
import os

ewsx_path = r"D:\LCD\obs-easyworship-plugin\2_September.ewsx"
with zipfile.ZipFile(ewsx_path, 'r') as z:
    tmp_fd, tmp_name = tempfile.mkstemp()
    os.write(tmp_fd, z.read('main.db'))
    os.close(tmp_fd)

conn = sqlite3.connect(tmp_name)
c = conn.cursor()
c.execute("SELECT rowid, title, presentation_type FROM presentation WHERE title LIKE '%GB 024%'")
items = c.fetchall()
print('Found items:', items)

for row in items:
    pid = row[0]
    print('\nPresentation:', row)
    c.execute("SELECT rowid, title, order_index FROM slide WHERE presentation_id = ? ORDER BY order_index", (pid,))
    slides = c.fetchall()
    print('Slides count:', len(slides))
    for s in slides:
        sid = s[0]
        c.execute("SELECT e.element_uid, rt.rtf FROM element e LEFT JOIN rich_text rt ON e.element_uid = rt.element_uid WHERE e.slide_id = ?", (sid,))
        elements = c.fetchall()
        print(f"  Slide {s[0]} title={repr(s[1])}: {len(elements)} elements")
        for el in elements:
            rtf_len = len(el[1]) if el[1] else 0
            snippet = repr(el[1][:80]) if el[1] else 'None'
            print(f"    el: uid={el[0]}, rtf_len={rtf_len}, rtf={snippet}")

conn.close()
os.unlink(tmp_name)

