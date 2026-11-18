"""Gera img/og-arena-esporte.jpg (1200x630) a partir das fotos tratadas.
Uso (na pasta do projeto): py design/gerar-og.py .
"""
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageFilter

RAIZ = Path(sys.argv[1])
IMG = RAIZ / 'img'
FONTE = RAIZ / 'design' / 'fontes' / 'Archivo-variavel.ttf'
W, H = 1200, 630
NAVY_950 = (9, 14, 38)
NAVY_900 = (14, 20, 51)
NAVY_800 = (23, 33, 82)
SOL = (245, 183, 49)
CREME = (251, 243, 225)
MUTED = (179, 186, 216)


def fonte(tam, largura, peso):
    f = ImageFont.truetype(str(FONTE), tam)
    eixos = f.get_variation_axes()
    valores = []
    for e in eixos:
        nome = e['name'] if isinstance(e['name'], str) else e['name'].decode()
        valores.append(largura if 'idth' in nome else peso)
    f.set_variation_by_axes(valores)
    return f


base = Image.new('RGB', (W, H), NAVY_900)
d = ImageDraw.Draw(base)
for y in range(H):
    t = y / H
    cor = tuple(int(NAVY_950[i] + (NAVY_800[i] - NAVY_950[i]) * t) for i in range(3))
    d.line([(0, y), (W, y)], fill=cor)

# brilho de refletor
brilho = Image.new('L', (W, H), 0)
ImageDraw.Draw(brilho).ellipse((-300, -420, 520, 300), fill=60)
brilho = brilho.filter(ImageFilter.GaussianBlur(120))
base = Image.composite(Image.new('RGB', (W, H), (255, 244, 214)), base, brilho)

# sol
sol = Image.new('RGBA', (W, H), (0, 0, 0, 0))
ImageDraw.Draw(sol).ellipse((760, 150, 1300, 690), fill=SOL + (235,))
base.paste(sol, (0, 0), sol)

# fotos em moldura
def moldura(caminho, largura, angulo):
    foto = Image.open(caminho).convert('RGB')
    alt = int(foto.height * largura / foto.width)
    foto = foto.resize((largura, alt), Image.LANCZOS)
    card = Image.new('RGB', (largura + 16, alt + 16), CREME)
    card.paste(foto, (8, 8))
    card = card.convert('RGBA').rotate(angulo, expand=True, resample=Image.BICUBIC)
    sombra = Image.new('RGBA', card.size, (0, 0, 0, 0))
    sombra.paste((0, 0, 0, 110), (0, 0), card.split()[3])
    sombra = sombra.filter(ImageFilter.GaussianBlur(14))
    return card, sombra


noite, s1 = moldura(IMG / 'quadras-de-areia-iluminadas-a-noite-arena-esporte.webp', 220, 4)
drone, s2 = moldura(IMG / 'quadra-de-areia-futevolei-vista-de-drone-arena-esporte.webp', 300, -3)
for img, sombra, pos in ((noite, s1, (735, 40)), (drone, s2, (860, 170))):
    base.paste(sombra, (pos[0] + 8, pos[1] + 14), sombra)
    base.paste(img, pos, img)

# logo
logo = Image.open(IMG / 'logo-arena-esporte.png').convert('RGBA').resize((112, 112), Image.LANCZOS)
anel = Image.new('RGBA', (124, 124), (0, 0, 0, 0))
ImageDraw.Draw(anel).ellipse((0, 0, 123, 123), fill=SOL + (255,))
base.paste(anel, (64, 52), anel)
base.paste(logo, (70, 58), logo)

d = ImageDraw.Draw(base)
d.text((206, 78), 'ARENA', font=fonte(44, 68, 900), fill=CREME)
d.text((206, 122), 'ESPORTE', font=fonte(44, 68, 900), fill=SOL)

titulo = fonte(118, 62, 900)
d.text((64, 210), 'QUADRAS', font=titulo, fill=(255, 255, 255))
d.text((64, 318), 'DE AREIA', font=titulo, fill=SOL)
d.text((66, 446), 'Futevôlei e vôlei · São Luís de Montes Belos (GO)', font=fonte(30, 100, 500), fill=MUTED)

# selo "Reserve pelo site"
selo_f = fonte(28, 85, 800)
texto = 'RESERVE PELO SITE'
larg = d.textlength(texto, font=selo_f)
d.rounded_rectangle((64, 500, 64 + larg + 48, 552), radius=26, fill=SOL)
d.text((88, 508), texto, font=selo_f, fill=NAVY_900)

# rede no pé
rede = Image.new('RGBA', (W, 34), NAVY_950 + (255,))
rd = ImageDraw.Draw(rede)
for x in range(-40, W + 40, 16):
    rd.line([(x, 6), (x + 28, 34)], fill=(238, 240, 250, 70), width=1)
    rd.line([(x + 28, 6), (x, 34)], fill=(238, 240, 250, 70), width=1)
rd.rectangle((0, 0, W, 6), fill=SOL + (255,))
base.paste(rede, (0, H - 34), rede)

saida = IMG / 'og-arena-esporte.jpg'
base.save(saida, 'JPEG', quality=86, optimize=True, progressive=True)
print(saida, saida.stat().st_size // 1024, 'KB')
