with open('D:/LCD/obs-easyworship-plugin/js/panel/easyworship-import.js', 'r', encoding='utf-8') as f:
    lines = f.readlines()
for i, line in enumerate(lines[680:730], 681):
    try:
        print(f'{i}: {line}', end='')
    except:
        print(f'{i}: [unicode line]')

