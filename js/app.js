/* ============================================================
   Arena Esporte: app instalável (PWA)
   Registra o service worker e mostra o botão "Instalar app"
   quando o celular permite. No iPhone, mostra o passo a passo.
   ============================================================ */
(function () {
  'use strict';

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => { /* sem app offline, o site segue normal */ });
    });
  }

  const standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
  let pedido = null;

  function botoes() { return Array.from(document.querySelectorAll('[data-instalar]')); }
  function mostrar(sim) { botoes().forEach((b) => { b.hidden = !sim; }); }

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    pedido = e;
    if (!standalone) mostrar(true);
  });
  window.addEventListener('appinstalled', () => { pedido = null; mostrar(false); });

  document.addEventListener('DOMContentLoaded', () => {
    if (standalone) { document.documentElement.classList.add('modo-app'); return; }
    if (ios) mostrar(true);
    botoes().forEach((b) => b.addEventListener('click', async () => {
      if (pedido) {
        pedido.prompt();
        try { await pedido.userChoice; } catch (e) { /* o usuário fechou */ }
        pedido = null;
        mostrar(false);
        return;
      }
      const dica = document.querySelector('[data-dialogo-ios]');
      if (dica && typeof dica.showModal === 'function') dica.showModal();
    }));
  });
})();
