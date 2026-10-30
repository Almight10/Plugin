with open('D:/LCD/obs-easyworship-plugin/js/panel/program-display-and-transform.js', 'r', encoding='utf-8') as f:
    text = f.read()

import re
matches = re.findall(r'(function\s+esc\b[^{]+\{.*?\}|const\s+esc\s*=.*?;|let\s+esc\s*=.*?;)', text, re.DOTALL)
print('matches in program-display-and-transform.js:', matches)

