#!/usr/bin/env python3
# Gera uma página por artista do casting 7A (resumo, destaques, formação, ouvir e ver).
import html, json, os, sys

SITE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "site")

A = [
  dict(slug="ordem-mor", nome="Ordem Mor", serie="7A-001", genero="Rock autoral",
       chamada="O retorno de uma identidade consolidada.",
       foto=("img/ordem-mor.jpg", 1000, 1064, "Ordem Mor, os cinco integrantes em preto e branco", "50% 100%"),
       resumo=["Maturidade artística, força sonora e novo capítulo. Depois de um hiato, a Ordem Mor volta com repertório autoral sólido e identidade ainda mais definida.",
               "Conhecida pelo som potente e por letras que misturam introspecção e crítica social, a banda equilibra intensidade e profundidade emocional. O repertório também traz releituras de clássicos nacionais e internacionais.",
               "Ao vivo, o show é entrega total: presença firme, execução consistente e uma construção sonora que prende a atenção do início ao fim."],
       destaques=["Trabalho autoral consistente", "Nova fase artística", "Show intenso e emocional", "Releituras de clássicos nacionais e internacionais"],
       ideal="Casas de show, festivais e eventos de médio e grande porte",
       fecho="Ordem Mor voltou. E voltou maior.",
       galeria=["img/galeria/ordem-1.jpg", "img/galeria/ordem-2.jpg", "img/galeria/ordem-3.jpg", "img/galeria/ordem-4.jpg"],
       formacao=[("Bruno Bizonni", "Vocal"), ("Athos Tibães", "Guitarra solo"), ("Filipe Mamede", "Guitarra base"), ("Marcus Filipe", "Baixo"), ("Jackson Lopes", "Bateria")],
       midia=[("spotify", "2lvRwg4Ua9PL6bKmYMrR0U", None, 0, 0, "21 de Abril", "Spotify · do disco Co.Rec, Vol. I"),
              ("youtube", "8_y2PDSxRYA", None, 0, 0, "República", "YouTube · EP novo"),
              ("video", "midia/ordem-come-undone.mp4", "midia/ordem-come-undone.jpg", 640, 360, "Come Undone", "Vídeo"),
              ("video", "midia/ordem-topo-do-mundo.mp4", "midia/ordem-topo-do-mundo.jpg", 480, 594, "Topo do Mundo", "Trecho ao vivo")]),
  dict(slug="sub-rosa", nome="Sub Rosa", serie="7A-002", genero="Rock progressivo autoral",
       chamada="Técnica, atmosfera e narrativa sonora.",
       foto=("img/sub-rosa.jpg", 526, 526, "Sub Rosa, os quatro integrantes no palco, em preto e branco", "50% 50%"),
       resumo=["A Sub Rosa explora o rock progressivo em composições autorais que transitam entre ambientações atmosféricas, passagens técnicas e explosões de intensidade.",
               "A banda constrói cada apresentação como uma jornada musical, equilibrando virtuosismo e emoção. Cada música é parte de uma experiência maior: envolvente, sofisticada e impactante."],
       destaques=["Repertório autoral progressivo", "Arranjos elaborados", "Dinâmica instrumental marcante"],
       ideal="Festivais, eventos culturais e público exigente",
       fecho="Sub Rosa entrega música para ser ouvida, sentida e vivida.",
       formacao=[], midia=[("spotify", "6X8IUUwXG2B6eGvXMoIxSo", None, 0, 0, "Ars Regia Therion", "Spotify · do disco Kritherion"),
              ("youtube", "zYA_Ho2_iyY", None, 0, 0, "Kritherion", "YouTube")]),
  dict(slug="ossos-do-banquete", nome="Ossos do Banquete", serie="7A-003", genero="Punk rock autoral",
       chamada="Mais de duas décadas levando energia, atitude e identidade aos palcos do Brasil e do exterior.",
       foto=("img/ossos.jpg", 1200, 800, "Ossos do Banquete, foto em preto e branco com a guitarra vermelha", "47% 50%"),
       resumo=["A Ossos do Banquete faz punk rock autoral com personalidade forte e presença de palco marcante. As músicas próprias carregam riffs diretos, letras afiadas e a essência crua do rock'n'roll, em shows intensos e cheios de conexão com o público.",
               "A banda já dividiu o palco com Velhas Virgens, Raimundos e Cólera, e tocou em festivais como Roça 'n' Roll e Camping Rock.",
               "Em 2011 fez a primeira turnê internacional, a USA Tour, passando por Nova York, Miami e Boston. No ano seguinte, integrou o casting oficial do Brazilian Day New York, um dos maiores eventos de cultura brasileira fora do país."],
       destaques=["Repertório autoral", "Mais de 20 anos de estrada", "Turnê internacional nos EUA", "Participação em grandes festivais", "Presença de palco intensa e identidade consolidada"],
       ideal="Casas de show, festivais e eventos",
       fecho="Energia bruta, história construída e rock sem concessões.",
       galeria=["img/galeria/ossos-1.jpg", "img/galeria/ossos-2.jpg", "img/galeria/ossos-3.jpg", "img/galeria/ossos-4.jpg"],
       formacao=[("Reinaldo Ratto", "Vocal e guitarra"), ("Leandro Santana", "Guitarra"), ("Dan Ribeiro", "Baixo"), ("Wallison Bisu", "Bateria")],
       midia=[("spotify", "63o2iaMLCmkQDTg797RnIk", None, 0, 0, "Mineiridade", "Spotify"),
              ("youtube", "oAqmHzCPh78", None, 0, 0, "Ao vivo no Espaço DellArt", "YouTube"),
              ("audio", "midia/ossos-safra-recorde.mp3", None, 0, 0, "Safra Recorde", "Música"),
              ("video", "midia/ossos-jesus-numa-moto.mp4", "midia/ossos-jesus-numa-moto.jpg", 540, 960, "Jesus Numa Moto", "Ao vivo")]),
  dict(slug="athos-tibaes", nome="Athos Tibães", serie="7A-004", genero="MPB, voz e violão",
       chamada="Voz, violão e atmosfera acolhedora.",
       foto=("img/athos.jpg", 800, 1009, "Athos Tibães com a guitarra na frente do rosto", "50% 25%"),
       resumo=["Athos Tibães apresenta um show de MPB em formato voz e violão que valoriza a interpretação, a sensibilidade e a proximidade com o público.",
               "Com presença serena e execução refinada, suas apresentações criam ambientes sofisticados e agradáveis, onde a música conduz a experiência com naturalidade e elegância."],
       destaques=["MPB clássica e contemporânea", "Formato intimista", "Clima aconchegante e refinado"],
       ideal="Eventos privados, restaurantes e ambientes sofisticados",
       fecho="A escolha certa para momentos que pedem música com alma.",
       formacao=[], midia=[]),
  dict(slug="aenima", nome="Ænima", serie="7A-005", genero="Clássicos do rock em versões acústicas",
       chamada="Rock dos anos 80, 90 e 2000 com energia, identidade e conexão real com o público.",
       foto=("img/aenima.jpg", 599, 610, "Ænima: Athos Tibães com a guitarra e Bruno Bizonni com o microfone, em preto e branco", "50% 30%"),
       resumo=["A Ænima apresenta um repertório de clássicos do rock em versões acústicas modernas e envolventes. A proposta vai além da releitura: a dupla recria sucessos com arranjos próprios, mantendo a essência original com frescor e personalidade.",
               "Com voz marcante, execução precisa e dinâmica bem construída, o show alterna momentos intimistas com picos de energia que levantam o público. A experiência é nostálgica, vibrante e pensada para criar atmosfera."],
       destaques=["Repertório dos anos 80, 90 e 2000", "Formato acústico versátil", "Alto nível de interação com o público"],
       ideal="Eventos de empresa, bares e celebrações",
       fecho="A trilha sonora para quem quer rock com elegância e impacto.",
       formacao=[("Bruno Bizonni", "Voz"), ("Athos Tibães", "Violão e guitarra")], midia=[]),
  dict(slug="dj-ivan-lennon", nome="DJ Ivan Lennon", serie="7A-006", genero="Pop e pop rock na pista",
       chamada="Hits que conectam gerações e mantêm a pista ativa.",
       foto=("img/dj-ivan.jpg", 680, 690, "DJ Ivan Lennon de fones na cabine, em preto e branco", "55% 40%"),
       resumo=["Com repertório recheado de sucessos do pop e do pop rock, DJ Ivan Lennon constrói sets modernos, animados e pensados para manter a energia constante.",
               "A leitura de pista permite adaptar o set em tempo real, equilibrando nostalgia e atualidade para criar experiências envolventes e dançantes."],
       destaques=["Hits nacionais e internacionais", "Versatilidade para diferentes públicos", "Energia crescente e dinâmica"],
       ideal="Eventos de empresa, festas e celebrações",
       fecho="DJ Ivan Lennon transforma evento em experiência.",
       formacao=[], midia=[]),
]

