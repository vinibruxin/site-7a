import sys
s=open(sys.argv[1]).read()
head='<!doctype html>\n<html lang="pt-BR">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
j=s.index('</style>')+len('</style>')
open(sys.argv[2],'w').write(head+s[:j]+'\n<link rel="icon" href="img/logo-7a.png">\n</head>\n<body>\n'+s[j:]+'\n</body>\n</html>\n')
