import zipfile
import sqlite3
import tempfile
import os
import glob

ewsx_files = glob.glob(r"D:\LCD\**\*.ewsx", recursive=True)
for ewsx in ewsx_files:
    try:
        with zipfile.ZipFile(ewsx, 'r') as z:
            if 'main.db' in z.namelist():
                tmp_fd, tmp_name = tempfile.mkstemp()
                os.write(tmp_fd, z.read('main.db'))
                os.close(tmp_fd)
                conn = sqlite3.connect(tmp_name)
                c = conn.cursor()
                c.execute("SELECT count(*) FROM presentation WHERE (title COLLATE BINARY) != '' AND (title COLLATE BINARY) NOT IN ('Blank', 'Global', 'Master')")
                cnt = c.fetchone()[0]
                c.execute("SELECT title FROM presentation WHERE title LIKE '%GB 024%'")
                found = c.fetchall()
                if found:
                    print(f"MATCH: {ewsx} (count={cnt}, found={found})")
                conn.close()
                os.unlink(tmp_name)
    except Exception as e:
        pass

