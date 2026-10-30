const fs = require('fs');

// Load songs-and-bible.js functions or simulate getPagesFromItem
const code = fs.readFileSync('D:/LCD/obs-easyworship-plugin/js/panel/songs-and-bible.js', 'utf8');

// Let's create an environment to test getPagesFromItem
const vm = require('vm');
const sandbox = {
  console: console,
  linesPerPage: 2,
  bibles: {},
  ITEM_PAGES_CACHE: new Map(),
  ITEM_PAGES_CACHE_LIMIT: 200,
  setBoundedCacheValue: (map, k, v) => { map.set(k, v); return v; },
  shouldDisplaySongsBySection: () => true,
  shouldShowSongSolfaNotes: () => false,
  shouldShowSongCategoryName: () => false,
  parseSongCategoryName: () => null,
  isLikelySolfaLine: () => false,
  shouldSkipPunctuationLine: () => false,
  renderSongPageHtml: (lines) => lines.join('<br>'),
  convertHighlightsToHtml: (l) => l,
  normalizeSongLyricsLineBreaks: (t) => t.replace(/\\r\\n/g, '\\n').replace(/\\r/g, '\\n'),
};

vm.createContext(sandbox);
vm.runInContext(code, sandbox);

// Now construct the item from 23 Agustus 2026.ewsx
const sampleSlides = [
  { section: 'Slide 1', text: 'GB 24\\nMari Menghadap Allah' },
  { section: 'Bait 1', text: 'KANTORIA\\nMari menghadap Allah;' },
  { section: 'Bait 1', text: 'JEMAAT\\npujilah Dia, Yesus, Tuhanmu.' },
  { section: 'Bait 1', text: 'KANTORIA\\nBersama beribadah;' },
  { section: 'Bait 1', text: 'JEMAAT\\nangkat suaramu, nyanyi gembira.' },
  { section: 'Bait 1', text: 'Kita semua jadi satu,\\nsatu di dalam kasih-Nya,' },
  { section: 'Bait 1', text: 'Tiada lagi perbedaan sebagai anak-anak-Nya.' },
  { section: 'Bait 1', text: 'Mari berpadu suara' },
  { section: 'Bait 1', text: 'KANTORIA\\nnyanyikan Haleluya!' }
];

const formattedContent = sampleSlides.map(s => `[${s.section}]\\n${s.text}`).join('\\n\\n');

const testItem = {
  id: 'song_124',
  title: 'GB 024',
  content: formattedContent,
  text: formattedContent,
  slides: sampleSlides,
  presentationType: 6,
  isSong: true,
  kind: 'song'
};

const pages = sandbox.getPagesFromItem(testItem, false);
console.log('Pages length:', pages ? pages.length : 'null');
if (pages) {
  pages.forEach((p, idx) => {
    console.log(`Page ${idx+1}: tag=${p.tag}, raw=${JSON.stringify(p.raw)}, text=${JSON.stringify(p.text)}`);
  });
}

