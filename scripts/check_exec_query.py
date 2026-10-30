with open('D:/LCD/obs-easyworship-plugin/js/panel/easyworship-import.js', 'r', encoding='utf-8') as f:
    text = f.read()

import re
m = re.search(r'function execQuery[^{]+\{.*?\}', text, re.DOTALL)
if m:
    print('execQuery:', m.group(0))
else:
    print('execQuery not found')

