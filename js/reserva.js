/* ============================================================
   Arena Esporte: página "Minha reserva"
   Com ?t=TOKEN mostra a reserva; sem token, lista as reservas
   guardadas neste aparelho e busca por código + WhatsApp.
   ============================================================ */
(function () {
  'use strict';

  const A = window.Arena;
  if (!A) return;
  const R = A.R;
  const U = A.util;
  const esc = U.escapar;
  const $ = (s, r) => (r || document).querySelector(s);
  const ICONE = (id) => '<svg class="icon" aria-hidden="true"><use href="#' + id + '"/></svg>';
  let ctx = null;

  function mensagem(tipo, texto) {
    $('[data-mensagem]').innerHTML = texto ? '<div class="alerta alerta--' + tipo + '" role="' + (tipo === 'erro' ? 'alert' : 'status') + '">' +
      ICONE(tipo === 'ok' ? 'i-check' : 'i-alerta') + '<p>' + texto + '</p></div>' : '';
  }

  async function mostrarReserva(token) {
    const caixa = $('[data-bilhete]');
    caixa.hidden = false;
    caixa.innerHTML = '<div class="esqueleto esqueleto--bilhete"></div>';
    let r;
    try {
      r = await A.publico.minhaReserva(token);
    } catch (e) {
      caixa.hidden = true;
      mensagem('erro', esc(A.traduzir(e).message));
      return;
    }
    if (!r) {
      caixa.hidden = true;
      A.aparelho.remover(token);
      mensagem('erro', 'Não achamos essa reserva. Confira o link ou busque pelo código.');
      mostrarBusca();
      return;
    }
    r.token = token;
    A.aparelho.guardar({ token, codigo: r.codigo, inicio: r.inicio, fim: r.fim, quadra: r.quadra });
    caixa.innerHTML = window.ArenaBilhete.html(r, ctx, { modo: 'consulta' });
    window.ArenaBilhete.montarPix(caixa, r, ctx);
    const botao = $('[data-cancelar]', caixa);
    if (botao) botao.addEventListener('click', () => pedirCancelamento(r));
  }

  function pedirCancelamento(r) {
    const dialogo = $('[data-dialogo-cancelar]');
    $('[data-cancelar-texto]').textContent = U.quando(r.inicio, r.fim) + ', ' + (r.quadra || 'quadra') +
      '. O horário volta para a agenda e outra pessoa pode reservar.';
    const confirmar = async () => {
      if (dialogo.returnValue !== 'sim') return;
      try {
        await A.publico.cancelarReserva(r.token);
        mensagem('ok', 'Reserva cancelada. Obrigado por avisar com antecedência.');
        await mostrarReserva(r.token);
      } catch (e) {
        mensagem('erro', esc(A.traduzir(e).message));
      }
    };
    if (typeof dialogo.showModal === 'function') {
      dialogo.returnValue = '';
      dialogo.addEventListener('close', confirmar, { once: true });
      dialogo.showModal();
    } else if (window.confirm('Cancelar a reserva?')) {
      dialogo.returnValue = 'sim';
      confirmar();
    }
  }

  async function mostrarBusca() {
    $('[data-busca]').hidden = false;
    const lista = A.aparelho.listar();
    if (lista.length) {
      $('[data-aparelho]').hidden = false;
      $('[data-lista-aparelho]').innerHTML = lista.map((x) => '<li><a href="reserva.html?t=' + encodeURIComponent(x.token) + '"><span><b>' +
        esc(x.codigo || 'Reserva') + '</b><small>' + esc(x.inicio && x.fim ? U.quando(x.inicio, x.fim) : '') + (x.quadra ? ' · ' + esc(x.quadra) : '') +
        '</small></span>' + ICONE('i-seta') + '</a></li>').join('');
    }
    const form = $('[data-form-busca]');
    const whats = $('#b-whats');
    whats.addEventListener('input', () => {
      const d = whats.value.replace(/\D/g, '').slice(0, 11);
      whats.value = d.length > 7 ? '(' + d.slice(0, 2) + ') ' + d.slice(2, d.length === 11 ? 7 : 6) + '-' + d.slice(d.length === 11 ? 7 : 6)
        : d.length > 2 ? '(' + d.slice(0, 2) + ') ' + d.slice(2) : d;
    });
    const cli = A.aparelho.cliente();
    if (cli && cli.whatsapp && !whats.value) whats.value = R.formatarWhatsapp(cli.whatsapp);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const erro = $('[data-erro-busca]');
      erro.innerHTML = '';
      const codigo = form.codigo.value.trim();
      if (!/^(AE-?)?[A-Z0-9]{4}$/i.test(codigo)) {
        erro.innerHTML = '<div class="alerta alerta--erro" role="alert">' + ICONE('i-alerta') + '<p>O código tem o formato AE-XXXX.</p></div>';
        return;
      }
      if (!R.whatsappValido(form.whatsapp.value)) {
        erro.innerHTML = '<div class="alerta alerta--erro" role="alert">' + ICONE('i-alerta') + '<p>' + esc(R.mensagem('WHATSAPP_INVALIDO')) + '</p></div>';
        return;
      }
      try {
        const cod = codigo.toUpperCase().replace(/^AE-?/, 'AE-');
        const token = await A.publico.buscarReserva(cod.startsWith('AE-') ? cod : 'AE-' + cod, form.whatsapp.value);
        if (!token) {
          erro.innerHTML = '<div class="alerta alerta--erro" role="alert">' + ICONE('i-alerta') + '<p>Não achamos reserva com esse código e esse WhatsApp.</p></div>';
          return;
        }
        location.href = 'reserva.html?t=' + encodeURIComponent(token);
      } catch (err) {
        erro.innerHTML = '<div class="alerta alerta--erro" role="alert">' + ICONE('i-alerta') + '<p>' + esc(A.traduzir(err).message) + '</p></div>';
      }
    });
  }

  document.addEventListener('DOMContentLoaded', async () => {
    if (A.modo === 'demo') $('[data-demo]').hidden = false;
    try {
      ctx = await A.publico.contexto();
    } catch (e) {
      mensagem('erro', 'Não deu para carregar: ' + esc(A.traduzir(e).message));
      return;
    }
    const n = String(ctx.config.whatsapp || '').replace(/\D/g, '');
    if (n) document.querySelectorAll('a[data-whats]').forEach((a) => {
      try { const u = new URL(a.href); u.pathname = '/' + n; a.href = u.toString(); } catch (x) { /* mantém */ }
    });
    const token = new URLSearchParams(location.search).get('t');
    if (token) mostrarReserva(token);
    else mostrarBusca();
  });
})();
