with open('D:/LCD/obs-easyworship-plugin/js/panel/workspace-and-editor-tools.js', 'r', encoding='utf-8') as f:
    lines = f.readlines()

for i, line in enumerate(lines[2280:2410], 2281):
    try:
        print(f'{i}: {line}', end='')
    except:
        print(f'{i}: [unicode]')

