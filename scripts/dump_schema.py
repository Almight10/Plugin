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
c.execute("SELECT name FROM sqlite_master WHERE type='table'")
tables = [row[0] for row in c.fetchall()]
print('Tables in main.db:', tables)

for t in tables:
    c.execute(f"PRAGMA table_info({t})")
    cols = [col[1] for col in c.fetchall()]
    print(f"Table {t}: {cols}")

conn.close()
os.unlink(tmp_name)

