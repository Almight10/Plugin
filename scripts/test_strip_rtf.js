
  function stripRtf(rtf) {
    if (!rtf) return '';
    if (!String(rtf).trim().startsWith('{\\rtf')) {
      return String(rtf).trim();
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

  const sampleRtf = `{\\rtf1\\ansi\\deff0\\sdeasyworship2
{\\fonttbl{\\f0 Tahoma;}}
{\\colortbl ;\\red255\\green255\\blue0;}
{\\pard\\sdparawysiwghidden\\sdlistlevel-1\\qc\\qdef\\sdewparatemplatestyle102\\plain\\sdewtemplatestyle102\\fs144{\\*\\sdfsreal 72}{\\*\\sdfsdef 72}\\sdfsauto 1\\par}
{\\pard\\qc\\qdef\\sdewparatemplatestyle101{\\*\\sdasfactor 1}{\\*\\sdasbaseline 48}\\sdastextstyle101\\plain\\sdewtemplatestyle101\\fs144{\\*\\sdfsreal 72}{\\*\\sdfsdef 72}\\sdfsauto\\cf1 KANTORIA\\par}
{\\pard\\qc\\qdef\\sdewparatemplatestyle101\\plain\\sdewtemplatestyle101\\fs144{\\*\\sdfsreal 72}{\\*\\sdfsdef 72}\\sdfsauto Mari menghadap Allah;\\par}
}`;

  console.log('OUTPUT STRIP_RTF:');
  console.log(JSON.stringify(stripRtf(sampleRtf)));
