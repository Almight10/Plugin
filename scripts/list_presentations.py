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
c.execute("SELECT rowid, title, presentation_type, order_index FROM presentation ORDER BY order_index")
items = c.fetchall()
print(f"Total presentations: {len(items)}")
for it in items:
    print(it)

conn.close()
os.unlink(tmp_name)

