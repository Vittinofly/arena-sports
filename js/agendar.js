/* ============================================================
   Arena Esporte: tela de agendamento
   Dia -> hora e quadra -> dados -> pedido. Só mostra o que pode
   ser marcado; o banco confere tudo de novo na hora de salvar.
   ============================================================ */
(function () {
  'use strict';

  const A = window.Arena;
  if (!A) return;
  const R = A.R;
  const U = A.util;
  const esc = U.escapar;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const ICONE = (id) => '<svg class="icon" aria-hidden="true"><use href="#' + id + '"/></svg>';
  const MOTIVO = { reserva: 'Reservada', fixo: 'Turma fixa', bloqueio: 'Bloqueada' };
  const ERROS_DE_AGENDA = ['CONFLITO_RESERVA', 'CONFLITO_FIXO', 'CONFLITO_BLOQUEIO', 'HORARIO_PASSADO', 'ANTECEDENCIA',
    'DIA_FECHADO', 'HORARIO_INEXISTENTE', 'FORA_DO_HORARIO', 'QUADRA_INATIVA', 'QUADRA_SEM_RESERVA_ONLINE', 'FORA_DA_JANELA', 'DATA_PASSADA'];

  const estado = { ctx: null, data: null, blocos: 1, hora: null, quadra: null, ocupacoes: [], disp: null, enviando: false };

  /* ---------- Textos ---------- */
  function duracaoTexto(min) {
    const h = Math.floor(min / 60);
    const m = min % 60;
    if (!h) return m + ' min';
    return h + 'h' + (m ? String(m).padStart(2, '0') : '');
  }
  function slotAtual() {
    return estado.disp && estado.hora ? estado.disp.slots.find((s) => s.hora === estado.hora) : null;
  }
  function nomeQuadra(id) {
    const q = estado.ctx.quadras.find((x) => x.id === id);
    return q ? q.nome : '';
  }

  /* ---------- Topo: status, aviso, regras e contatos ---------- */
  function aplicarConfig() {
    const c = estado.ctx.config;
    if (A.modo === 'demo') $('[data-demo]').hidden = false;
    const st = R.statusAgora(estado.ctx);
    const pill = $('[data-status]');
    if (pill) {
      $('[data-status-texto]', pill).textContent = st.texto + (st.detalhe ? ' · ' + st.detalhe : '');
      pill.classList.toggle('is-aberto', st.aberto);
      pill.hidden = false;
    }
    if (c.aviso_ativo && c.aviso_texto) {
      $('[data-aviso-texto]').textContent = c.aviso_texto;
      $('[data-aviso]').hidden = false;
    }
    const n = String(c.whatsapp || '').replace(/\D/g, '');
    if (n) {
      $$('a[data-whats]').forEach((a) => {
        try { const u = new URL(a.href); u.pathname = '/' + n; a.href = u.toString(); } catch (e) { /* mantém */ }
      });
    }
    $('[data-janela-texto]').textContent = 'A agenda abre para os próximos ' + c.janela_dias + ' dias.';
    const antecedencia = c.antecedencia_min % 60 === 0 ? (c.antecedencia_min / 60) + (c.antecedencia_min === 60 ? ' hora' : ' horas') : c.antecedencia_min + ' minutos';
    const regras = [
      c.limite_ativas > 0 ? c.limite_ativas + (c.limite_ativas === 1 ? ' reserva ativa' : ' reservas ativas') + ' por WhatsApp. Jogou ou cancelou, pode marcar outra.' : '',
      'Reserva pelo site até ' + antecedencia + ' antes do jogo.',
      'Cancelamento pelo link até ' + c.prazo_cancelamento_h + 'h antes. Depois, só pelo WhatsApp.',
      c.faltas_bloqueio > 0 ? c.faltas_bloqueio + ' faltas sem avisar suspendem a reserva pelo site.' : '',
      c.pix_ativo && c.pix_chave ? 'Pagamento na arena ou Pix adiantado.' : 'Pagamento na arena, no dia do jogo.'
    ].filter(Boolean);
    $('[data-regras-lista]').innerHTML = regras.map((t) => '<li>' + esc(t) + '</li>').join('');
    $('[data-modalidades]').innerHTML = c.modalidades.map((m) => '<option>' + esc(m) + '</option>').join('') + '<option>Outra</option>';
    montarDuracao();
  }

  function montarDuracao() {
    const c = estado.ctx.config;
    const el = $('[data-duracao]');
    if (c.max_blocos <= 1) { el.hidden = true; estado.blocos = 1; return; }
    let html = '';
    for (let n = 1; n <= c.max_blocos; n++) {
      html += '<label><input type="radio" name="duracao" value="' + n + '"' + (n === estado.blocos ? ' checked' : '') + '><span>' + duracaoTexto(c.bloco_min * n) + '</span></label>';
    }
    el.innerHTML = html;
    el.hidden = false;
    el.addEventListener('change', (e) => {
      if (e.target.name !== 'duracao') return;
      estado.blocos = Number(e.target.value);
      recalcular();
      renderHoras();
    });
  }

  /* ---------- Reservas guardadas neste aparelho ---------- */
  async function montarMinhas() {
    const el = $('[data-minhas]');
    const lista = A.aparelho.listar().slice(0, 4);
    if (!lista.length) return;
    const ativas = [];
    for (const item of lista) {
      try {
        const r = await A.publico.minhaReserva(item.token);
        if (!r) { A.aparelho.remover(item.token); continue; }
        if (R.ATIVOS.includes(r.status) && new Date(r.fim).getTime() > Date.now()) ativas.push(Object.assign({ token: item.token }, r));
      } catch (e) { /* sem conexão: ignora */ }
    }
    if (!ativas.length) { el.innerHTML = ''; return; }
    const limite = estado.ctx.config.limite_ativas;
    el.innerHTML = ativas.map((r) => {
      const st = R.STATUS[r.status];
      return '<div class="minha-card"><p><b>Você tem jogo marcado: ' + esc(U.quando(r.inicio, r.fim)) + '</b>' +
        esc(r.quadra || '') + ' · <span class="selo selo--' + esc(r.status) + '">' + esc(st ? st.texto : r.status) + '</span></p>' +
        '<a class="btn btn--escuro btn--sm" href="reserva.html?t=' + encodeURIComponent(r.token) + '">Ver reserva</a></div>';
    }).join('') + (limite > 0 && ativas.length >= limite
      ? '<div class="alerta alerta--atencao">' + ICONE('i-alerta') + '<p>Cada WhatsApp pode ter ' + limite + (limite === 1 ? ' reserva ativa' : ' reservas ativas') +
        ' por vez. Para marcar outra com o mesmo número, espere o jogo ou cancele a atual.</p></div>'
      : '');
  }

  /* ---------- 1. Dias ---------- */
  function montarDias(preferida) {
    const dias = R.diasDaJanela(estado.ctx);
    const el = $('[data-dias]');
    el.innerHTML = dias.map((d) => {
      const marca = !d.aberto ? (d.especial && d.motivo ? d.motivo : 'Fechado') : (d.especial ? (d.motivo || 'Especial') : '');
      // O nome acessível começa pelo texto que aparece no botão (WCAG 2.5.3)
      const rotulo = d.rotulo + ' ' + d.dia + ' ' + d.mes + (marca ? ' ' + marca : '') + ', ' + R.dataLonga(d.data) +
        (d.aberto ? (d.especial && d.motivo ? ', horário especial' : '') : ', arena fechada');
      return '<button type="button" class="dia' + (d.especial ? ' dia--especial' : '') + '" data-data="' + d.data + '" aria-pressed="false"' +
        (d.aberto ? '' : ' disabled') + ' aria-label="' + esc(rotulo) + '">' +
        '<span class="dia__semana">' + esc(d.rotulo) + '</span> <span class="dia__num">' + d.dia + '</span> <span class="dia__mes">' + esc(d.mes) + '</span>' +
        (marca ? ' <span class="dia__motivo">' + esc(marca) + '</span>' : '') + '</button>';
    }).join('');
    el.addEventListener('click', (e) => {
      const b = e.target.closest('.dia');
      if (b && !b.disabled) selecionarDia(b.getAttribute('data-data'));
    });
    const abertos = dias.filter((d) => d.aberto);
    const inicial = abertos.find((d) => d.data === preferida) || abertos[0];
    if (inicial) return selecionarDia(inicial.data, { rolar: false });
    $('[data-horas]').innerHTML = '<p class="mensagem-dia"><b>A agenda online está sem dias abertos.</b> Fale com a arena no WhatsApp.</p>';
    return Promise.resolve();
  }

  async function selecionarDia(data, opcoes) {
    const o = opcoes || {};
    estado.data = data;
    if (!o.manterHora) { estado.hora = null; estado.quadra = null; }
    $$('.dia').forEach((b) => b.setAttribute('aria-pressed', String(b.getAttribute('data-data') === data)));
    const botao = $('.dia[data-data="' + data + '"]');
    if (botao && botao.scrollIntoView && o.rolar !== false) botao.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
    $('[data-horas]').innerHTML = '<div class="esqueleto esqueleto--dias"></div>';
    $('[data-quadras]').hidden = true;
    atualizarResumo();
    await carregarOcupacao();
    renderHoras();
  }

  async function carregarOcupacao() {
    try {
      estado.ocupacoes = await A.publico.ocupacao(estado.data);
      recalcular();
      return true;
    } catch (e) {
      estado.disp = null;
      $('[data-horas]').innerHTML = '<div class="alerta alerta--erro" role="alert">' + ICONE('i-alerta') + '<p>' + esc(A.traduzir(e).message) +
        ' <button class="btn btn--texto" type="button" data-tentar>Tentar de novo</button></p></div>';
      const t = $('[data-tentar]');
      if (t) t.addEventListener('click', () => selecionarDia(estado.data, { manterHora: true }));
      return false;
    }
  }
  function recalcular() {
    estado.disp = R.disponibilidade(estado.data, estado.ctx, { blocos: estado.blocos, ocupacoes: estado.ocupacoes });
  }

  /* ---------- 2. Horas e quadras ---------- */
  function renderHoras() {
    const el = $('[data-horas]');
    const d = estado.disp;
    if (!d) return;
    if (!d.dia.aberto) {
      el.innerHTML = '<p class="mensagem-dia"><b>A arena não abre nesse dia.</b> ' + esc(d.dia.motivo || '') + '</p>';
      limparHora();
      return;
    }
    const slots = d.slots.filter((s) => s.estado !== 'passado');
    if (!slots.length) {
      el.innerHTML = '<p class="mensagem-dia"><b>Os horários desse dia já passaram.</b> Escolha outro dia.</p>';
      limparHora();
      return;
    }
    const livres = slots.filter((s) => s.estado === 'livre');
    let html = '';
    if (d.dia.especial && d.dia.motivo) html += '<p class="passo__ajuda">Horário especial: ' + esc(d.dia.motivo) + ' (' + R.horaTexto(d.dia.abre) + ' às ' + R.horaTexto(d.dia.fecha) + ').</p>';
    html += '<div class="horas" role="group" aria-label="Horários de ' + esc(R.dataLonga(estado.data)) + '">' + slots.map((s) => {
      const info = s.estado === 'livre' ? (s.livres === 1 ? '1 quadra' : s.livres + ' quadras')
        : s.estado === 'lotado' ? 'Lotado' : 'Só no WhatsApp';
      const rotulo = s.hora + ' ' + info + (s.estado === 'livre' ? (s.livres === 1 ? ' livre' : ' livres') : '') + ', até ' + s.horaFim;
      return '<button type="button" class="hora" data-hora="' + s.hora + '" aria-pressed="' + (s.hora === estado.hora) + '"' +
        (s.estado === 'livre' ? '' : ' disabled') + ' aria-label="' + esc(rotulo) + '"><span class="hora__h">' + s.hora + '</span> ' +
        '<span class="hora__info">' + esc(info) + '</span></button>';
    }).join('') + '</div>';
    if (!livres.length) {
      html += '<p class="mensagem-dia"><b>Esse dia já está cheio pelo site.</b> Tente outro dia ou chame no WhatsApp, às vezes abre vaga.</p>';
    } else if (slots.some((s) => s.estado === 'antecedencia')) {
      html += '<p class="passo__ajuda">"Só no WhatsApp": falta pouco pro horário começar, então a reserva é direto com a arena.</p>';
    }
    el.innerHTML = html;
    $$('.hora', el).forEach((b) => b.addEventListener('click', () => selecionarHora(b.getAttribute('data-hora'))));
    const atual = slotAtual();
    if (atual && atual.estado === 'livre') renderQuadras();
    else limparHora();
  }

  function limparHora() {
    estado.hora = null;
    estado.quadra = null;
    $('[data-quadras]').hidden = true;
    atualizarResumo();
  }

  function selecionarHora(hora) {
    estado.hora = hora;
    $$('.hora').forEach((b) => b.setAttribute('aria-pressed', String(b.getAttribute('data-hora') === hora)));
    renderQuadras();
    const caixa = $('[data-quadras]');
    if (caixa.scrollIntoView) caixa.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  function renderQuadras() {
    const slot = slotAtual();
    const caixa = $('[data-quadras]');
    if (!slot) { caixa.hidden = true; return; }
    const livres = slot.quadras.filter((q) => q.livre);
    if (!livres.some((q) => q.id === estado.quadra)) estado.quadra = livres.length ? livres[0].id : null;
    $('[data-quadras-lista]').innerHTML = slot.quadras.map((q) => {
      const info = estado.ctx.quadras.find((x) => x.id === q.id) || {};
      return '<label class="quadra-opcao"><input type="radio" name="quadra" value="' + esc(q.id) + '"' + (q.livre ? '' : ' disabled') +
        (q.id === estado.quadra ? ' checked' : '') + '><span class="quadra-opcao__corpo"><span class="quadra-opcao__marca" aria-hidden="true"></span>' +
        '<span class="quadra-opcao__nome">' + esc(q.nome) + '</span><span class="quadra-opcao__desc">' +
        esc(q.livre ? (info.descricao || 'Livre') : MOTIVO[q.motivo] || 'Ocupada') + '</span></span></label>';
    }).join('');
    $$('input[name="quadra"]', caixa).forEach((i) => i.addEventListener('change', () => { estado.quadra = i.value; atualizarResumo(); }));
    caixa.hidden = false;
    atualizarResumo();
  }

  /* ---------- Resumo (lateral no computador, barra no celular) ---------- */
  function atualizarResumo() {
    const c = estado.ctx.config;
    const slot = slotAtual();
    const itens = [
      ['Dia', estado.data ? R.dataLonga(estado.data) : 'Escolha o dia'],
      ['Horário', slot ? R.horaTexto(slot.ini) + ' às ' + R.horaTexto(slot.fim) : 'Escolha a hora'],
      ['Quadra', estado.quadra ? nomeQuadra(estado.quadra) : 'A escolher'],
      ['Valor', slot && slot.valor != null ? U.preco(slot.valor) : 'Combinado na arena'],
      ['Pagamento', c.pix_ativo && c.pix_chave ? 'Na arena ou Pix' : 'Na arena']
    ];
    $('[data-resumo-lista]').innerHTML = itens.map((i) => '<div><dt>' + esc(i[0]) + '</dt><dd>' + esc(i[1]) + '</dd></div>').join('');
    const pronto = !!(estado.data && slot && estado.quadra);
    const p = estado.data ? R.dataCurta(estado.data) : '';
    $('[data-barra-titulo]').textContent = pronto
      ? R.DIAS_CURTOS[R.diaDaSemana(estado.data)] + ', ' + p + ' · ' + R.horaTexto(slot.ini) + ' · ' + nomeQuadra(estado.quadra)
      : estado.data ? 'Agora escolha o horário' : 'Escolha o dia e o horário';
    $('[data-barra-sub]').textContent = slot && slot.valor != null ? U.preco(slot.valor) + ' · pagamento na arena' : 'Pagamento na arena';
    $('#passo-dia').classList.toggle('is-feito', !!estado.data);
    $('#passo-hora').classList.toggle('is-feito', pronto);
  }

  /* ---------- 3. Dados e envio ---------- */
  function mascaraWhatsapp() {
    const input = $('#f-whats');
    input.addEventListener('input', () => {
      let d = input.value.replace(/\D/g, '');
      if (d.length > 11 && d.startsWith('55')) d = d.slice(2);
      d = d.slice(0, 11);
      let v = d;
      if (d.length > 2) v = '(' + d.slice(0, 2) + ') ' + d.slice(2);
      if (d.length > 7) v = '(' + d.slice(0, 2) + ') ' + d.slice(2, d.length === 11 ? 7 : 6) + '-' + d.slice(d.length === 11 ? 7 : 6);
      input.value = v;
    });
  }

  function preencherCliente() {
    const cli = A.aparelho.cliente();
    if (!cli) return;
    if (cli.nome) $('#f-nome').value = cli.nome;
    if (cli.whatsapp) $('#f-whats').value = R.formatarWhatsapp(cli.whatsapp);
    if (cli.modalidade) {
      const sel = $('#f-modalidade');
      if (Array.from(sel.options).some((o) => o.value === cli.modalidade)) sel.value = cli.modalidade;
    }
  }

  function erroCampo(nome, msg) {
    const campo = $('[data-campo="' + nome + '"]');
    if (!campo) return;
    campo.classList.add('is-erro');
    const s = $('[data-erro-campo]', campo);
    if (s) s.textContent = msg;
    const input = $('input', campo);
    if (input) input.setAttribute('aria-invalid', 'true');
  }
  function limparErros() {
    $$('[data-campo]').forEach((c) => {
      c.classList.remove('is-erro');
      const s = $('[data-erro-campo]', c);
      if (s) s.textContent = '';
      const i = $('input', c);
      if (i) i.removeAttribute('aria-invalid');
    });
    $('[data-erro]').innerHTML = '';
  }
  function erroGeral(msg, extra) {
    const el = $('[data-erro]');
    el.innerHTML = '<div class="alerta alerta--erro" role="alert">' + ICONE('i-alerta') + '<p>' + esc(msg) + (extra || '') + '</p></div>';
    if (el.scrollIntoView) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
  function irPara(id, msg) {
    const passo = document.getElementById(id);
    erroGeral(msg);
    if (passo && passo.scrollIntoView) passo.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  async function tratarErro(codigo, mensagem) {
    const c = estado.ctx.config;
    const linkWhats = ' <a href="' + esc(U.whatsapp(c.whatsapp, 'Olá! Tentei reservar pelo site da Arena Esporte e preciso de ajuda.')) + '" target="_blank" rel="noopener noreferrer">Chamar no WhatsApp</a>';
    if (codigo === 'NOME_INVALIDO') { erroCampo('nome', mensagem); $('#f-nome').focus(); return; }
    if (codigo === 'WHATSAPP_INVALIDO') { erroCampo('whatsapp', mensagem); $('#f-whats').focus(); return; }
    if (codigo === 'LIMITE_CLIENTE') {
      erroCampo('whatsapp', 'Esse WhatsApp já tem reserva ativa.');
      erroGeral(mensagem, ' <a href="reserva.html">Ver minha reserva</a>');
      return;
    }
    if (codigo === 'CLIENTE_BLOQUEADO' || codigo === 'MUITAS_TENTATIVAS') { erroGeral(mensagem, linkWhats); return; }
    if (ERROS_DE_AGENDA.includes(codigo)) {
      erroGeral(mensagem, codigo === 'ANTECEDENCIA' ? linkWhats : '');
      estado.hora = null;
      estado.quadra = null;
      if (await carregarOcupacao()) renderHoras();
      return;
    }
    erroGeral(mensagem || 'Não deu para concluir a reserva. Tente de novo.', linkWhats);
  }

  function ocupado(sim) {
    estado.enviando = sim;
    $$('[data-enviar]').forEach((b) => {
      b.disabled = sim;
      if (sim) { b.dataset.rotulo = b.innerHTML; b.textContent = 'Enviando...'; }
      else if (b.dataset.rotulo) { b.innerHTML = b.dataset.rotulo; }
    });
  }

  async function enviar(e) {
    e.preventDefault();
    if (estado.enviando) return;
    const form = e.currentTarget;
    limparErros();
    if (form.site.value) return;                       // campo invisível preenchido: robô
    if (!estado.data) { irPara('passo-dia', 'Escolha o dia do jogo.'); return; }
    const slot = slotAtual();
    if (!slot) { irPara('passo-hora', 'Escolha o horário.'); return; }
    if (!estado.quadra) { irPara('passo-hora', 'Escolha a quadra.'); return; }
    let ok = true;
    if (!R.nomeValido(form.nome.value)) { erroCampo('nome', R.mensagem('NOME_INVALIDO')); ok = false; }
    if (!R.whatsappValido(form.whatsapp.value)) { erroCampo('whatsapp', R.mensagem('WHATSAPP_INVALIDO')); ok = false; }
    if (!ok) {
      const primeiro = $('.is-erro input');
      if (primeiro) primeiro.focus();
      erroGeral('Confira os campos marcados.');
      return;
    }
    if (!form.aceite.checked) { erroGeral('Marque que você leu os combinados da arena.'); form.aceite.focus(); return; }

    const pedido = {
      quadra_id: estado.quadra, data: estado.data, hora: estado.hora, blocos: estado.blocos,
      nome: form.nome.value, whatsapp: form.whatsapp.value,
      jogadores: form.jogadores.value, modalidade: form.modalidade.value, observacoes: form.observacoes.value.trim()
    };
    const pre = R.validarReserva(pedido, Object.assign({}, estado.ctx, { ocupacoes: estado.ocupacoes }), {});
    if (!pre.ok) { tratarErro(pre.erro.codigo, pre.erro.mensagem); return; }

    ocupado(true);
    try {
      const r = await A.publico.criarReserva(pedido);
      sucesso(r, pedido);
    } catch (err) {
      const x = A.traduzir(err);
      tratarErro(x.codigo, x.message);
    } finally {
      ocupado(false);
    }
  }

  function sucesso(r, pedido) {
    A.aparelho.guardar({ token: r.token, codigo: r.codigo, inicio: r.inicio, fim: r.fim, quadra: r.quadra });
    A.aparelho.lembrarCliente({ nome: R.limparNome(pedido.nome), whatsapp: R.normalizarWhatsapp(pedido.whatsapp), modalidade: pedido.modalidade });
    const reserva = Object.assign({}, r, { cliente_nome: R.limparNome(pedido.nome), modalidade: pedido.modalidade, pago: false });
    const caixa = $('[data-sucesso]');
    caixa.innerHTML = window.ArenaBilhete.html(reserva, estado.ctx, { modo: 'sucesso' });
    window.ArenaBilhete.montarPix(caixa, reserva, estado.ctx);
    $('[data-fluxo]').hidden = true;
    $('[data-barra]').hidden = true;
    caixa.hidden = false;
    const outra = $('[data-outra]', caixa);
    if (outra) outra.addEventListener('click', novaReserva);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    caixa.focus({ preventScroll: true });
  }

  async function novaReserva() {
    $('[data-sucesso]').hidden = true;
    $('[data-fluxo]').hidden = false;
    $('[data-barra]').hidden = false;
    $('#form-reserva').aceite.checked = false;
    $('#f-obs').value = '';
    limparErros();
    estado.hora = null;
    estado.quadra = null;
    await montarMinhas();
    await carregarOcupacao();
    renderHoras();
    $('#passo-dia').scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  // De tempos em tempos a agenda é relida, para ninguém tentar um horário que já saiu
  async function atualizarSozinho() {
    if (!estado.data || estado.enviando || document.hidden || !$('[data-sucesso]').hidden) return;
    const hora = estado.hora;
    if (!(await carregarOcupacao())) return;
    renderHoras();
    if (hora && estado.hora !== hora) erroGeral('O horário que você tinha escolhido acabou de ser reservado por outra pessoa. Escolha outro.');
  }

  document.addEventListener('DOMContentLoaded', async () => {
    try {
      estado.ctx = await A.publico.contexto();
    } catch (e) {
      $('[data-dias]').innerHTML = '';
      $('[data-horas]').innerHTML = '<div class="alerta alerta--erro" role="alert">' + ICONE('i-alerta') + '<p>Não deu para abrir a agenda: ' +
        esc(A.traduzir(e).message) + ' Atualize a página ou chame a arena no WhatsApp.</p></div>';
      return;
    }
    aplicarConfig();
    preencherCliente();
    mascaraWhatsapp();
    $('#form-reserva').addEventListener('submit', enviar);
    montarMinhas();
    const params = new URLSearchParams(location.search);
    await montarDias(params.get('data'));
    const hora = params.get('hora');
    if (hora) {
      const s = estado.disp && estado.disp.slots.find((x) => x.hora === hora && x.estado === 'livre');
      if (s) selecionarHora(hora);
    }
    setInterval(atualizarSozinho, 60000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) atualizarSozinho(); });
  });
})();
