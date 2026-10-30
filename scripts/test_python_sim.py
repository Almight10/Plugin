import zipfile
import sqlite3
import tempfile
import os
import re

def strip_rtf(rtf):
    if not rtf:
        return ''
    text = str(rtf)
    if not text.strip().startswith('{\\rtf'):
        return text.strip()
    result = ''
    i = 0
    depth = 0
    skipGroup = 0
    SKIP_DESTS = [
        '\\fonttbl', '\\colortbl', '\\stylesheet', '\\info',
        '\\generator', '\\xmlnstbl', '\\datastore'
    ]
    while i < len(text):
        c = text[i]
        if c == '{':
            depth += 1
            for dest in SKIP_DESTS:
                if text.startswith(dest, i + 1):
                    skipGroup = depth
                    break
            if text.startswith('\\*', i + 1):
                skipGroup = depth
            i += 1
            continue
        if c == '}':
            if skipGroup == depth:
                skipGroup = 0
            depth -= 1
            i += 1
            continue
        if skipGroup and depth >= skipGroup:
            i += 1
            continue
        if c == '\\':
            if i + 1 < len(text):
                nc = text[i + 1]
                if nc == '\\':
                    result += '\n'
                    i += 2
                    continue
                if nc == '~':
                    result += ' '
                    i += 2
                    continue
                if nc in ('\n', '\r'):
                    result += '\n'
                    i += 2
                    continue
                if nc == "'":
                    hex_str = text[i + 2:i + 4]
                    try:
                        result += chr(int(hex_str, 16))
                    except:
                        pass
                    i += 4
                    continue
                j = i + 1
                while j < len(text) and text[j].isalpha():
                    j += 1
                word = text[i + 1:j].lower()
                if j < len(text) and (text[j] == '-' or text[j].isdigit()):
                    while j < len(text) and (text[j] == '-' or text[j].isdigit()):
                        j += 1
                if word == 'u' and j < len(text) and text[j] == '?':
                    j += 1
                if j < len(text) and text[j] == ' ':
                    j += 1
                if word in ('par', 'line'):
                    result += '\n'
                elif word == 'tab':
                    result += '\t'
                i = j
                continue
        if c in ('\n', '\r'):
            i += 1
            continue
        result += c
        i += 1
    
    lines = [l.rstrip() for l in result.split('\n')]
    res = '\n'.join(lines)
    res = re.sub(r'\n{3,}', '\n\n', res).strip()
    return res

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
title = it[1]
print(f"Presentation: {title} (pid={pid})")

c.execute("SELECT rowid, title, order_index FROM slide WHERE presentation_id = ? ORDER BY order_index", (pid,))
slideRows = c.fetchall()

parsedSlides = []
for sIdx, sRow in enumerate(slideRows):
    sId = sRow[0]
    sTitle = (sRow[1] or '').strip()
    c.execute("""
        SELECT e.element_uid, rt.rtf
        FROM element e
        JOIN resource_text rt ON rt.resource_id = e.foreground_resource_id
        WHERE e.slide_id = ? AND e.element_type = 6
    """, (sId,))
    elRows = c.fetchall()
    texts = []
    for er in elRows:
        uid = er[0] or ''
        rtf = er[1] or ''
        if 'COPYRIGHT' not in uid and rtf:
            plain = strip_rtf(rtf)
            if plain:
                texts.append(plain)
    
    combinedText = '\n'.join(texts).strip()
    sectionLabel = sTitle
    lines = [l.strip() for l in combinedText.split('\n') if l.strip()]
    if len(lines) > 1 and re.match(r'^\d+$', lines[0]):
        if not sectionLabel:
            sectionLabel = f"Bait {lines[0]}"
        combinedText = '\n'.join(lines[1:])
    if not sectionLabel:
        sectionLabel = f"Slide {sIdx + 1}"
    
    if combinedText:
        parsedSlides.append({
            'section': sectionLabel,
            'text': combinedText
        })

print(f"Parsed {len(parsedSlides)} slides:")
for ps in parsedSlides:
    print(f"  [{ps['section']}] -> {repr(ps['text'][:60])}")

formattedContent = '\n\n'.join([f"[{s['section']}]\n{s['text']}" for s in parsedSlides])
print(f"\nFormattedContent length: {len(formattedContent)}")
print("FormattedContent snippet:")
print(formattedContent[:300])

conn.close()
os.unlink(tmp_name)