e = html.escape

# endereço público do site (trocar quando o domínio próprio estiver ligado)
BASE = "https://site-7a.oculos.workers.dev"

CSS = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "artista.css")).read()


# capas do Spotify (thumbnail_url do oEmbed); se a imagem externa não carregar, entra a foto da banda
CAPAS = {
    "63o2iaMLCmkQDTg797RnIk": "https://image-cdn-fa.spotifycdn.com/image/ab67616d00001e02a22694c085fef6b366b3fab5",
    "2lvRwg4Ua9PL6bKmYMrR0U": "https://image-cdn-fa.spotifycdn.com/image/ab67616d00001e02a79bd17da5739cc90078b9bf",
    "6X8IUUwXG2B6eGvXMoIxSo": "https://image-cdn-fa.spotifycdn.com/image/ab67616d00001e026ee39de893253924c7750d53",
}


def midia_html(a):
    if not a["midia"]:
        return f'''<p class="vazio">Os vídeos e as músicas {"da" if a["nome"] in ("Sub Rosa", "Ænima") else "do"} {e(a["nome"])} entram aqui em breve. Enquanto isso, peça uma data e a 7A envia o material completo.</p>'''
    itens = []
    reserva = (a.get("galeria") or [a["foto"][0]])[0]
    for tipo, src, poster, w, h, titulo, rotulo in a["midia"]:
        if tipo == "spotify":
            capa = CAPAS.get(src, reserva)
            itens.append(f'''<figure class="faixa-spotify" data-revela>
          <a class="capa-link" href="https://open.spotify.com/track/{src}" target="_blank" rel="noopener" aria-label="Ouvir {e(titulo)} no Spotify"><img src="{capa}" alt="Capa de {e(titulo)}" width="300" height="300" loading="lazy" onerror="this.onerror=null;this.src='{reserva}'"><span class="play" aria-hidden="true"></span></a>
          <figcaption><span class="titulo">{e(titulo)}</span><span class="rotulo">{e(rotulo)}</span><a class="link" href="https://open.spotify.com/track/{src}" target="_blank" rel="noopener">Ouvir no Spotify</a></figcaption>
        </figure>''')
        elif tipo == "youtube":
            itens.append(f'''<figure class="faixa-yt" data-revela>
          <a class="capa-link quadro" href="https://youtu.be/{src}" target="_blank" rel="noopener" aria-label="Ver {e(titulo)} no YouTube"><img src="https://i.ytimg.com/vi/{src}/hqdefault.jpg" alt="Imagem do vídeo {e(titulo)}" width="480" height="360" loading="lazy" onerror="this.onerror=null;this.src='{reserva}'"><span class="play" aria-hidden="true"></span></a>
          <figcaption><span class="titulo">{e(titulo)}</span><span class="rotulo">{e(rotulo)}</span><a class="link" href="https://youtu.be/{src}" target="_blank" rel="noopener">Ver no YouTube</a></figcaption>
        </figure>''')
        elif tipo == "audio":
            itens.append(f'''<figure class="faixa-audio" data-revela>
          <figcaption><span class="titulo">{e(titulo)}</span><span class="rotulo">{e(rotulo)}</span></figcaption>
          <audio controls preload="none" src="{src}"></audio>
        </figure>''')
        else:
            classe = "vertical" if h > w else "horizontal"
            itens.append(f'''<figure class="faixa-video {classe}" data-revela>
          <video controls preload="none" playsinline poster="{poster}" width="{w}" height="{h}" src="{src}"></video>
          <figcaption><span class="titulo">{e(titulo)}</span><span class="rotulo">{e(rotulo)}</span></figcaption>
        </figure>''')
    return '<div class="grade-midia">\n        ' + "\n        ".join(itens) + "\n      </div>"


