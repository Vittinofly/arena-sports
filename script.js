/* ============================================================
   Arena Esporte: interação da landing
   Cada módulo sai em silêncio se o elemento não existir.
   ============================================================ */
'use strict';

(function () {
  document.documentElement.classList.add('js');
  const reduzido = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const $ = (sel, raiz) => (raiz || document).querySelector(sel);
  const $$ = (sel, raiz) => Array.from((raiz || document).querySelectorAll(sel));

  /* 1. Header inteligente */
  function initHeader() {
    const header = $('[data-header]');
    if (!header) return;
    let ultimo = window.scrollY;
    let agendado = false;
    function atualizar() {
      const y = window.scrollY;
      const menuAberto = document.body.classList.contains('menu-aberto');
      header.classList.toggle('is-scrolled', y > 20);
      if (!menuAberto) header.classList.toggle('is-hidden', y > 80 && y > ultimo + 2);
      if (y < ultimo - 2 || y <= 80) header.classList.remove('is-hidden');
      ultimo = y;
      agendado = false;
    }
    window.addEventListener('scroll', () => {
      if (!agendado) { agendado = true; requestAnimationFrame(atualizar); }
    }, { passive: true });
    requestAnimationFrame(atualizar);
  }

  /* 2. Menu mobile */
  function initMenu() {
    const botao = $('[data-menu-toggle]');
    const menu = $('[data-menu]');
    if (!botao || !menu) return;
    function abrir(sim) {
      botao.setAttribute('aria-expanded', String(sim));
      botao.setAttribute('aria-label', sim ? 'Fechar menu' : 'Abrir menu');
      menu.classList.toggle('is-open', sim);
      document.body.classList.toggle('menu-aberto', sim);
      if (sim) { const l = $('a', menu); if (l) l.focus(); }
    }
    botao.addEventListener('click', () => abrir(botao.getAttribute('aria-expanded') !== 'true'));
    menu.addEventListener('click', (e) => { if (e.target.closest('a')) abrir(false); });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && menu.classList.contains('is-open')) { abrir(false); botao.focus(); }
    });
    document.addEventListener('click', (e) => {
      if (menu.classList.contains('is-open') && !menu.contains(e.target) && !botao.contains(e.target)) abrir(false);
    });
    window.matchMedia('(min-width: 1024px)').addEventListener('change', (m) => { if (m.matches) abrir(false); });
  }

  /* 3. Revelação ao rolar */
  function initReveal() {
    const itens = $$('[data-reveal]');
    if (!itens.length) return;
    itens.forEach((el) => {
      const atraso = el.getAttribute('data-reveal-delay');
      if (atraso) el.style.setProperty('--reveal-delay', atraso + 'ms');
    });
    if (reduzido || !('IntersectionObserver' in window)) {
      itens.forEach((el) => el.classList.add('is-visible'));
      return;
    }
    const obs = new IntersectionObserver((entradas) => {
      entradas.forEach((en) => {
        if (en.isIntersecting) { en.target.classList.add('is-visible'); obs.unobserve(en.target); }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: .08 });
    itens.forEach((el) => obs.observe(el));
  }

  /* 4. Âncoras com scrollspy */
  function initScrollspy() {
    const links = $$('.nav__link[href^="#"]');
    if (!links.length || !('IntersectionObserver' in window)) return;
    const mapa = new Map();
    links.forEach((l) => { const s = $(l.getAttribute('href')); if (s) mapa.set(s, l); });
    const obs = new IntersectionObserver((entradas) => {
      entradas.forEach((en) => {
        if (en.isIntersecting) {
          links.forEach((l) => l.classList.remove('is-active'));
          const l = mapa.get(en.target);
          if (l) l.classList.add('is-active');
        }
      });
    }, { rootMargin: '-45% 0px -50% 0px' });
    mapa.forEach((_, s) => obs.observe(s));
  }

  /* 5. FAQ (um aberto por vez) */
  const FAQ_UM_POR_VEZ = true;
  function initAccordion() {
    $$('[data-accordion]').forEach((acc) => {
      const botoes = $$('button[aria-controls]', acc);
      function alternar(btn, abrir) {
        const painel = document.getElementById(btn.getAttribute('aria-controls'));
        if (!painel) return;
        btn.setAttribute('aria-expanded', String(abrir));
        if (abrir) {
          painel.hidden = false;
          if (!reduzido) {
            const h = painel.scrollHeight;
            painel.style.height = '0px';
            requestAnimationFrame(() => { painel.style.height = h + 'px'; });
            painel.addEventListener('transitionend', () => { painel.style.height = ''; }, { once: true });
          }
        } else if (reduzido) {
          painel.hidden = true;
        } else {
          painel.style.height = painel.scrollHeight + 'px';
          requestAnimationFrame(() => { painel.style.height = '0px'; });
          painel.addEventListener('transitionend', () => { painel.hidden = true; painel.style.height = ''; }, { once: true });
        }
      }
      botoes.forEach((btn, i) => {
        btn.addEventListener('click', () => {
          const abrir = btn.getAttribute('aria-expanded') !== 'true';
          if (abrir && FAQ_UM_POR_VEZ) botoes.forEach((b) => { if (b !== btn && b.getAttribute('aria-expanded') === 'true') alternar(b, false); });
          alternar(btn, abrir);
        });
        btn.addEventListener('keydown', (e) => {
          const alvo = e.key === 'ArrowDown' ? botoes[i + 1] : e.key === 'ArrowUp' ? botoes[i - 1] : e.key === 'Home' ? botoes[0] : e.key === 'End' ? botoes[botoes.length - 1] : null;
          if (alvo) { e.preventDefault(); alvo.focus(); }
        });
      });
    });
  }

  /* 6. Carrossel */
  function initCarousel() {
    $$('[data-carousel]').forEach((car) => {
      const trilho = $('[data-carousel-track]', car);
      if (!trilho) return;
      const itens = Array.from(trilho.children);
      const dots = $('[data-carousel-dots]', car);
      const ant = $('[data-carousel-prev]', car);
      const prox = $('[data-carousel-next]', car);
      const passo = () => (itens[1] ? itens[1].offsetLeft - itens[0].offsetLeft : trilho.clientWidth);
      const atual = () => Math.round(trilho.scrollLeft / Math.max(1, passo()));
      const ir = (i) => trilho.scrollTo({ left: Math.max(0, Math.min(i, itens.length - 1)) * passo(), behavior: reduzido ? 'auto' : 'smooth' });
      if (dots) {
        itens.forEach((_, i) => {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'carrossel__dot';
          b.setAttribute('aria-label', 'Ir para o depoimento ' + (i + 1));
          b.addEventListener('click', () => ir(i));
          dots.appendChild(b);
        });
      }
      function marcar() {
        const i = atual();
        if (dots) Array.from(dots.children).forEach((d, k) => d.setAttribute('aria-current', String(k === i)));
        if (ant) ant.disabled = trilho.scrollLeft < 4;
        if (prox) prox.disabled = trilho.scrollLeft + trilho.clientWidth >= trilho.scrollWidth - 4;
      }
      if (ant) ant.addEventListener('click', () => ir(atual() - 1));
      if (prox) prox.addEventListener('click', () => ir(atual() + 1));
      trilho.addEventListener('scroll', () => requestAnimationFrame(marcar), { passive: true });
      trilho.setAttribute('tabindex', '0');
      trilho.setAttribute('aria-label', 'Depoimentos. Use as setas do teclado para navegar.');
      trilho.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowRight') { e.preventDefault(); ir(atual() + 1); }
        if (e.key === 'ArrowLeft') { e.preventDefault(); ir(atual() - 1); }
      });
      window.addEventListener('resize', marcar, { passive: true });
      requestAnimationFrame(marcar);
    });
  }

  /* 7. Galeria com lightbox */
  function initLightbox() {
    const dialogo = $('dialog.lightbox');
    const links = $$('[data-lightbox]');
    if (!dialogo || !links.length || typeof dialogo.showModal !== 'function') return;
    let indice = 0;
    let origem = null;
    dialogo.innerHTML =
      '<figure class="lightbox__figura"><img class="lightbox__img" alt="" width="568" height="594"><figcaption class="lightbox__legenda"></figcaption></figure>' +
      '<button class="lightbox__btn lightbox__btn--ant" type="button" aria-label="Foto anterior"><svg class="icon" aria-hidden="true"><use href="#i-anterior"/></svg></button>' +
      '<button class="lightbox__btn lightbox__btn--prox" type="button" aria-label="Próxima foto"><svg class="icon" aria-hidden="true"><use href="#i-proximo"/></svg></button>' +
      '<button class="lightbox__btn lightbox__fechar" type="button" aria-label="Fechar foto"><svg class="icon" aria-hidden="true"><use href="#i-x"/></svg></button>';
    const img = $('.lightbox__img', dialogo);
    const leg = $('.lightbox__legenda', dialogo);
    function mostrar(i) {
      indice = (i + links.length) % links.length;
      const a = links[indice];
      const miniatura = $('img', a);
      img.src = a.getAttribute('href');
      img.alt = miniatura ? miniatura.alt : '';
      if (miniatura) {
        img.setAttribute('width', miniatura.getAttribute('width'));
        img.setAttribute('height', miniatura.getAttribute('height'));
      }
      const fc = a.closest('figure') && $('figcaption', a.closest('figure'));
      leg.textContent = fc ? fc.textContent : '';
    }
    links.forEach((a, i) => a.addEventListener('click', (e) => {
      e.preventDefault();
      origem = a;
      mostrar(i);
      dialogo.showModal();
    }));
    $('.lightbox__btn--ant', dialogo).addEventListener('click', () => mostrar(indice - 1));
    $('.lightbox__btn--prox', dialogo).addEventListener('click', () => mostrar(indice + 1));
    $('.lightbox__fechar', dialogo).addEventListener('click', () => dialogo.close());
    dialogo.addEventListener('click', (e) => { if (e.target === dialogo) dialogo.close(); });
    dialogo.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight') mostrar(indice + 1);
      if (e.key === 'ArrowLeft') mostrar(indice - 1);
    });
    dialogo.addEventListener('close', () => { if (origem) origem.focus(); });
  }

  /* 8. Contadores (só se existirem números reais no HTML) */
  function initContadores() {
    const itens = $$('[data-count-to]');
    if (!itens.length || !('IntersectionObserver' in window)) return;
    const obs = new IntersectionObserver((entradas) => {
      entradas.forEach((en) => {
        if (!en.isIntersecting) return;
        obs.unobserve(en.target);
        const el = en.target;
        const alvo = Number(el.getAttribute('data-count-to')) || 0;
        const sufixo = el.getAttribute('data-count-suffix') || '';
        if (reduzido) { el.textContent = alvo + sufixo; return; }
        const ini = performance.now();
        const passo = (t) => {
          const p = Math.min(1, (t - ini) / 1400);
          el.textContent = Math.round(alvo * (1 - Math.pow(1 - p, 3))) + sufixo;
          if (p < 1) requestAnimationFrame(passo);
        };
        requestAnimationFrame(passo);
      });
    });
    itens.forEach((el) => obs.observe(el));
  }

  /* 9. Vídeos só quando visíveis */
  function initVideos() {
    const videos = $$('video[data-video-lazy]');
    if (!videos.length || !('IntersectionObserver' in window)) return;
    const obs = new IntersectionObserver((entradas) => {
      entradas.forEach((en) => {
        const v = en.target;
        if (en.isIntersecting && !reduzido) { v.play().catch(() => {}); } else { v.pause(); }
      });
    }, { threshold: .25 });
    videos.forEach((v) => obs.observe(v));
  }

  /* 10. Ano do rodapé */
  function initAno() {
    $$('[data-year]').forEach((el) => { el.textContent = String(new Date().getFullYear()); });
  }

  /* 11. Efeito magnético leve no CTA principal */
  function initMagnetico() {
    if (reduzido || !window.matchMedia('(hover: hover)').matches) return;
    $$('[data-magnetico]').forEach((btn) => {
      btn.addEventListener('mousemove', (e) => {
        const r = btn.getBoundingClientRect();
        const x = (e.clientX - r.left - r.width / 2) * .14;
        const y = (e.clientY - r.top - r.height / 2) * .22;
        btn.style.transform = 'translate(' + x.toFixed(1) + 'px,' + (y - 2).toFixed(1) + 'px)';
      });
      btn.addEventListener('mouseleave', () => { btn.style.transform = ''; });
    });
  }

  /* 12. Assinatura: a bola sobe em arco por cima da rede, de tempos em tempos */
  function initArco() {
    const svg = $('[data-arco]');
    if (!svg) return;
    const anim = svg.querySelector('animateMotion');
    if (reduzido || !anim || typeof anim.beginElement !== 'function') return;
    let visivel = true;
    let timer = null;
    function lancar() {
      if (visivel && !document.hidden) anim.beginElement();
      timer = setTimeout(lancar, 6500);
    }
    if ('IntersectionObserver' in window) {
      new IntersectionObserver((en) => { visivel = en[0].isIntersecting; }).observe(svg);
    }
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) clearTimeout(timer);
      else { clearTimeout(timer); timer = setTimeout(lancar, 800); }
    });
    timer = setTimeout(lancar, 900);
  }

  /* Altura da faixa de aviso, para o header não cobrir */
  function initAviso() {
    const aviso = $('[data-aviso]');
    if (!aviso) return;
    const medir = () => {
      const h = aviso.hidden ? 0 : aviso.offsetHeight;
      document.body.style.setProperty('--aviso-h', h + 'px');
      document.body.classList.toggle('tem-aviso', h > 0);
    };
    new MutationObserver(medir).observe(aviso, { attributes: true, attributeFilter: ['hidden'] });
    window.addEventListener('resize', medir, { passive: true });
    requestAnimationFrame(medir);
  }

  document.addEventListener('DOMContentLoaded', () => {
    initHeader();
    initMenu();
    initReveal();
    initScrollspy();
    initAccordion();
    initCarousel();
    initLightbox();
    initContadores();
    initVideos();
    initAno();
    initMagnetico();
    initArco();
    initAviso();
  });
})();
