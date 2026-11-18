/* ============================================================
   Arena Esporte: o "bilhete" da reserva
   Usado na tela de sucesso (agendar.html) e em reserva.html.
   ============================================================ */
(function () {
  'use strict';

  const A = window.Arena;
  if (!A) return;
  const R = A.R;
  const U = A.util;
  const esc = U.escapar;
  const ICONE = (id) => '<svg class="icon" aria-hidden="true"><use href="#' + id + '"/></svg>';

  function pagamentoTexto(c) {
    return c.pix_ativo && c.pix_chave ? 'Na arena (ou Pix adiantado)' : 'Na arena, no dia do jogo';
  }

  function mensagemWhats(r, modo) {
    const linhas = [
      modo === 'sucesso' ? 'Olá! Fiz uma reserva pelo site da Arena Esporte.' : 'Olá! Quero falar sobre a minha reserva na Arena Esporte.',
      'Código: ' + r.codigo,
      U.quando(r.inicio, r.fim),
      r.quadra || '',
      r.cliente_nome ? 'Nome: ' + r.cliente_nome : ''
    ];
    if (r.token) linhas.push('Acompanhar: ' + U.linkReserva(r.token));
    return linhas.filter(Boolean).join('\n');
  }

  function aviso(r, ctx) {
    const c = ctx.config;
    const ativo = R.ATIVOS.includes(r.status);
    const passou = new Date(r.fim).getTime() <= Date.now();
    if (r.status === 'pendente' && !passou) {
      return '<div class="alerta alerta--info">' + ICONE('i-alerta') + '<p><b>O horário já está guardado pra você.</b> A arena confirma pelo WhatsApp. Pra agilizar, mande a mensagem pronta no botão verde.</p></div>';
    }
    if (r.status === 'confirmada' && !passou) {
      return '<div class="alerta alerta--ok">' + ICONE('i-check') + '<p><b>Reserva confirmada.</b> É só chegar. Precisa desmarcar? Use o botão abaixo até ' + c.prazo_cancelamento_h + 'h antes do jogo.</p></div>';
    }
    if (r.status === 'cancelada') {
      return '<div class="alerta alerta--erro">' + ICONE('i-alerta') + '<p><b>Reserva cancelada' + (r.cancelado_por === 'cliente' ? ' por você' : ' pela arena') + '.</b> ' +
        (r.motivo_cancelamento && r.cancelado_por !== 'cliente' ? esc(r.motivo_cancelamento) + '. ' : '') + 'O horário voltou para a agenda.</p></div>';
    }
    if (r.status === 'falta') return '<div class="alerta alerta--atencao">' + ICONE('i-alerta') + '<p>A arena marcou que ninguém apareceu nesse horário.</p></div>';
    if (r.status === 'concluida' || (ativo && passou)) return '<div class="alerta alerta--info">' + ICONE('i-check') + '<p>Esse jogo já aconteceu. Bora marcar o próximo?</p></div>';
    return '';
  }

  /*
    r: { codigo, token, status, inicio, fim, quadra, cliente_nome, modalidade, valor, pago, ... }
    opcoes.modo: 'sucesso' | 'consulta'
  */
  function html(r, ctx, opcoes) {
    const o = opcoes || {};
    const c = ctx.config;
    const st = R.STATUS[r.status] || { texto: r.status };
    const ativoFuturo = R.ATIVOS.includes(r.status) && new Date(r.fim).getTime() > Date.now();
    const whatsArena = U.whatsapp(c.whatsapp, mensagemWhats(r, o.modo));
    const pode = o.modo === 'consulta' ? R.podeCancelar(r, ctx) : { pode: false };
    const dados = [
      ['Quando', U.quando(r.inicio, r.fim)],
      ['Quadra', r.quadra || 'A confirmar'],
      r.cliente_nome ? ['Nome', r.cliente_nome] : null,
      r.modalidade ? ['Modalidade', r.modalidade] : null,
      ['Valor', r.valor != null ? U.preco(r.valor) + (r.pago ? ' · pago' : '') : 'Combinado na arena'],
      ['Pagamento', pagamentoTexto(c)]
    ].filter(Boolean);

    let acoes = '';
    if (ativoFuturo) {
      acoes += '<a class="btn btn--whatsapp btn--lg" href="' + esc(whatsArena) + '" target="_blank" rel="noopener noreferrer">' + ICONE('i-whats') +
        (o.modo === 'sucesso' ? ' Avisar a arena no WhatsApp' : ' Falar com a arena') + '</a>';
      if (o.modo === 'sucesso' && r.token) acoes += '<a class="btn btn--escuro" href="reserva.html?t=' + encodeURIComponent(r.token) + '">' + ICONE('i-ticket') + ' Ver minha reserva</a>';
      acoes += '<a class="btn btn--ghost" href="' + esc(U.linkAgenda(r, r.quadra)) + '" target="_blank" rel="noopener noreferrer">' + ICONE('i-agenda') + ' Salvar na agenda</a>';
      if (o.modo === 'consulta') {
        acoes += pode.pode
          ? '<button class="btn btn--ghost" type="button" data-cancelar>' + ICONE('i-x') + ' Cancelar reserva</button>'
          : '';
      }
      if (o.modo === 'sucesso') acoes += '<button class="btn btn--ghost" type="button" data-outra>' + ICONE('i-agenda') + ' Fazer outra reserva</button>';
    } else {
      acoes += '<a class="btn btn--primary btn--lg" href="agendar.html">' + ICONE('i-agenda') + ' Marcar outro horário</a>';
      acoes += '<a class="btn btn--ghost" href="' + esc(whatsArena) + '" target="_blank" rel="noopener noreferrer">' + ICONE('i-whats') + ' Falar com a arena</a>';
    }

    let nota = '';
    if (o.modo === 'sucesso') nota = 'Esta reserva fica guardada neste aparelho, em "Minha reserva". Em outro celular, use o código e o seu WhatsApp.';
    else if (ativoFuturo && !pode.pode) nota = esc(pode.motivo || '') + ' Se não puder ir, avise a arena pelo WhatsApp.';

    return '' +
      '<div class="bilhete__topo">' +
        '<p class="bilhete__rotulo">' + (o.modo === 'sucesso' ? 'Pedido enviado' : 'Sua reserva') + '</p>' +
        '<h2 class="bilhete__titulo" id="t-sucesso">' + (o.modo === 'sucesso' ? 'Horário guardado!' : esc(R.dataLonga(R.isoParaLocal(r.inicio).data))) + '</h2>' +
        '<p class="bilhete__codigo">' + esc(r.codigo) + '</p>' +
        '<span class="selo selo--' + esc(r.status) + '">' + esc(st.texto) + '</span>' +
      '</div>' +
      '<div class="bilhete__corpo">' +
        '<dl class="bilhete__dados">' + dados.map((d) => '<div><dt>' + esc(d[0]) + '</dt><dd>' + esc(d[1]) + '</dd></div>').join('') + '</dl>' +
        aviso(r, ctx) +
        (ativoFuturo && c.pix_ativo && c.pix_chave && !r.pago ? '<div class="pix" data-pix></div>' : '') +
        '<div class="bilhete__acoes">' + acoes + '</div>' +
        (nota ? '<p class="bilhete__nota">' + nota + '</p>' : '') +
      '</div>';
  }

  // Monta o bloco do Pix (opcional) dentro do bilhete
  async function montarPix(raiz, r, ctx) {
    const el = raiz.querySelector('[data-pix]');
    if (!el || !window.ArenaPix) return;
    const c = ctx.config;
    const codigo = window.ArenaPix.copiaECola({
      chave: c.pix_chave, nome: c.pix_nome || 'Arena Esporte', cidade: c.pix_cidade,
      valor: r.valor, txid: String(r.codigo || '').replace(/[^A-Z0-9]/gi, '')
    });
    if (!codigo) { el.remove(); return; }
    el.innerHTML =
      '<p><b>Quer adiantar pelo Pix?</b> É opcional: você também pode pagar na arena.' + (r.valor != null ? ' Valor: ' + U.preco(r.valor) + '.' : '') + '</p>' +
      '<div class="pix__qr" data-pix-qr></div>' +
      '<label class="campo__rotulo" for="pix-codigo">Pix copia e cola</label>' +
      '<textarea id="pix-codigo" readonly>' + esc(codigo) + '</textarea>' +
      '<button class="btn btn--escuro btn--sm" type="button" data-copiar-pix>Copiar código do Pix</button>' +
      '<p class="bilhete__nota">Depois de pagar, mande o comprovante no WhatsApp da arena.</p>';
    el.querySelector('[data-copiar-pix]').addEventListener('click', async (ev) => {
      const b = ev.currentTarget;
      try { await navigator.clipboard.writeText(codigo); }
      catch (e) { const t = el.querySelector('textarea'); t.select(); document.execCommand('copy'); }
      b.textContent = 'Código copiado';
      setTimeout(() => { b.textContent = 'Copiar código do Pix'; }, 2500);
    });
    const img = await window.ArenaPix.imagemQr(codigo);
    if (img) el.querySelector('[data-pix-qr]').appendChild(img);
  }

  window.ArenaBilhete = { html, montarPix, mensagemWhats };
})();