def pagina(i, a):
    prox = A[(i + 1) % len(A)]
    src, w, h, alt, pos = a["foto"]
    destaques = "\n".join(f'          <li data-revela>{e(d)}</li>' for k, d in enumerate(a["destaques"]))
    resumo = "\n".join(f"        <p>{e(p)}</p>" for p in a["resumo"])
    # formação e agenda sempre existem na página; o /admin (via Worker) preenche e mostra quando houver conteúdo
    linhas = "\n".join(f'          <li data-revela><span class="quem">{e(n)}</span><span class="faz">{e(f)}</span></li>' for n, f in a["formacao"])
    formacao = f'''
  <section class="formacao margem" aria-labelledby="t-formacao" data-bloco="formacao"{"" if a["formacao"] else " hidden"}>
    <h2 class="display rot" id="t-formacao" data-revela>Formação</h2>
    <ul class="lista-formacao" data-campo="formacao">
{linhas}
    </ul>
  </section>
  <section class="agenda-artista margem" id="agenda" aria-labelledby="t-agenda" data-bloco="agenda" hidden>
    <h2 class="display rot" id="t-agenda" data-revela>Agenda</h2>
    <ol class="lista-agenda" data-campo="agenda"></ol>
  </section>
'''
    galeria = ""
    if a.get("galeria"):
        from PIL import Image as _I
        itens = []
        for k, g in enumerate(a["galeria"]):
            gw, gh = _I.open(os.path.join(SITE, g)).size
            itens.append(f'        <li><img src="{g}" alt="{e(a["nome"])}, foto {k+1} de {len(a["galeria"])}, em preto e branco" width="{gw}" height="{gh}" loading="lazy"></li>')
        fotos = "\n".join(itens)
        galeria = f'''
  <section class="galeria" aria-label="Fotos de {e(a["nome"])}">
    <ul class="trilho margem" tabindex="0">
{fotos}
    </ul>
    <div class="setas margem">
      <button type="button" class="seta" data-dir="-1" aria-label="Foto anterior">&larr;</button>
      <button type="button" class="seta" data-dir="1" aria-label="Próxima foto">&rarr;</button>
    </div>
  </section>
'''
    pedir = f'index.html?artista={e(a["nome"])}#pedir'
    tem_midia = bool(a["midia"])
    return f'''<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>{e(a["nome"])} | 7A Produtora</title>
<meta name="description" content="{e(a["nome"])}: {e(a["genero"].lower())}. {e(a["chamada"])} Contrate pela 7A Produtora, Betim, MG.">
<link rel="icon" href="img/logo-7a.png">
<meta property="og:type" content="profile">
<meta property="og:locale" content="pt_BR">
<meta property="og:site_name" content="7A Produtora">
<meta property="og:title" content="{e(a["nome"])} | 7A Produtora">
<meta property="og:description" content="{e(a["genero"])}. {e(a["chamada"])}">
<meta property="og:url" content="{BASE}/{a["slug"]}.html">
<meta property="og:image" content="{BASE}/{a["foto"][0]}">
<meta name="twitter:card" content="summary_large_image">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Anton&family=Montserrat:wght@400;500;600;700&family=Space+Mono&display=swap">
<script>
document.documentElement.classList.add('js');
// ao chegar de outra página, sempre começar do topo (sem herdar a rolagem anterior)
try {{ if ("scrollRestoration" in history) history.scrollRestoration = "manual"; }} catch (e) {{}}
if (!location.hash) {{ window.addEventListener("DOMContentLoaded", function () {{ document.documentElement.style.scrollBehavior = "auto"; window.scrollTo(0, 0); document.documentElement.style.scrollBehavior = ""; }}); window.addEventListener("pageshow", function () {{ if (!location.hash) window.scrollTo(0, 0); }}); }}
</script>
<style>
{CSS}
</style>
</head>
<body>
<header class="topo-site margem" data-barra>
  <a class="marca" href="index.html" aria-label="7A Produtora, página inicial"><img src="img/logo-7a.png" alt="" width="40" height="47"><span>7A Produtora</span></a>
  <nav class="menu" id="menu" aria-label="Principal">
    <a href="index.html#casting">Casting</a>
    <a href="index.html#agenda">Agenda</a>
    <a href="index.html#formatos">Shows</a>
    <a href="index.html#pedir">Contratar</a>
  </nav>
  <a class="btn btn-barra" href="{pedir}">Pedir data</a>
  <button class="abre-menu" type="button" aria-expanded="false" aria-controls="menu">Menu</button>
</header>

<main>
  <section class="abre margem" aria-labelledby="t-nome">
    <div class="texto">
      <h1 class="display nome" id="t-nome">{e(a["nome"])}</h1>
      <p class="genero">{e(a["genero"])}</p>
      <p class="chamada" data-campo="chamada">{e(a["chamada"])}</p>
      <div class="acoes">
        <a class="btn" href="{pedir}">Pedir data</a>
        {'<a class="link" href="#ouvir">Ouvir e ver</a>' if tem_midia else ''}
      </div>
    </div>
    <figure class="retrato" style="aspect-ratio:{w} / {h}">
      <img src="{src}" alt="{e(alt)}" width="{w}" height="{h}" style="object-position:{pos}">
      <figcaption class="serial">Série {e(a["serie"])}</figcaption>
    </figure>
  </section>

  <section class="resumo margem" aria-labelledby="t-resumo">
    <h2 class="display rot" id="t-resumo" data-revela>Resumo</h2>
    <div class="corpo" data-revela data-campo="resumo">
{resumo}
    </div>
  </section>

{galeria}
  <section class="destaques margem" aria-labelledby="t-destaques">
    <h2 class="display rot" id="t-destaques" data-revela>Destaques</h2>
    <div>
      <ol class="lista-destaques" data-campo="destaques">
{destaques}
      </ol>
      <p class="ideal" data-revela data-campo="ideal">Ideal para {e(a["ideal"][0].lower() + a["ideal"][1:])}.</p>
    </div>
  </section>
{formacao}
  <section class="ouvir margem" id="ouvir" aria-labelledby="t-ouvir">
    <h2 class="display rot" id="t-ouvir" data-revela>Ouça e veja</h2>
    <div>
      {midia_html(a)}
    </div>
  </section>

  <a class="fecho" href="{pedir}">
    <span class="frase">{e(a["fecho"])}</span>
    <span class="display grande">Pedir data</span>
  </a>
</main>

<footer class="rodape margem">
  <a class="prox" href="{prox["slug"]}.html"><span>Próximo artista</span><b class="display">{e(prox["nome"])}</b></a>
  <p>7A Produtora · Betim, MG · <a href="https://wa.me/5531992233295">(31) 99223-3295</a> · <a href="mailto:7a.produtora@gmail.com">7a.produtora@gmail.com</a> · <a href="https://instagram.com/7a.produtora">@7a.produtora</a></p>
</footer>

<script>
(function () {{
  var alvos = document.querySelectorAll("[data-revela]");
  if (!("IntersectionObserver" in window)) {{ alvos.forEach(function (a) {{ a.classList.add("dentro"); }}); return; }}
  var io = new IntersectionObserver(function (es) {{
    es.forEach(function (x) {{ if (x.isIntersecting) {{ x.target.classList.add("dentro"); io.unobserve(x.target); }} }});
  }}, {{ rootMargin: "0px 0px -8% 0px", threshold: 0.05 }});
  alvos.forEach(function (a) {{ io.observe(a); }});
  // carrossel de fotos inteiras
  document.querySelectorAll(".galeria").forEach(function (gal) {{
    var trilho = gal.querySelector(".trilho");
    var itens = trilho.querySelectorAll("li");
    var parado = false, timer = null;
    var calmo = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    function atual() {{
      var x = trilho.scrollLeft, melhor = 0, dist = Infinity;
      itens.forEach(function (li, i) {{ var d = Math.abs(li.offsetLeft - trilho.offsetLeft - x - parseFloat(getComputedStyle(trilho).paddingLeft) + 0); if (d < dist) {{ dist = d; melhor = i; }} }});
      return melhor;
    }}
    function ir(i) {{
      var n = itens.length; i = (i + n) % n;
      var fim = trilho.scrollWidth - trilho.clientWidth;
      var alvo = itens[i].offsetLeft - itens[0].offsetLeft;
      // volta ao começo depois da última foto
      if (trilho.scrollLeft >= fim - 4 && i !== 0 && i > atual()) alvo = 0;
      trilho.scrollTo({{ left: Math.min(alvo, fim), behavior: calmo ? "auto" : "smooth" }});
    }}
    function proxima() {{ if (!parado && !document.hidden) ir(atual() + 1); }}
    function ligar() {{ if (!calmo && !timer) timer = setInterval(proxima, 4000); }}
    function desligar() {{ clearInterval(timer); timer = null; }}
    gal.querySelectorAll(".seta").forEach(function (b) {{
      b.addEventListener("click", function () {{ desligar(); ir(atual() + Number(b.getAttribute("data-dir"))); ligar(); }});
    }});
    gal.addEventListener("mouseenter", function () {{ parado = true; }});
    gal.addEventListener("mouseleave", function () {{ parado = false; }});
    trilho.addEventListener("touchstart", function () {{ parado = true; }}, {{ passive: true }});
    trilho.addEventListener("touchend", function () {{ setTimeout(function () {{ parado = false; }}, 5000); }});
    var visto = new IntersectionObserver(function (es) {{ es.forEach(function (x) {{ if (x.isIntersecting) ligar(); else desligar(); }}); }});
    visto.observe(gal);
  }});
  // menu do celular
  var barra = document.querySelector("[data-barra]"), botao = barra.querySelector(".abre-menu");
  botao.addEventListener("click", function () {{
    var aberto = barra.classList.toggle("aberta");
    botao.setAttribute("aria-expanded", aberto ? "true" : "false");
    botao.textContent = aberto ? "Fechar" : "Menu";
    document.documentElement.classList.toggle("sem-rolagem", aberto);
  }});
  barra.querySelectorAll(".menu a").forEach(function (l) {{ l.addEventListener("click", function () {{ if (barra.classList.contains("aberta")) botao.click(); }}); }});
  // uma mídia por vez
  var midias = document.querySelectorAll("audio, video");
  midias.forEach(function (m) {{ m.addEventListener("play", function () {{ midias.forEach(function (o) {{ if (o !== m) o.pause(); }}); }}); }});
}})();
</script>
</body>
</html>
'''


# conteúdo padrão que o /admin carrega antes da primeira edição
os.makedirs(os.path.join(SITE, "dados"), exist_ok=True)
with open(os.path.join(SITE, "dados", "padrao.json"), "w") as f:
    json.dump({
        "agenda": [],
        "artistas": {a["slug"]: {
            "nome": a["nome"], "chamada": a["chamada"], "resumo": a["resumo"], "destaques": a["destaques"],
            "ideal": a["ideal"], "formacao": [{"nome": n, "funcao": fn} for n, fn in a["formacao"]],
        } for a in A},
    }, f, ensure_ascii=False, indent=1)

for i, a in enumerate(A):
    with open(os.path.join(SITE, a["slug"] + ".html"), "w") as f:
        f.write(pagina(i, a))
print(json.dumps([a["slug"] for a in A]))
