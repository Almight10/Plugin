/**
 * EasyWorship Import Integration for Bible Song Pro
 * Supports:
 * - .ewsx Schedule files (Zip containing main.db / schedule.db + media)
 * - Songs.db & SongWords.db (EasyWorship 6 & 7 SQLite databases)
 * - Fast offline SQLite parsing via sql.js (using local wasm binary)
 * - Automatic RTF to Clean Lyrics parsing with Indonesian section recognition (Bait, Reff, Koor, etc.)
 * - Setlist & Song Library replacement: previous files are replaced with the newly imported file
 * - Visual Success View upon import completion
 * - Integrated Text & Title Editing modal
 */

(function () {
  'use strict';

  let ewSqlEngine = null;
  let ewSqlEnginePromise = null;

  // Initialize SQLite engine (offline first)
  async function getEwSqlEngine() {
    if (ewSqlEngine) return ewSqlEngine;
    if (ewSqlEnginePromise) return ewSqlEnginePromise;

    ewSqlEnginePromise = (async () => {
      let retries = 0;
      while (typeof window.initSqlJs !== 'function' && retries < 30) {
        await new Promise(r => setTimeout(r, 100));
        retries++;
      }

      if (typeof window.initSqlJs !== 'function') {
        throw new Error('Library sql.js belum termuat. Pastikan file lib/sql-wasm.js tersedia.');
      }

      // 1. Try local wasm binary (Uint8Array)
      if (typeof window.SQL_WASM_BINARY !== 'undefined' && window.SQL_WASM_BINARY) {
        try {
          ewSqlEngine = await window.initSqlJs({
            wasmBinary: window.SQL_WASM_BINARY
          });
          return ewSqlEngine;
        } catch (e) {
          console.warn('Init sql.js wasmBinary error, fallback to locateFile:', e);
        }
      }

      // 2. Try local lib/ folder
      try {
        ewSqlEngine = await window.initSqlJs({
          locateFile: file => `./lib/${file}`
        });
        return ewSqlEngine;
      } catch (localErr) {
        console.warn('Gagal load sql.js lokal, mencoba CDN:', localErr);
        ewSqlEngine = await window.initSqlJs({
          locateFile: file => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.2/${file}`
        });
        return ewSqlEngine;
      }
    })();

    try {
      return await ewSqlEnginePromise;
    } catch (err) {
      ewSqlEnginePromise = null;
      throw err;
    }
  }

  // Execute query helper
  function execQuery(db, sql, params = []) {
    try {
      const stmt = db.prepare(sql);
      if (params && params.length) stmt.bind(params);
      const rows = [];
      while (stmt.step()) {
        rows.push(stmt.get());
      }
      stmt.free();
      return rows;
    } catch (e) {
      console.warn('execQuery error:', sql, e.message);
      return [];
    }
  }

  function getColumns(db, table) {
    try {
      const rows = execQuery(db, `PRAGMA table_info("${table}")`);
      return rows.map(r => r[1]);
    } catch {
      return [];
    }
  }

  // RTF → Plain Text Parser (Precision for EasyWorship)
  function stripRtf(rtf) {
    if (!rtf || !String(rtf).trim().startsWith('{\\rtf')) {
      return String(rtf || '').trim();
    }

    const text = String(rtf);
    let result = '';
    let i = 0;
    let depth = 0;
    let skipGroup = 0;

    const SKIP_DESTS = [
      '\\fonttbl', '\\colortbl', '\\stylesheet', '\\info',
      '\\generator', '\\xmlnstbl', '\\datastore'
    ];

    while (i < text.length) {
      const c = text[i];

      if (c === '{') {
        depth++;
        for (const dest of SKIP_DESTS) {
          if (text.startsWith(dest, i + 1)) {
            skipGroup = depth;
            break;
          }
        }
        if (text.startsWith('\\*', i + 1)) {
          skipGroup = depth;
        }
        i++;
        continue;
      }

      if (c === '}') {
        if (skipGroup === depth) {
          skipGroup = 0;
        }
        depth--;
        i++;
        continue;
      }

      if (skipGroup && depth >= skipGroup) {
        i++;
        continue;
      }

      if (c === '\\') {
        if (i + 1 < text.length) {
          const nc = text[i + 1];
          if (nc === '\\') { result += '\n'; i += 2; continue; }
          if (nc === '~')  { result += ' ';  i += 2; continue; }
          if (nc === '\n' || nc === '\r') { result += '\n'; i += 2; continue; }
          if (nc === "'") {
            const hex = text.slice(i + 2, i + 4);
            try { result += String.fromCharCode(parseInt(hex, 16)); } catch {}
            i += 4;
            continue;
          }

          let j = i + 1;
          while (j < text.length && /[a-zA-Z]/.test(text[j])) j++;
          const word = text.slice(i + 1, j).toLowerCase();

          if (j < text.length && (text[j] === '-' || /\d/.test(text[j]))) {
            while (j < text.length && (text[j] === '-' || /\d/.test(text[j]))) j++;
          }

          if (word === 'u' && j < text.length && text[j] === '?') {
            j++;
          }

          if (j < text.length && text[j] === ' ') j++;

          if (word === 'par' || word === 'line') {
            result += '\n';
          } else if (word === 'tab') {
            result += '\t';
          }

          i = j;
          continue;
        }
      }

      if (c === '\n' || c === '\r') {
        i++;
        continue;
      }

      result += c;
      i++;
    }

    return result
      .split('\n')
      .map(l => l.trimEnd())
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  // Parse raw text or RTF into structured slides
  function parseIntoSlides(rawText) {
    const plain = stripRtf(rawText);
    const blocks = plain.split(/\n\s*\n/).filter(b => b.trim());

    const slides = [];
    let slideNum = 1;

    const SECTION_PATTERNS = [
      { re: /^(verse\s*\d*|bait\s*\d*)/i,         tag: 'verse'  },
      { re: /^(chorus\s*\d*|refrain|reff|koor)/i, tag: 'chorus' },
      { re: /^(bridge\s*\d*|jembatan)/i,          tag: 'bridge' },
      { re: /^(tag\s*\d*|coda|ending|penutup)/i,  tag: 'tag'    },
      { re: /^(intro\s*\d*|pembuka)/i,            tag: 'intro'  },
      { re: /^(outro\s*\d*|akhir)/i,              tag: 'outro'  },
      { re: /^(pre[- ]?chorus\s*\d*)/i,          tag: 'verse'  },
    ];

    for (const block of blocks) {
      const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
      if (!lines.length) continue;

      let section = `Slide ${slideNum}`;
      let bodyLines = lines;

      const firstLine = lines[0];
      let sectionFound = false;

      for (const { re } of SECTION_PATTERNS) {
        if (re.test(firstLine)) {
          section = firstLine;
          bodyLines = lines.slice(1);
          sectionFound = true;
          break;
        }
      }

      if (!sectionFound && lines.length > 1 && firstLine.length <= 25 && firstLine.split(' ').length <= 3 && firstLine === firstLine.toUpperCase() && /[A-Z]/.test(firstLine)) {
        section = firstLine;
        bodyLines = lines.slice(1);
      }

      if (bodyLines.length > 0) {
        slides.push({
          section: section,
          text: bodyLines.join('\n')
        });
        slideNum++;
      } else if (sectionFound) {
        slides.push({
          section: section,
          text: firstLine
        });
        slideNum++;
      }
    }

    if (!slides.length && plain.trim()) {
      slides.push({ section: 'Slide 1', text: plain.trim() });
    }

    return slides;
  }

  // Extract .ewsx (ZIP archive)
  async function extractEwsx(file) {
    let zipInstance = null;
    if (typeof JSZip !== 'undefined') {
      zipInstance = JSZip;
    } else if (window.JSZip) {
      zipInstance = window.JSZip;
    } else {
      throw new Error('JSZip belum termuat.');
    }

    const arrayBuffer = await file.arrayBuffer();
    const zip = await zipInstance.loadAsync(arrayBuffer);

    let mainDb = null;
    let songsDb = null;
    let wordsDb = null;

    for (const [path, entry] of Object.entries(zip.files)) {
      if (entry.dir) continue;
      const fname = path.toLowerCase().replace(/\\/g, '/').split('/').pop();

      if (fname === 'main.db' || fname === 'schedule.db') {
        mainDb = await entry.async('uint8array');
      } else if (fname === 'songs.db') {
        songsDb = await entry.async('uint8array');
      } else if (fname.includes('songwords') || fname.includes('song words') || fname === 'songword.db') {
        wordsDb = await entry.async('uint8array');
      } else if (fname.endsWith('.db') && !mainDb) {
        mainDb = await entry.async('uint8array');
      }
    }

    return { mainDb, songsDb, wordsDb };
  }

  // Parse .ewsx schedule database to structured items
  async function parseEwsxSchedule(dbBytes, fileName) {
    const SQL = await getEwSqlEngine();
    const db = new SQL.Database(dbBytes);

    try {
      const query = "SELECT rowid, title, author, presentation_type, order_index FROM presentation WHERE (title COLLATE BINARY) != '' AND (title COLLATE BINARY) NOT IN ('Blank', 'Global', 'Master') AND presentation_type NOT IN (11, 12, 14) ORDER BY order_index";
      const items = execQuery(db, query);

      if (!items || !items.length) {
        return [];
      }

      const results = [];

      for (let idx = 0; idx < items.length; idx++) {
        const item = items[idx];
        const pid = item[0];
        const title = (item[1] || `Item ${idx + 1}`).trim();
        const author = (item[2] || '').trim();

        const slideRows = execQuery(
          db,
          `SELECT rowid, title, order_index FROM slide WHERE presentation_id = ? ORDER BY order_index`,
          [pid]
        );

        const parsedSlides = [];

        for (let sIdx = 0; sIdx < slideRows.length; sIdx++) {
          const sRow = slideRows[sIdx];
          const sId = sRow[0];
          const sTitle = sRow[1] ? String(sRow[1]).trim() : '';

          const elRows = execQuery(
            db,
            `SELECT e.element_uid, rt.rtf
             FROM element e
             JOIN resource_text rt ON rt.resource_id = e.foreground_resource_id
             WHERE e.slide_id = ? AND e.element_type = 6`,
            [sId]
          );

          const texts = [];
          for (const er of elRows) {
            const uid = er[0] || '';
            const rtf = er[1];
            if (!uid.includes('COPYRIGHT') && rtf) {
              const plain = stripRtf(rtf);
              if (plain) texts.push(plain);
            }
          }

          let combinedText = texts.join('\n').trim();
          let sectionLabel = sTitle;

          const lines = combinedText.split('\n').map(l => l.trim()).filter(Boolean);
          if (lines.length > 1 && /^\d+$/.test(lines[0])) {
            if (!sectionLabel) sectionLabel = `Bait ${lines[0]}`;
            combinedText = lines.slice(1).join('\n');
          }

          if (!sectionLabel) {
            sectionLabel = `Slide ${sIdx + 1}`;
          }

          if (combinedText) {
            parsedSlides.push({
              section: sectionLabel,
              text: combinedText
            });
          }
        }

        // Skip empty placeholder slides
        if (!parsedSlides.length) {
          if (title.toLowerCase() === 'untitled' || title.toLowerCase() === 'blank' || !title) {
            continue;
          }
          parsedSlides.push({ section: 'Slide 1', text: title });
        }

        // Format content for Bible Song Pro
        const formattedContent = parsedSlides.map(s => `[${s.section}]\n${s.text}`).join('\n\n');

        const songId = typeof createId === 'function' ? createId('song', title) : `song_${Date.now()}_${idx}`;
        const searchNorm = typeof normalizeSearchText === 'function'
          ? normalizeSearchText(`${title}\n${formattedContent}`)
          : `${title}\n${formattedContent}`.toLowerCase();

        const pType = Number(item[3] != null ? item[3] : 8);
        const isSong = (pType === 6);
        const kind = isSong ? 'song' : (pType === 1 ? 'scripture' : 'presentation');

        results.push({
          id: songId,
          title: title,
          author: author,
          content: formattedContent,
          text: formattedContent,
          slides: parsedSlides,
          searchableText: searchNorm,
          presentationType: pType,
          isSong: isSong,
          kind: kind,
          createdAt: Date.now(),
          updatedAt: Date.now()
        });
      }

      return results;
    } finally {
      try { db.close(); } catch (_) {}
    }
  }

  // Parse Songs.db & SongWords.db databases
  async function parseEasyWorshipDatabase(songsBytes, wordsBytes) {
    const SQL = await getEwSqlEngine();
    let dbSongs = null;
    let dbWords = null;

    try {
      if (songsBytes) dbSongs = new SQL.Database(songsBytes);
      if (wordsBytes) dbWords = new SQL.Database(wordsBytes);

      if (!dbSongs && dbWords) {
        return [];
      }

      const tables = execQuery(dbSongs, "SELECT name FROM sqlite_master WHERE type='table'");
      let songTable = null;
      for (const row of tables) {
        if (row[0].toLowerCase() === 'song' || row[0].toLowerCase() === 'songs') {
          songTable = row[0];
          break;
        }
      }
      if (!songTable) {
        for (const row of tables) {
          if (row[0].toLowerCase().includes('song')) { songTable = row[0]; break; }
        }
      }
      if (!songTable && tables.length) songTable = tables[0][0];
      if (!songTable) return [];

      const cols = getColumns(dbSongs, songTable);
      const titleCol = cols.find(c => c.toLowerCase() === 'title') || cols.find(c => c.toLowerCase().includes('title')) || cols[1] || cols[0];
      const authorCol = cols.find(c => c.toLowerCase().includes('author') || c.toLowerCase().includes('writer'));
      const idCol = cols.find(c => ['rowid', 'id', 'song_item_uid', 'song_uid', 'uid'].includes(c.toLowerCase())) || 'rowid';

      const query = authorCol
        ? `SELECT ${idCol}, ${titleCol}, ${authorCol} FROM ${songTable} ORDER BY (${titleCol} COLLATE NOCASE)`
        : `SELECT ${idCol}, ${titleCol} FROM ${songTable} ORDER BY (${titleCol} COLLATE NOCASE)`;

      const rows = execQuery(dbSongs, query);
      const songsList = [];

      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        const sId = r[0];
        const title = (r[1] || '(tanpa judul)').trim();
        const author = (r[2] || '').trim();

        let rawWords = '';
        if (dbWords) {
          const queries = [
            `SELECT words FROM word WHERE song_id = ?`,
            `SELECT words FROM word WHERE rowid = ?`,
            `SELECT words FROM words WHERE song_id = ?`,
            `SELECT words FROM words WHERE rowid = ?`
          ];
          for (const q of queries) {
            try {
              const wRows = execQuery(dbWords, q, [sId]);
              if (wRows && wRows.length && wRows[0][0]) {
                rawWords = wRows[0][0];
                break;
              }
            } catch (_) {}
          }
        }

        const slides = rawWords ? parseIntoSlides(rawWords) : [{ section: 'Slide 1', text: title }];
        const formattedContent = slides.map(s => `[${s.section}]\n${s.text}`).join('\n\n');

        const songId = typeof createId === 'function' ? createId('song', title) : `song_${Date.now()}_${i}`;
        const searchNorm = typeof normalizeSearchText === 'function'
          ? normalizeSearchText(`${title}\n${formattedContent}`)
          : `${title}\n${formattedContent}`.toLowerCase();

        songsList.push({
          id: songId,
          title: title,
          author: author,
          content: formattedContent,
          text: formattedContent,
          slides: slides,
          searchableText: searchNorm,
          createdAt: Date.now(),
          updatedAt: Date.now()
        });
      }

      return songsList;
    } finally {
      if (dbSongs) try { dbSongs.close(); } catch (_) {}
      if (dbWords) try { dbWords.close(); } catch (_) {}
    }
  }

  // Visual modal showing import success & summary of loaded items
  function showImportSuccessView(fileName, items) {
    const modal = document.getElementById('ewImportSuccessModal');
    if (!modal) return;

    const fnEl = document.getElementById('ew-success-filename');
    if (fnEl) fnEl.textContent = fileName || 'Jadwal EasyWorship';

    const countBadge = document.getElementById('ew-success-count-badge');
    if (countBadge) countBadge.textContent = `${items.length} Item Dimuat`;

    const listEl = document.getElementById('ew-success-items-list');
    if (listEl) {
      listEl.innerHTML = items.map((item, idx) => {
        const slideCount = (item.slides && item.slides.length) ? item.slides.length : 1;
        const sections = (item.slides || []).map(s => s.section).filter(Boolean).slice(0, 3).join(', ');
        return `
          <div style="display:flex;align-items:center;gap:10px;padding:8px 12px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:8px;">
            <span style="font-size:11px;font-weight:700;color:var(--accent,#6C63FF);min-width:22px;">${idx + 1}</span>
            <div style="flex:1;min-width:0;">
              <div style="font-size:13px;font-weight:600;color:#fff;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${item.title}</div>
              ${sections ? `<div style="font-size:11px;color:var(--text-secondary,#8f98a8);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${sections}</div>` : ''}
            </div>
            <span style="font-size:10px;font-weight:700;padding:2px 7px;border-radius:4px;white-space:nowrap;${(item.isSong || item.presentationType === 6) ? 'background:rgba(108,99,255,0.25);color:#a78bfa;border:1px solid rgba(108,99,255,0.5);' : 'background:rgba(245,158,11,0.2);color:#F59E0B;border:1px solid rgba(245,158,11,0.5);'}">
              ${(item.isSong || item.presentationType === 6) ? '🎵 Lagu' : '📋 Liturgi'}
            </span>
            <span style="font-size:11px;background:rgba(255,255,255,0.08);color:var(--text-secondary,#8f98a8);padding:2px 8px;border-radius:6px;white-space:nowrap;">${slideCount} slide</span>
          </div>
        `;
      }).join('');
    }

    if (typeof openModal === 'function') {
      openModal('ewImportSuccessModal');
    } else {
      modal.style.display = 'flex';
    }
  }

  // Open the Text Edit Modal for the active item or passed item
  function openTextEditModal(item = null) {
    const target = item || (typeof currentItem !== 'undefined' ? currentItem : null);
    if (!target) {
      if (typeof showToast === 'function') {
        showToast('⚠️ Pilih lagu atau slide terlebih dahulu untuk mengedit teks.', 'warning');
      }
      return;
    }

    const titleInput = document.getElementById('edit-item-title');
    const contentInput = document.getElementById('edit-item-content');
    if (titleInput) titleInput.value = target.title || '';
    if (contentInput) contentInput.value = target.content || target.text || '';

    if (typeof openModal === 'function') {
      openModal('textEditModal');
    } else {
      const modal = document.getElementById('textEditModal');
      if (modal) modal.style.display = 'flex';
    }
  }

  // Insert section header tag into text edit textarea
  function insertSectionTag(tag) {
    const textarea = document.getElementById('edit-item-content');
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = textarea.value;
    const before = text.substring(0, start);
    const after = text.substring(end, text.length);
    const insertText = (before.length && !before.endsWith('\n') ? '\n\n' : '') + tag + '\n';
    textarea.value = before + insertText + after;
    textarea.selectionStart = textarea.selectionEnd = start + insertText.length;
    textarea.focus();
  }

  // Save changes from Text Edit Modal
  function saveTextEdit() {
    if (typeof currentItem === 'undefined' || !currentItem) return;
    const newTitle = (document.getElementById('edit-item-title')?.value || '').trim();
    const newContent = document.getElementById('edit-item-content')?.value || '';

    if (newTitle) currentItem.title = newTitle;
    currentItem.content = newContent;
    currentItem.text = newContent;
    currentItem.updatedAt = Date.now();
    if (typeof normalizeSearchText === 'function') {
      currentItem.searchableText = normalizeSearchText(`${currentItem.title || ''}\n${newContent}`);
    }

    // Update in songs array if present
    if (typeof songs !== 'undefined' && Array.isArray(songs)) {
      const idx = songs.findIndex(s => s.id === currentItem.id || s.title.toLowerCase() === currentItem.title.toLowerCase());
      if (idx !== -1) {
        songs[idx].title = currentItem.title;
        songs[idx].content = newContent;
        songs[idx].text = newContent;
        songs[idx].updatedAt = Date.now();
        if (typeof idbPut === 'function' && typeof STORE_SONGS !== 'undefined' && typeof buildSongRecord === 'function') {
          idbPut(STORE_SONGS, buildSongRecord(songs[idx], { isNew: false })).catch(() => {});
        }
      }
    }

    // Parse updated structured slides from newContent
    let updatedSlides = [];
    if (typeof parseIntoSlides === 'function') {
      updatedSlides = parseIntoSlides(newContent);
    }
    currentItem.slides = updatedSlides.length ? updatedSlides : [{ section: 'Slide 1', text: newContent }];

    // Update in schedule array if present
    if (typeof schedule !== 'undefined' && Array.isArray(schedule)) {
      const schIdx = schedule.findIndex(s => s.id === currentItem.id || s.title.toLowerCase() === currentItem.title.toLowerCase());
      if (schIdx !== -1) {
        schedule[schIdx].title = currentItem.title;
        schedule[schIdx].content = newContent;
        schedule[schIdx].text = newContent;
        schedule[schIdx].slides = currentItem.slides;
      }
    }

    // Update lyric-editor textarea if exists
    const lyricEditor = document.getElementById('lyric-editor');
    if (lyricEditor) lyricEditor.value = newContent;

    if (typeof saveState === 'function') saveState();
    if (typeof saveToStorageDebounced === 'function') saveToStorageDebounced();
    if (typeof renderSongs === 'function') renderSongs();
    if (typeof updateButtonView === 'function') updateButtonView();
    if (typeof updateFocusedEditorBanner === 'function') updateFocusedEditorBanner();
    if (typeof renderFocusedMainPanel === 'function') renderFocusedMainPanel();

    // Update live projection if this item is currently live on stream
    if (typeof isLive !== 'undefined' && isLive && typeof livePointer !== 'undefined' && livePointer && livePointer.kind === 'songs' && livePointer.index === currentIndex) {
      if (typeof scheduleLiveUpdate === 'function') scheduleLiveUpdate();
    }

    if (typeof closeModal === 'function') {
      closeModal('textEditModal');
    } else {
      const modal = document.getElementById('textEditModal');
      if (modal) modal.style.display = 'none';
    }

    if (typeof showToast === 'function') {
      showToast('✅ Perubahan teks berhasil disimpan!', 'success');
    }
  }

  // High-level: Import .ewsx into Bible Song Pro (REPLACES PREVIOUS SCHEDULE)
  async function importEwsxIntoBsp(file, { addToSetlist = true, addToSongs = true } = {}) {
    const toast = (msg, type = 'info') => {
      if (typeof showToast === 'function') showToast(msg);
      else console.log(`[EW Import ${type}]`, msg);
    };

    try {
      toast(`📦 Membuka jadwal EasyWorship "${file.name}"...`, 'info');
      const { mainDb, songsDb, wordsDb } = await extractEwsx(file);

      if (!mainDb && !songsDb) {
        toast(`❌ File "${file.name}" tidak memuat jadwal atau lagu EasyWorship yang valid.`, 'error');
        return;
      }

      let parsedItems = [];
      if (mainDb) {
        parsedItems = await parseEwsxSchedule(mainDb, file.name);
      } else if (songsDb) {
        parsedItems = await parseEasyWorshipDatabase(songsDb, wordsDb);
      }

      if (!parsedItems.length) {
        toast(`⚠️ Tidak ada item lagu/presentasi dalam file ${file.name}.`, 'warning');
        return;
      }

      let addedSongsCount = 0;
      let setlistCount = 0;

      // 1. Add to schedule / Setlist: SEMUA item jadwal ibadah (lagu + liturgi/khotbah/warta)
      // Jadwal lama diganti bersih dengan jadwal baru dari file .ewsx ini
      if (addToSetlist && typeof schedule !== 'undefined' && Array.isArray(schedule)) {
        schedule.length = 0;
        for (const item of parsedItems) {
          schedule.push({ ...item });
          setlistCount++;
        }
      }

      // 2. Add or Update in Songs library (HANYA LAGU! Doa, Khotbah, Liturgi TIDAK masuk ke Songs)
      if (addToSongs && typeof songs !== 'undefined' && Array.isArray(songs)) {
        // Bersihkan item liturgi non-lagu (Doa, Khotbah, dll.) yang sempat masuk ke songs
        const nonSongIds = [];
        for (let i = songs.length - 1; i >= 0; i--) {
          const s = songs[i];
          if (s.presentationType === 8 || s.kind === 'presentation') {
            nonSongIds.push(s.id);
            songs.splice(i, 1);
          }
        }
        if (typeof idbDelete === 'function' && typeof STORE_SONGS !== 'undefined') {
          for (const nid of nonSongIds) {
            idbDelete(STORE_SONGS, nid).catch(() => {});
          }
        }

        // HANYA masukkan item yang benar-benar LAGU (presentationType === 6 atau isSong === true)
        for (const item of parsedItems) {
          if (!item.isSong && item.presentationType !== 6) {
            continue; // LEWATKAN DOA, KHOTBAH, WARTA, DLL. DARI MENU SONGS!
          }

          const existsIdx = songs.findIndex(s => s.title.toLowerCase() === item.title.toLowerCase());
          if (existsIdx === -1) {
            songs.push({ ...item });
            addedSongsCount++;
            if (typeof idbPut === 'function' && typeof STORE_SONGS !== 'undefined' && typeof buildSongRecord === 'function') {
              idbPut(STORE_SONGS, buildSongRecord(item, { isNew: true })).catch(() => {});
            }
          } else {
            songs[existsIdx].content = item.content;
            songs[existsIdx].text = item.text;
            songs[existsIdx].slides = item.slides;
            songs[existsIdx].updatedAt = Date.now();
            if (typeof idbPut === 'function' && typeof STORE_SONGS !== 'undefined' && typeof buildSongRecord === 'function') {
              idbPut(STORE_SONGS, buildSongRecord(songs[existsIdx], { isNew: false })).catch(() => {});
            }
          }
        }
      }

      // Save states & update views
      if (typeof saveState === 'function') saveState();
      if (typeof saveToStorageDebounced === 'function') saveToStorageDebounced();
      if (typeof setSidebarTab === 'function') setSidebarTab('schedule');
      if (typeof renderSongs === 'function') renderSongs();
      if (typeof selectItem === 'function' && schedule.length > 0) {
        selectItem(0);
      }

      // Close the import file picker modal if open
      if (typeof closeModal === 'function') {
        closeModal('ewImportModal');
      }

      // Show visual success view
      showImportSuccessView(file.name, parsedItems);

      toast(`✅ Jadwal "${file.name}" berhasil dimuat: ${parsedItems.length} item masuk ke Setlist menggantikan jadwal sebelumnya!`, 'success');
      return parsedItems;
    } catch (err) {
      console.error('importEwsxIntoBsp failed:', err);
      toast(`❌ Gagal impor EasyWorship: ${err.message || err}`, 'error');
      throw err;
    }
  }

  // High-level: Import Songs.db & SongWords.db into Bible Song Pro
  async function importEasyWorshipDatabasesIntoBsp(songsDbBytes, wordsDbBytes, { addToSongs = true } = {}) {
    const toast = (msg, type = 'info') => {
      if (typeof showToast === 'function') showToast(msg);
      else console.log(`[EW Import ${type}]`, msg);
    };

    try {
      toast('⏳ Membaca database lagu EasyWorship...', 'info');
      const items = await parseEasyWorshipDatabase(songsDbBytes, wordsDbBytes);

      if (!items || !items.length) {
        toast('⚠️ Tidak ada lagu ditemukan dalam database.', 'warning');
        return;
      }

      let addedCount = 0;
      let updatedCount = 0;
      if (addToSongs && typeof songs !== 'undefined' && Array.isArray(songs)) {
        for (const item of items) {
          const existsIdx = songs.findIndex(s => s.title.toLowerCase() === item.title.toLowerCase());
          if (existsIdx === -1) {
            songs.push(item);
            addedCount++;
            if (typeof idbPut === 'function' && typeof STORE_SONGS !== 'undefined' && typeof buildSongRecord === 'function') {
              idbPut(STORE_SONGS, buildSongRecord(item, { isNew: true })).catch(() => {});
            }
          } else {
            // Update lyrics if new content exists
            if (item.content) {
              songs[existsIdx].content = item.content;
              songs[existsIdx].text = item.text;
              songs[existsIdx].slides = item.slides;
              songs[existsIdx].updatedAt = Date.now();
              updatedCount++;
              if (typeof idbPut === 'function' && typeof STORE_SONGS !== 'undefined' && typeof buildSongRecord === 'function') {
                idbPut(STORE_SONGS, buildSongRecord(songs[existsIdx], { isNew: false })).catch(() => {});
              }
            }
          }
        }
      }

      if (typeof saveState === 'function') saveState();
      if (typeof saveToStorageDebounced === 'function') saveToStorageDebounced();
      if (typeof setSidebarTab === 'function') setSidebarTab('songs');
      if (typeof renderSongs === 'function') renderSongs();
      if (typeof selectItem === 'function' && songs.length > 0) {
        selectItem(0);
      }

      if (typeof closeModal === 'function') {
        closeModal('ewImportModal');
      }

      showImportSuccessView('Database EasyWorship', items);

      toast(`✅ ${items.length} lagu EasyWorship berhasil diproses (${addedCount} lagu baru, ${updatedCount} lagu diperbarui)!`, 'success');
      return items;
    } catch (err) {
      console.error('importEasyWorshipDatabasesIntoBsp failed:', err);
      toast(`❌ Gagal membaca database EasyWorship: ${err.message || err}`, 'error');
      throw err;
    }
  }

  // Load sample file 2_September.ewsx from local folder
  async function loadSampleEwsx() {
    const toast = (msg, type = 'info') => {
      if (typeof showToast === 'function') showToast(msg);
      else console.log(`[EW Import ${type}]`, msg);
    };

    try {
      toast('⏳ Mengambil file 2_September.ewsx...', 'info');
      const resp = await fetch('2_September.ewsx');
      if (!resp.ok) throw new Error('File 2_September.ewsx tidak ditemukan di folder server/local.');
      const blob = await resp.blob();
      const file = new File([blob], '2_September.ewsx', { type: 'application/octet-stream' });
      await importEwsxIntoBsp(file, { addToSetlist: true, addToSongs: true });
    } catch (err) {
      console.warn('loadSampleEwsx fetch error:', err);
      toast('ℹ️ Silakan gunakan tombol "Pilih File" dan pilih 2_September.ewsx', 'warning');
      const ewFileInput = document.getElementById('ew-file-input');
      if (ewFileInput) ewFileInput.click();
    }
  }

  // Load 1,410 complete songs from local bundled database
  async function loadLocalProfileSongs() {
    const toast = (msg, type = 'info') => {
      if (typeof showToast === 'function') showToast(msg);
      else console.log(`[EW Import ${type}]`, msg);
    };

    try {
      toast('⚡ Memuat 1.410 lagu EasyWorship lengkap dari PC...', 'info');

      let bundled = window.BSP_EW_BUNDLED_SONGS;
      if (!bundled || !bundled.length) {
        try {
          const resp = await fetch('data/easyworship_songs_1410.json');
          if (resp.ok) {
            bundled = await resp.json();
          }
        } catch (e) {
          console.warn('Gagal fetch data/easyworship_songs_1410.json:', e);
        }
      }

      if (!bundled || !bundled.length) {
        toast('❌ Database 1.410 lagu tidak ditemukan.', 'error');
        return;
      }

      let addedCount = 0;
      let updatedCount = 0;

      if (typeof songs !== 'undefined' && Array.isArray(songs)) {
        for (const item of bundled) {
          const existsIdx = songs.findIndex(s => s.title.toLowerCase() === item.title.toLowerCase());
          if (existsIdx === -1) {
            songs.push(item);
            addedCount++;
            if (typeof idbPut === 'function' && typeof STORE_SONGS !== 'undefined' && typeof buildSongRecord === 'function') {
              idbPut(STORE_SONGS, buildSongRecord(item, { isNew: true })).catch(() => {});
            }
          } else {
            // Replace previous single-slide or outdated entry with complete slides
            songs[existsIdx].content = item.content;
            songs[existsIdx].text = item.text;
            songs[existsIdx].slides = item.slides;
            songs[existsIdx].searchableText = item.searchableText;
            if (item.author) songs[existsIdx].author = item.author;
            songs[existsIdx].updatedAt = Date.now();
            updatedCount++;
            if (typeof idbPut === 'function' && typeof STORE_SONGS !== 'undefined' && typeof buildSongRecord === 'function') {
              idbPut(STORE_SONGS, buildSongRecord(songs[existsIdx], { isNew: false })).catch(() => {});
            }
          }
        }
      }

      if (typeof saveState === 'function') saveState();
      if (typeof saveToStorageDebounced === 'function') saveToStorageDebounced();
      if (typeof setSidebarTab === 'function') setSidebarTab('songs');
      if (typeof renderSongs === 'function') renderSongs();
      if (typeof selectItem === 'function' && songs.length > 0) {
        selectItem(0);
      }

      if (typeof closeModal === 'function') {
        closeModal('ewImportModal');
      }

      showImportSuccessView('Database Lagu EasyWorship (1.410 Lagu Lengkap)', bundled);
      toast(`✅ Sukses memuat 1.410 lagu EasyWorship lengkap (${addedCount} lagu baru, ${updatedCount} lagu diperbarui dengan seluruh bait/slide)!`, 'success');
      return bundled;
    } catch (err) {
      console.error('loadLocalProfileSongs failed:', err);
      toast(`❌ Gagal memuat database lagu: ${err.message || err}`, 'error');
      throw err;
    }
  }

  // Expose on window
  window.showImportSuccessView = showImportSuccessView;
  window.openTextEditModal = openTextEditModal;
  window.saveTextEdit = saveTextEdit;
  window.insertSectionTag = insertSectionTag;
  window.loadLocalProfileSongs = loadLocalProfileSongs;

  window.BSP_EASYWORSHIP = {
    getSqlEngine: getEwSqlEngine,
    stripRtf,
    parseIntoSlides,
    extractEwsx,
    parseEwsxSchedule,
    parseEasyWorshipDatabase,
    importEwsxIntoBsp,
    importEasyWorshipDatabasesIntoBsp,
    loadSampleEwsx,
    loadLocalProfileSongs,
    showImportSuccessView,
    openTextEditModal,
    saveTextEdit,
    insertSectionTag
  };

  // Auto-clean liturgy/presentation items from songs library on load so Song menu is clean
  function cleanLiturgyFromSongsLibrary() {
    try {
      if (typeof songs !== 'undefined' && Array.isArray(songs)) {
        const nonSongIds = [];
        for (let i = songs.length - 1; i >= 0; i--) {
          const s = songs[i];
          if (s && (s.presentationType === 8 || s.kind === 'presentation')) {
            nonSongIds.push(s.id);
            songs.splice(i, 1);
          }
        }
        if (nonSongIds.length) {
          if (typeof idbDelete === 'function' && typeof STORE_SONGS !== 'undefined') {
            for (const nid of nonSongIds) idbDelete(STORE_SONGS, nid).catch(() => {});
          }
          if (typeof renderSongs === 'function') renderSongs();
          console.log(`[EasyWorship] Cleaned ${nonSongIds.length} liturgy items from songs library.`);
        }
      }
    } catch (_) {}
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('DOMContentLoaded', () => {
      setTimeout(cleanLiturgyFromSongsLibrary, 600);
    });
    // Also run immediately if DOM is already loaded
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
      setTimeout(cleanLiturgyFromSongsLibrary, 300);
    }
  }

  // --- Clean & Simple Manual New Song Handler ---
  function openNewSongModalClean(initialTitle = '') {
    const modal = document.getElementById('newSongCleanModal');
    if (!modal) return;
    const titleInput = document.getElementById('new-clean-song-title');
    const authorInput = document.getElementById('new-clean-song-author');
    const contentInput = document.getElementById('new-clean-song-content');
    if (titleInput) titleInput.value = initialTitle || '';
    if (authorInput) authorInput.value = '';
    if (contentInput) contentInput.value = '';
    modal.style.display = 'flex';
    setTimeout(() => {
      if (initialTitle && contentInput) contentInput.focus();
      else if (titleInput) titleInput.focus();
    }, 60);
  }

  function closeNewSongModalClean() {
    const modal = document.getElementById('newSongCleanModal');
    if (modal) modal.style.display = 'none';
  }

  function insertNewSongSectionTag(tag) {
    const ta = document.getElementById('new-clean-song-content');
    if (!ta) return;
    const start = ta.selectionStart || 0;
    const end = ta.selectionEnd || 0;
    const val = ta.value;
    const prefix = (start > 0 && val[start - 1] !== '\n') ? '\n\n' : '';
    const insert = `${prefix}${tag}\n`;
    ta.value = val.slice(0, start) + insert + val.slice(end);
    ta.focus();
    const newPos = start + insert.length;
    ta.setSelectionRange(newPos, newPos);
  }

  async function saveNewSongClean() {
    const titleInput = document.getElementById('new-clean-song-title');
    const authorInput = document.getElementById('new-clean-song-author');
    const contentInput = document.getElementById('new-clean-song-content');

    const title = (titleInput?.value || '').trim();
    const author = (authorInput?.value || '').trim();
    const rawContent = (contentInput?.value || '').trim();

    if (!title) {
      alert('⚠️ Harap masukkan judul lagu terlebih dahulu.');
      titleInput?.focus();
      return;
    }

    const toast = (msg, type = 'info') => {
      if (typeof showToast === 'function') showToast(msg);
      else console.log(`[BSP ${type}]`, msg);
    };

    // Parse slides
    const slides = parseIntoSlides(rawContent || title);
    const formattedContent = slides.map(s => `[${s.section}]\n${s.text}`).join('\n\n');

    const songId = typeof createId === 'function' ? createId('song', title) : `song_${Date.now()}`;
    const searchNorm = typeof normalizeSearchText === 'function'
      ? normalizeSearchText(`${title}\n${author}\n${formattedContent}`)
      : `${title}\n${author}\n${formattedContent}`.toLowerCase();

    const newSong = {
      id: songId,
      title: title,
      author: author,
      content: formattedContent,
      text: formattedContent,
      slides: slides,
      searchableText: searchNorm,
      isSong: true,
      kind: 'song',
      presentationType: 6,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    if (typeof songs !== 'undefined' && Array.isArray(songs)) {
      // Unshift to top of songs so user sees it right away
      songs.unshift(newSong);
      if (typeof idbPut === 'function' && typeof STORE_SONGS !== 'undefined' && typeof buildSongRecord === 'function') {
        idbPut(STORE_SONGS, buildSongRecord(newSong, { isNew: true })).catch(() => {});
      }
    }

    if (typeof setSidebarTab === 'function') setSidebarTab('songs');
    const searchInput = document.getElementById('song-search');
    if (searchInput) searchInput.value = '';
    if (typeof setSearchValueForTab === 'function') setSearchValueForTab('songs', '');

    if (typeof renderSongs === 'function') renderSongs();
    if (typeof selectItem === 'function') selectItem(0);
    if (typeof updateButtonView === 'function') updateButtonView();
    if (typeof saveState === 'function') saveState();
    if (typeof saveToStorageDebounced === 'function') saveToStorageDebounced();

    closeNewSongModalClean();
    toast(`✅ Lagu "${title}" berhasil ditambahkan!`, 'success');
  }

  window.openNewSongModalClean = openNewSongModalClean;
  window.closeNewSongModalClean = closeNewSongModalClean;
  window.insertNewSongSectionTag = insertNewSongSectionTag;
  window.saveNewSongClean = saveNewSongClean;

  window.cleanLiturgyFromSongsLibrary = cleanLiturgyFromSongsLibrary;
  console.log('[EasyWorship] Integration module loaded successfully.');
})();
