/* ============================================================
   Arena Esporte: painel da arena
   Login obrigatório -> agenda, pedidos, horários fixos, feriados
   e bloqueios, quadras, horário e regras, clientes e contatos.
   No Supabase quem protege os dados é o RLS (só admin escreve);
   esta tela só organiza o trabalho.
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
  const DIAS_TIT = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
  const DIAS_PLURAL = ['Todo domingo', 'Toda segunda', 'Toda terça', 'Toda quarta', 'Toda quinta', 'Toda sexta', 'Todo sábado'];
  const ORDEM_SEMANA = [1, 2, 3, 4, 5, 6, 0];
  const TITULOS = {
    agenda: 'Agenda', pedidos: 'Pedidos', fixos: 'Horários fixos', feriados: 'Feriados e bloqueios',
    quadras: 'Quadras', regras: 'Horário e regras', clientes: 'Clientes', contatos: 'Contatos e aviso'
  };
  const CHAVE_ALERTAS = 'arena-esporte-alertas';

  const est = {
    base: null, secao: 'agenda', data: R.agoraLocal().data, aba: 'pendentes', busca: '', buscaClientes: '',
    pendentes: null, avisar: {}, cache: new Map(), timer: null, iniciado: false
  };

  /* ==================== Utilidades de tela ==================== */
  function toast(msg, tipo) {
    const el = document.createElement('div');
    el.className = 'toast' + (tipo ? ' toast--' + tipo : '');
    el.setAttribute('role', tipo === 'erro' ? 'alert' : 'status');
    el.innerHTML = ICONE(tipo === 'erro' ? 'i-alerta' : 'i-check') + '<span>' + esc(msg) + '</span>';
    $('[data-toasts]').appendChild(el);
    setTimeout(() => el.remove(), tipo === 'erro' ? 7000 : 4500);
  }
  function falha(e) {
    const x = A.traduzir(e);
    toast(x.message, 'erro');
    if (x.codigo === 'SEM_PERMISSAO' || x.codigo === 'SESSAO_EXPIRADA') setTimeout(() => location.reload(), 2500);
  }
  function confirmar(o) {
    return new Promise((ok) => {
      const d = $('[data-confirmar]');
      $('[data-c-titulo]').textContent = o.titulo;
      let campo = '';
      if (o.campo === 'texto') campo = '<label class="campo__rotulo" for="c-campo">' + esc(o.rotulo || 'Motivo') + '</label><textarea id="c-campo" maxlength="200" rows="2">' + esc(o.valor || '') + '</textarea>';
      if (o.campo === 'data') campo = '<label class="campo__rotulo" for="c-campo">' + esc(o.rotulo || 'Data') + '</label><input id="c-campo" type="date" value="' + esc(o.valor || '') + '" min="' + esc(o.min || '') + '">';
      if (o.campo === 'check') campo = '<label class="campo--check"><input id="c-campo" type="checkbox"' + (o.valor ? ' checked' : '') + '> ' + esc(o.rotulo) + '</label>';
      $('[data-c-texto]').innerHTML = (o.html || '') + campo;
      const sim = $('[data-c-sim]');
      sim.textContent = o.botao || 'Confirmar';
      sim.className = 'btn ' + (o.perigo ? 'btn--perigo' : 'btn--primary');
      $('[data-c-nao]').textContent = o.voltar || 'Voltar';
      d.returnValue = '';
      d.addEventListener('close', () => {
        const c = $('#c-campo');
        ok({ ok: d.returnValue === 'sim', valor: c ? (c.type === 'checkbox' ? c.checked : c.value.trim()) : null });
      }, { once: true });
      d.showModal();
      const c = $('#c-campo');
      if (c && o.campo !== 'check') c.focus();
    });
  }
  function abrirModal(titulo, html) {
    $('[data-modal-titulo]').textContent = titulo;
    const corpo = $('[data-modal-corpo]');
    corpo.innerHTML = html;
    const m = $('[data-modal]');
    if (!m.open) m.showModal();
    corpo.scrollTop = 0;
    return corpo;
  }
  function fecharModal() {
    const m = $('[data-modal]');
    if (m.open) m.close();
  }
  function ocupado(botao, sim, texto) {
    if (!botao) return;
    if (sim) { botao.dataset.rotulo = botao.innerHTML; botao.disabled = true; botao.textContent = texto || 'Salvando...'; }
    else { botao.disabled = false; if (botao.dataset.rotulo) botao.innerHTML = botao.dataset.rotulo; }
  }

  /* ==================== Textos e datas ==================== */
  const cfg = () => est.base.config;
  const hoje = () => R.agoraLocal().data;
  function nomeQuadra(id) {
    const q = est.base.quadras.find((x) => x.id === id);
    return q ? q.nome : 'Quadra removida';
  }
  function primeiroNome(nome) { return String(nome || '').trim().split(/\s+/)[0] || ''; }
  function quandoCurto(r) {
    const a = R.isoParaLocal(r.inicio);
    const b = R.isoParaLocal(r.fim);
    return {
      dia: R.DIAS_CURTOS[R.diaDaSemana(a.data)] + ' ' + R.dataCurta(a.data),
      horas: R.minParaHhmm(a.min) + ' às ' + (b.data === a.data ? R.minParaHhmm(b.min) : '24:00'),
      data: a.data, ini: a.min
    };
  }
  function dataHora(iso) {
    if (!iso) return '';
    const l = R.isoParaLocal(iso);
    return R.dataCurta(l.data) + ' às ' + R.minParaHhmm(l.min);
  }
  function haQuanto(iso) {
    const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (min < 1) return 'agora';
    if (min < 60) return 'há ' + min + ' min';
    const h = Math.round(min / 60);
    if (h < 24) return 'há ' + h + 'h';
    return 'há ' + Math.round(h / 24) + ' dia(s)';
  }
  function duracaoTexto(min) {
    const h = Math.floor(min / 60);
    const m = min % 60;
    return h ? h + 'h' + (m ? String(m).padStart(2, '0') : '') : m + ' min';
  }
  function urlSite(pagina) {
    if (location.protocol.startsWith('http')) return new URL(pagina, location.href).href;
    return (A.config.siteUrl || '') + pagina;
  }
  const ativa = (r) => R.ATIVOS.includes(r.status);
  const futura = (r) => new Date(r.fim).getTime() > Date.now();
  const comecou = (r) => new Date(r.inicio).getTime() <= Date.now();

  /* ==================== Mensagens de WhatsApp ==================== */
  function msgConfirmacao(r) {
    return [
      'Olá, ' + primeiroNome(r.cliente_nome) + '! Sua reserva na Arena Esporte está confirmada.',
      U.quando(r.inicio, r.fim),
      nomeQuadra(r.quadra_id) + ' · código ' + r.codigo,
      cfg().pix_ativo && cfg().pix_chave ? 'Pagamento na arena ou pelo Pix.' : 'O pagamento é feito na arena.',
      r.token ? 'Precisa desmarcar? Use o link até ' + cfg().prazo_cancelamento_h + 'h antes: ' + U.linkReserva(r.token) : ''
    ].filter(Boolean).join('\n');
  }
  function msgCancelamento(r, motivo) {
    return 'Olá, ' + primeiroNome(r.cliente_nome) + '. Sua reserva de ' + U.quando(r.inicio, r.fim) + ' (' + nomeQuadra(r.quadra_id) +
      ') foi cancelada pela arena.' + (motivo ? ' Motivo: ' + motivo + '.' : '') + ' Quer marcar outro horário? ' + urlSite('agendar.html');
  }
  function msgRemarcacao(r) {
    return 'Olá, ' + primeiroNome(r.cliente_nome) + '! Sua reserva na Arena Esporte mudou para ' + U.quando(r.inicio, r.fim) + ', ' +
      nomeQuadra(r.quadra_id) + '. Código ' + r.codigo + '.' + (r.token ? '\nDetalhes: ' + U.linkReserva(r.token) : '');
  }
  function msgLembrete(r) {
    const q = quandoCurto(r);
    const quando = q.data === hoje() ? 'hoje' : q.data === R.somarDias(hoje(), 1) ? 'amanhã' : R.dataLonga(q.data).toLowerCase();
    return 'Olá, ' + primeiroNome(r.cliente_nome) + '! Passando pra lembrar do seu jogo ' + quando + ' às ' + R.horaTexto(q.ini) + ' na ' +
      nomeQuadra(r.quadra_id) + ' da Arena Esporte. Até lá!';
  }
  function linkWhats(numero, msg) { return U.whatsapp(numero, msg); }
  function botaoAvisar(r) {
    const a = est.avisar[r.id];
    if (!a || !r.cliente_whatsapp) return '';
    return '<div class="aviso-whats"><p>' + esc(a.titulo) + '</p><a class="btn btn--whatsapp btn--sm" href="' + esc(linkWhats(r.cliente_whatsapp, a.msg)) +
      '" target="_blank" rel="noopener noreferrer" data-acao="avisou" data-id="' + esc(r.id) + '">' + ICONE('i-whats') + ' Avisar no WhatsApp</a></div>';
  }

  /* ==================== Login ==================== */
  function mostrarLogin(modo, msg, tipo) {
    $('[data-painel]').hidden = true;
    $('[data-tela-login]').hidden = false;
    $('[data-form-login]').hidden = modo !== 'login';
    $('[data-form-recuperar]').hidden = modo !== 'recuperar';
    $('[data-form-nova-senha]').hidden = modo !== 'nova';
    $('[data-login-sub]').hidden = modo !== 'login';
    loginMsg(msg || '', tipo);
    const foco = modo === 'login' ? '#l-email' : modo === 'recuperar' ? '#r-email' : '#n-senha';
    setTimeout(() => { const f = $(foco); if (f) f.focus(); }, 50);
  }
  function loginMsg(msg, tipo) {
    $('[data-login-msg]').innerHTML = msg ? '<div class="alerta alerta--' + (tipo || 'erro') + '" role="alert">' + ICONE(tipo === 'ok' ? 'i-check' : 'i-alerta') + '<p>' + esc(msg) + '</p></div>' : '';
  }

  function ligarLogin() {
    if (A.modo === 'demo') $('[data-login-demo]').hidden = false;
    const ver = $('[data-ver-senha]');
    ver.addEventListener('click', () => {
      const input = $('#l-senha');
      const mostrar = input.type === 'password';
      input.type = mostrar ? 'text' : 'password';
      ver.setAttribute('aria-pressed', String(mostrar));
      ver.setAttribute('aria-label', mostrar ? 'Esconder senha' : 'Mostrar senha');
    });
    $('[data-form-login]').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.currentTarget;
      const botao = $('[data-botao-login]');
      loginMsg('');
      if (!f.email.value.trim() || !f.senha.value) { loginMsg('Preencha o e-mail e a senha.'); return; }
      ocupado(botao, true, 'Entrando...');
      try {
        await A.auth.entrar(f.email.value, f.senha.value);
        if (!(await A.auth.ehAdmin())) {
          await A.auth.sair();
          throw new A.ErroArena('SEM_ACESSO', 'Esta conta não tem acesso ao painel da arena.');
        }
        f.senha.value = '';
        await entrarNoPainel();
      } catch (err) {
        loginMsg(A.traduzir(err).message);
        f.senha.select();
      } finally {
        ocupado(botao, false);
      }
    });
    $('[data-ir-recuperar]').addEventListener('click', () => {
      if (A.modo === 'demo') { loginMsg('No modo demonstração a senha fica em js/config.js (demoAdmin).', 'info'); return; }
      $('#r-email').value = $('#l-email').value;
      mostrarLogin('recuperar');
    });
    $('[data-voltar-login]').addEventListener('click', () => mostrarLogin('login'));
    $('[data-form-recuperar]').addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = e.currentTarget.email.value.trim();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { loginMsg('Digite um e-mail válido.'); return; }
      try {
        await A.auth.recuperarSenha(email);
        mostrarLogin('login', 'Se esse e-mail for da administração, o link para criar a nova senha chega em instantes. Confira também o spam.', 'ok');
      } catch (err) { loginMsg(A.traduzir(err).message); }
    });
    $('[data-form-nova-senha]').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.currentTarget;
      if (f.senha.value !== f.senha2.value) { loginMsg('As duas senhas não são iguais.'); return; }
      try {
        await A.auth.novaSenha(f.senha.value);
        history.replaceState(null, '', location.pathname);
        if (await A.auth.ehAdmin()) { toast('Senha nova salva.', 'ok'); await entrarNoPainel(); }
        else { await A.auth.sair(); mostrarLogin('login', 'Senha salva, mas esta conta não tem acesso ao painel.'); }
      } catch (err) { loginMsg(A.traduzir(err).message); }
    });
  }

  /* ==================== Painel: entrada e navegação ==================== */
  async function entrarNoPainel() {
    const sessao = await A.auth.sessao();
    $('[data-tela-login]').hidden = true;
    $('[data-painel]').hidden = false;
    $('[data-usuario]').textContent = sessao && sessao.user ? 'Conectado como ' + sessao.user.email : '';
    $('[data-faixa-demo]').hidden = A.modo !== 'demo';
    try {
      await carregarBase();
    } catch (e) {
      falha(e);
      return;
    }
    if (!est.iniciado) {
      est.iniciado = true;
      ligarPainel();
      A.admin.assinar(agendarAtualizacao);
      setInterval(agendarAtualizacao, 60000);
    }
    atualizarAlertasBotao();
    await atualizarPendentes();
    navegar((location.hash || '#agenda').slice(1));
  }

  async function carregarBase() {
    const ctx = await A.admin.contexto(hoje(), hoje());
    est.base = {
      config: ctx.config, funcionamento: ctx.funcionamento, datasEspeciais: ctx.datasEspeciais,
      quadras: ctx.quadras.slice().sort((a, b) => (a.ordem || 0) - (b.ordem || 0) || String(a.nome).localeCompare(String(b.nome))),
      fixos: ctx.fixos, bloqueios: ctx.bloqueios
    };
  }
  const ctxCom = (reservas) => Object.assign({}, est.base, { reservas: reservas || [] });

  function ligarPainel() {
    window.addEventListener('hashchange', () => navegar(location.hash.slice(1)));
    $$('.menu-item[data-ir], [data-badge-topo]').forEach((a) => a.addEventListener('click', () => fecharMenu()));
    $('[data-abrir-menu]').addEventListener('click', () => abrirMenu(!$('[data-menu-painel]').classList.contains('is-open')));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('[data-menu-painel]').classList.contains('is-open')) abrirMenu(false); });
    $('[data-sair]').addEventListener('click', async () => {
      await A.auth.sair();
      location.replace(location.pathname);
    });
    $('[data-resetar-demo]').addEventListener('click', async () => {
      const r = await confirmar({ titulo: 'Restaurar o exemplo?', html: '<p>Apaga tudo o que foi feito neste navegador e volta para os dados de exemplo.</p>', botao: 'Restaurar', perigo: true });
      if (!r.ok) return;
      A.auth.resetarDemo();
      location.reload();
    });
    $('[data-alertas]').addEventListener('click', alternarAlertas);
    $('[data-fechar-modal]').addEventListener('click', fecharModal);
    $('[data-modal]').addEventListener('click', (e) => { if (e.target === e.currentTarget) fecharModal(); });
    $('[data-nova-reserva]').addEventListener('click', () => abrirFormReserva(null, { data: est.data < hoje() ? hoje() : est.data }));
    $('[data-novo-fixo]').addEventListener('click', () => abrirFormFixo(null));
    $('[data-nova-quadra]').addEventListener('click', () => abrirFormQuadra(null));
    // Ações das listas e da janela (delegação)
    document.addEventListener('click', aoClicar);
  }

  function abrirMenu(sim) {
    const menu = $('[data-menu-painel]');
    menu.classList.toggle('is-open', sim);
    $('[data-abrir-menu]').setAttribute('aria-expanded', String(sim));
    let veu = $('.painel__veu');
    if (sim && !veu) {
      veu = document.createElement('div');
      veu.className = 'painel__veu';
      veu.addEventListener('click', () => abrirMenu(false));
      document.body.appendChild(veu);
    }
    if (!sim && veu) veu.remove();
    if (sim) { const a = $('.menu-item', menu); if (a) a.focus(); }
  }
  function fecharMenu() { if ($('[data-menu-painel]').classList.contains('is-open')) abrirMenu(false); }

  function navegar(secao) {
    if (!TITULOS[secao]) secao = 'agenda';
    est.secao = secao;
    $$('[data-secao]').forEach((s) => { s.hidden = s.getAttribute('data-secao') !== secao; });
    $$('.menu-item[data-ir]').forEach((a) => {
      const sim = a.getAttribute('data-ir') === secao;
      a.classList.toggle('is-ativo', sim);
      if (sim) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    $('[data-titulo-topo]').textContent = TITULOS[secao];
    if (location.hash !== '#' + secao) history.replaceState(null, '', '#' + secao);
    document.title = (est.pendentes ? '(' + est.pendentes + ') ' : '') + TITULOS[secao] + ' | Painel Arena Esporte';
    renderSecao(secao);
  }
  function renderSecao(secao) {
    const fn = { agenda: renderAgenda, pedidos: renderPedidos, fixos: renderFixos, feriados: renderFeriados, quadras: renderQuadras, regras: renderRegras, clientes: renderClientes, contatos: renderContatos }[secao];
    return Promise.resolve(fn()).catch(falha);
  }
  function corpo(secao) { return $('[data-secao="' + secao + '"] [data-corpo]'); }

  /* ==================== Novos pedidos: contador, alertas e tempo real ==================== */
  function agendarAtualizacao() {
    clearTimeout(est.timer);
    est.timer = setTimeout(async () => {
      if ($('[data-painel]').hidden) return;
      await atualizarPendentes();
      if (est.secao === 'agenda' || est.secao === 'pedidos') renderSecao(est.secao);
    }, 700);
  }
  async function atualizarPendentes() {
    let lista;
    try { lista = await A.admin.reservas.pendentes(); } catch (e) { return; }
    const n = lista.filter(futura).length;
    const antes = est.pendentes;
    est.pendentes = n;
    $$('[data-badge-pendentes], [data-badge-topo]').forEach((b) => { b.textContent = String(n); b.hidden = n === 0; });
    document.title = (n ? '(' + n + ') ' : '') + TITULOS[est.secao] + ' | Painel Arena Esporte';
    if (antes !== null && n > antes) {
      toast('Chegou pedido novo de reserva.', 'ok');
      if (alertasLigados()) {
        bip();
        if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
          try { new Notification('Arena Esporte', { body: 'Chegou pedido novo de reserva.', icon: 'img/favicon-192.png' }); } catch (e) { /* sem notificação */ }
        }
      }
    }
  }
  function alertasLigados() { try { return localStorage.getItem(CHAVE_ALERTAS) === '1'; } catch (e) { return false; } }
  function atualizarAlertasBotao() { $('[data-alertas-texto]').textContent = alertasLigados() ? 'Alertas ligados' : 'Ligar alertas'; }
  async function alternarAlertas() {
    const ligar = !alertasLigados();
    if (ligar && 'Notification' in window && Notification.permission === 'default') {
      try { await Notification.requestPermission(); } catch (e) { /* sem notificação */ }
    }
    try { localStorage.setItem(CHAVE_ALERTAS, ligar ? '1' : '0'); } catch (e) { /* sem armazenamento */ }
    atualizarAlertasBotao();
    if (ligar) bip();
    toast(ligar ? 'Alertas ligados: o painel apita quando chega pedido.' : 'Alertas desligados.', 'ok');
  }
  function bip() {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      const ac = new Ctx();
      [0, .18].forEach((t) => {
        const o = ac.createOscillator();
        const g = ac.createGain();
        o.frequency.value = 880;
        g.gain.setValueAtTime(.0001, ac.currentTime + t);
        g.gain.exponentialRampToValueAtTime(.25, ac.currentTime + t + .02);
        g.gain.exponentialRampToValueAtTime(.0001, ac.currentTime + t + .15);
        o.connect(g).connect(ac.destination);
        o.start(ac.currentTime + t);
        o.stop(ac.currentTime + t + .16);
      });
    } catch (e) { /* sem som */ }
  }

  /* ==================== Ações (delegação de cliques) ==================== */
  async function aoClicar(e) {
    const alvo = e.target.closest('[data-acao]');
    if (!alvo) return;
    const acao = alvo.getAttribute('data-acao');
    const id = alvo.getAttribute('data-id');
    const r = id ? est.cache.get(id) : null;
    switch (acao) {
      case 'avisou':
        delete est.avisar[id];
        setTimeout(() => { alvo.closest('.aviso-whats') && alvo.closest('.aviso-whats').remove(); }, 300);
        return;
      case 'abrir': if (r) abrirReserva(r); return;
      case 'confirmar': if (r) await confirmarReserva(r, alvo); return;
      case 'cancelar': if (r) await cancelarReserva(r); return;
      case 'jogou': if (r) await mudarStatus(r, 'concluida', null, 'Marcado como jogo realizado.'); return;
      case 'faltou': if (r) await marcarFalta(r); return;
      case 'reativar': if (r) await mudarStatus(r, 'confirmada', { motivo_cancelamento: '', cancelado_por: null, cancelado_em: null }, 'Reserva reativada.'); return;
      case 'pago': if (r) await mudarStatus(r, r.status, { pago: !r.pago }, r.pago ? 'Marcado como não pago.' : 'Marcado como pago.'); return;
      case 'remarcar': case 'editar': if (r) abrirFormReserva(r); return;
      case 'livre': abrirFormReserva(null, { data: est.data, hora: alvo.getAttribute('data-hora'), quadra_id: alvo.getAttribute('data-quadra') }); return;
      case 'fixo': { const f = est.base.fixos.find((x) => x.id === id); if (f) abrirFormFixo(f); return; }
      case 'bloqueio': location.hash = '#feriados'; return;
      default:
    }
  }

  async function mudarStatus(r, status, extra, mensagem) {
    try {
      const novo = await A.admin.reservas.status(r, status, extra);
      est.cache.set(novo.id, novo);
      toast(mensagem || 'Reserva atualizada.', 'ok');
      depoisDeMudar(novo);
      return novo;
    } catch (e) {
      falha(e);
      return null;
    }
  }
  function depoisDeMudar(r) {
    atualizarPendentes();
    renderSecao(est.secao);
    if ($('[data-modal]').open && r && $('[data-modal-corpo] [data-reserva-id="' + r.id + '"]')) abrirReserva(r);
  }
  async function confirmarReserva(r, botao) {
    ocupado(botao, true, 'Confirmando...');
    const novo = await mudarStatus(r, 'confirmada', null, 'Reserva confirmada. Agora avise o cliente.');
    ocupado(botao, false);
    if (novo && novo.cliente_whatsapp) {
      est.avisar[novo.id] = { titulo: 'Confirmada. Mande a confirmação para ' + primeiroNome(novo.cliente_nome) + '.', msg: msgConfirmacao(novo) };
      depoisDeMudar(novo);
    }
  }
  async function cancelarReserva(r) {
    const q = quandoCurto(r);
    const resp = await confirmar({
      titulo: 'Cancelar a reserva?', html: '<p>' + esc(r.cliente_nome) + ' · ' + esc(q.dia) + ', ' + esc(q.horas) + ' · ' + esc(nomeQuadra(r.quadra_id)) + '. O horário volta para a agenda.</p>',
      campo: 'texto', rotulo: 'Motivo (vai na mensagem para o cliente)', botao: 'Cancelar reserva', voltar: 'Manter', perigo: true
    });
    if (!resp.ok) return;
    const novo = await mudarStatus(r, 'cancelada', { motivo_cancelamento: resp.valor || 'Cancelada pela arena', cancelado_por: 'arena' }, 'Reserva cancelada.');
    if (novo && novo.cliente_whatsapp) {
      est.avisar[novo.id] = { titulo: 'Cancelada. Avise ' + primeiroNome(novo.cliente_nome) + ' pelo WhatsApp.', msg: msgCancelamento(novo, resp.valor) };
      depoisDeMudar(novo);
    }
  }
  async function marcarFalta(r) {
    const limite = cfg().faltas_bloqueio;
    const resp = await confirmar({
      titulo: 'Marcar falta?', html: '<p>' + esc(r.cliente_nome) + ' não apareceu nesse horário.' + (limite > 0 ? ' Com ' + limite + ' faltas em 6 meses, a reserva pelo site fica suspensa para esse WhatsApp.' : '') + '</p>',
      botao: 'Marcar falta', perigo: true
    });
    if (resp.ok) await mudarStatus(r, 'falta', null, 'Falta registrada.');
  }

  /* ==================== Janela da reserva ==================== */
  function abrirReserva(r) {
    est.cache.set(r.id, r);
    const q = quandoCurto(r);
    const st = R.STATUS[r.status] || { texto: r.status };
    const dados = [
      ['Código', r.codigo],
      ['Status', '<span class="selo selo--' + esc(r.status) + '">' + esc(st.texto) + '</span>', true],
      ['Cliente', esc(r.cliente_nome) + (r.cliente_whatsapp ? '<br><a href="' + esc(linkWhats(r.cliente_whatsapp, 'Olá, ' + primeiroNome(r.cliente_nome) + '! Aqui é da Arena Esporte.')) + '" target="_blank" rel="noopener noreferrer">' + esc(R.formatarWhatsapp(r.cliente_whatsapp)) + '</a>' : ''), true],
      ['Quando', R.dataLonga(q.data) + ', ' + q.horas],
      ['Quadra', nomeQuadra(r.quadra_id)],
      r.modalidade ? ['Modalidade', r.modalidade] : null,
      r.jogadores ? ['Pessoas', String(r.jogadores)] : null,
      r.observacoes ? ['Recado', r.observacoes] : null,
      ['Valor', (r.valor != null ? U.preco(r.valor) : 'Combinado na arena') + (r.pago ? ' · pago' : '')],
      ['Origem', r.origem === 'painel' ? 'Lançada no painel' : 'Pedido pelo site'],
      ['Pedido feito', dataHora(r.criado_em)],
      r.confirmado_em ? ['Confirmada em', dataHora(r.confirmado_em)] : null,
      r.status === 'cancelada' ? ['Cancelamento', (r.cancelado_por === 'cliente' ? 'Pelo cliente' : 'Pela arena') + (r.motivo_cancelamento ? ': ' + r.motivo_cancelamento : '') + (r.cancelado_em ? ' (' + dataHora(r.cancelado_em) + ')' : '')] : null
    ].filter(Boolean);

    const b = (acao, texto, classe, icone) => '<button class="btn ' + (classe || 'btn--ghost') + '" type="button" data-acao="' + acao + '" data-id="' + esc(r.id) + '">' + (icone ? ICONE(icone) + ' ' : '') + esc(texto) + '</button>';
    let acoes = '';
    if (ativa(r) && !comecou(r)) {
      if (r.status === 'pendente') acoes += b('confirmar', 'Confirmar reserva', 'btn--primary', 'i-check');
      if (r.status === 'confirmada' && r.cliente_whatsapp) acoes += '<a class="btn btn--whatsapp" href="' + esc(linkWhats(r.cliente_whatsapp, msgLembrete(r))) + '" target="_blank" rel="noopener noreferrer">' + ICONE('i-whats') + ' Mandar lembrete</a>';
      acoes += b('remarcar', 'Remarcar ou editar', 'btn--escuro', 'i-editar');
      acoes += b('pago', r.pago ? 'Marcar como não pago' : 'Marcar como pago', 'btn--ghost');
      acoes += b('cancelar', 'Cancelar reserva', 'btn--ghost', 'i-x');
    } else if (ativa(r)) {
      acoes += b('jogou', 'Jogou', 'btn--primary', 'i-check');
      acoes += b('faltou', 'Faltou', 'btn--ghost', 'i-x');
      acoes += b('pago', r.pago ? 'Marcar como não pago' : 'Marcar como pago', 'btn--ghost');
      if (futura(r)) acoes += b('remarcar', 'Editar', 'btn--ghost', 'i-editar');
    } else if (r.status === 'concluida') {
      acoes += b('faltou', 'Corrigir: foi falta', 'btn--ghost');
      acoes += b('pago', r.pago ? 'Marcar como não pago' : 'Marcar como pago', 'btn--ghost');
    } else if (r.status === 'falta') {
      acoes += b('jogou', 'Corrigir: jogou', 'btn--ghost');
    } else if (r.status === 'cancelada' && !comecou(r)) {
      acoes += b('reativar', 'Reativar reserva', 'btn--ghost');
    }
    abrirModal('Reserva ' + r.codigo,
      '<div data-reserva-id="' + esc(r.id) + '">' + botaoAvisar(r) +
      '<dl class="detalhes">' + dados.map((d) => '<div><dt>' + esc(d[0]) + '</dt><dd>' + (d[2] ? d[1] : esc(d[1])) + '</dd></div>').join('') + '</dl>' +
      '<div class="acoes-modal">' + acoes + '</div></div>');
  }

  /* ==================== Formulário: nova reserva / remarcar ==================== */
  async function abrirFormReserva(r, preset) {
    const c = cfg();
    const p = preset || {};
    const atual = r ? quandoCurto(r) : null;
    const blocosAtuais = r ? Math.max(1, Math.round((new Date(r.fim) - new Date(r.inicio)) / 60000 / c.bloco_min)) : 1;
    const f = {
      data: atual ? atual.data : (p.data || hoje()),
      hora: atual ? R.minParaHhmm(atual.ini) : (p.hora || ''),
      blocos: blocosAtuais,
      quadra_id: r ? r.quadra_id : (p.quadra_id || '')
    };
    const maxBlocos = Math.max(c.max_blocos, 4);
    let opcoesDuracao = '';
    for (let n = 1; n <= maxBlocos; n++) opcoesDuracao += '<option value="' + n + '"' + (n === f.blocos ? ' selected' : '') + '>' + duracaoTexto(n * c.bloco_min) + '</option>';
    const modalidades = c.modalidades.concat(['Outra']);
    const html =
      '<form class="form-grid" data-form-reserva novalidate>' +
        (r ? '<p class="dica">Código ' + esc(r.codigo) + '. Mudou o dia, a hora ou a quadra? O cliente recebe a mensagem de remarcação.</p>' : '') +
        '<div class="form-grid form-grid--3">' +
          '<div class="campo"><label for="fr-data">Dia</label><input id="fr-data" name="data" type="date" min="' + hoje() + '" value="' + esc(f.data) + '" required></div>' +
          '<div class="campo"><label for="fr-blocos">Duração</label><select id="fr-blocos" name="blocos">' + opcoesDuracao + '</select></div>' +
          '<div class="campo"><label for="fr-hora">Horário</label><select id="fr-hora" name="hora" required></select></div>' +
        '</div>' +
        '<div class="campo"><label for="fr-quadra">Quadra</label><select id="fr-quadra" name="quadra_id" required></select></div>' +
        '<p class="dica" data-fr-dia></p>' +
        '<div class="form-grid form-grid--2">' +
          '<div class="campo"><label for="fr-nome">Nome do cliente</label><input id="fr-nome" name="nome" type="text" maxlength="80" value="' + esc(r ? r.cliente_nome : '') + '" required></div>' +
          '<div class="campo"><label for="fr-whats">WhatsApp <small>(opcional no balcão)</small></label><input id="fr-whats" name="whatsapp" type="tel" inputmode="tel" value="' + esc(r && r.cliente_whatsapp ? R.formatarWhatsapp(r.cliente_whatsapp) : '') + '"></div>' +
        '</div>' +
        '<div class="form-grid form-grid--3">' +
          '<div class="campo"><label for="fr-mod">Modalidade</label><select id="fr-mod" name="modalidade">' + modalidades.map((m) => '<option' + (r && r.modalidade === m ? ' selected' : '') + '>' + esc(m) + '</option>').join('') + '</select></div>' +
          '<div class="campo"><label for="fr-jog">Pessoas</label><input id="fr-jog" name="jogadores" type="number" min="1" max="40" value="' + esc(r && r.jogadores ? r.jogadores : '') + '"></div>' +
          '<div class="campo"><label for="fr-valor">Valor (R$)</label><input id="fr-valor" name="valor" type="number" min="0" step="0.01" value="' + esc(r && r.valor != null ? r.valor : '') + '" placeholder="Combinado"></div>' +
        '</div>' +
        '<div class="campo"><label for="fr-obs">Observações</label><textarea id="fr-obs" name="observacoes" maxlength="300">' + esc(r ? r.observacoes || '' : '') + '</textarea></div>' +
        '<div class="form-grid form-grid--2">' +
          (r ? '' : '<div class="campo"><label for="fr-status">Situação</label><select id="fr-status" name="status"><option value="confirmada">Confirmada</option><option value="pendente">Pendente</option></select></div>') +
          '<label class="campo--check"><input type="checkbox" name="pago"' + (r && r.pago ? ' checked' : '') + '> Já está pago</label>' +
        '</div>' +
        '<div data-fr-erro aria-live="assertive"></div>' +
        '<div class="acoes-modal"><button class="btn btn--primary btn--lg" type="submit">' + ICONE('i-check') + (r ? ' Salvar mudanças' : ' Lançar reserva') + '</button></div>' +
      '</form>';
    const caixa = abrirModal(r ? 'Remarcar ou editar' : 'Nova reserva', html);
    const form = $('[data-form-reserva]', caixa);
    let reservasDia = [];
    let disp = null;
    let valorAuto = !(r && r.valor != null);

    async function recarregar() {
      const data = form.data.value;
      if (!R.dataValida(data)) return;
      try { reservasDia = await A.admin.reservas.listar(data, data); } catch (e) { falha(e); return; }
      montarOpcoes();
    }
    function montarOpcoes() {
      const data = form.data.value;
      const blocos = Number(form.blocos.value);
      const ctx = ctxCom(reservasDia.filter((x) => !r || x.id !== r.id));
      disp = R.disponibilidade(data, ctx, { blocos, admin: true });
      const info = $('[data-fr-dia]', form);
      if (!disp.dia.aberto) {
        form.hora.innerHTML = '<option value="">Arena fechada nesse dia</option>';
        form.quadra_id.innerHTML = '<option value="">Sem quadra</option>';
        info.textContent = 'Fechado: ' + (disp.dia.motivo || '') + '. Para abrir, mude em Feriados e bloqueios ou em Horário e regras.';
        return;
      }
      info.textContent = disp.dia.especial ? 'Horário especial nesse dia: ' + (disp.dia.motivo || '') + '.' : '';
      const escolhida = form.hora.value || f.hora;
      const slots = disp.slots.filter((s) => s.estado !== 'passado');
      form.hora.innerHTML = slots.length ? slots.map((s) => '<option value="' + s.hora + '"' + (s.hora === escolhida ? ' selected' : '') + (s.livres ? '' : ' disabled') + '>' +
        s.hora + ' às ' + s.horaFim + (s.livres ? ' · ' + s.livres + (s.livres === 1 ? ' quadra livre' : ' quadras livres') : ' · lotado') + '</option>').join('')
        : '<option value="">Sem horários nesse dia</option>';
      if (form.hora.selectedOptions[0] && form.hora.selectedOptions[0].disabled) {
        const primeiro = Array.from(form.hora.options).find((o) => !o.disabled);
        if (primeiro) form.hora.value = primeiro.value;
      }
      montarQuadras();
    }
    function montarQuadras() {
      const slot = disp && disp.slots.find((s) => s.hora === form.hora.value);
      const escolhida = form.quadra_id.value || f.quadra_id;
      const quadras = est.base.quadras.filter((q) => q.ativa !== false);
      form.quadra_id.innerHTML = quadras.map((q) => {
        const sq = slot && slot.quadras.find((x) => x.id === q.id);
        const livre = sq && sq.livre;
        const motivo = sq && !sq.livre ? { reserva: 'reservada', fixo: 'turma fixa', bloqueio: 'bloqueada' }[sq.motivo] : '';
        return '<option value="' + esc(q.id) + '"' + (q.id === escolhida ? ' selected' : '') + (livre ? '' : ' disabled') + '>' + esc(q.nome) +
          (q.reserva_online === false ? ' (só no balcão)' : '') + (motivo ? ' · ' + motivo : '') + '</option>';
      }).join('');
      if (form.quadra_id.selectedOptions[0] && form.quadra_id.selectedOptions[0].disabled) {
        const primeira = Array.from(form.quadra_id.options).find((o) => !o.disabled);
        if (primeira) form.quadra_id.value = primeira.value;
      }
      if (valorAuto && slot) form.valor.value = slot.valor != null ? slot.valor : '';
    }
    form.data.addEventListener('change', recarregar);
    form.blocos.addEventListener('change', montarOpcoes);
    form.hora.addEventListener('change', montarQuadras);
    form.valor.addEventListener('input', () => { valorAuto = false; });
    form.whatsapp.addEventListener('input', () => {
      const d = form.whatsapp.value.replace(/\D/g, '').slice(0, 13);
      if (d.length <= 11) form.whatsapp.value = d.length > 7 ? '(' + d.slice(0, 2) + ') ' + d.slice(2, d.length === 11 ? 7 : 6) + '-' + d.slice(d.length === 11 ? 7 : 6) : d.length > 2 ? '(' + d.slice(0, 2) + ') ' + d.slice(2) : d;
    });
    await recarregar();

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const erro = $('[data-fr-erro]', form);
      erro.innerHTML = '';
      const mostrarErro = (m) => { erro.innerHTML = '<div class="alerta alerta--erro" role="alert">' + ICONE('i-alerta') + '<p>' + esc(m) + '</p></div>'; };
      const nome = R.limparNome(form.nome.value);
      if (nome.length < 2) { mostrarErro('Escreva o nome do cliente.'); form.nome.focus(); return; }
      const whats = form.whatsapp.value.trim();
      if (whats && !R.whatsappValido(whats)) { mostrarErro(R.mensagem('WHATSAPP_INVALIDO')); form.whatsapp.focus(); return; }
      if (!form.hora.value || !form.quadra_id.value) { mostrarErro('Escolha um horário e uma quadra livres.'); return; }
      const blocos = Number(form.blocos.value);
      const v = R.validarReserva({ id: r ? r.id : undefined, quadra_id: form.quadra_id.value, data: form.data.value, hora: form.hora.value, blocos, nome, whatsapp: whats },
        ctxCom(reservasDia), { admin: true, semCliente: true });
      if (!v.ok) { mostrarErro(v.erro.mensagem); return; }
      const botao = $('button[type="submit"]', form);
      ocupado(botao, true);
      try {
        const salvo = await A.admin.reservas.salvar({
          id: r ? r.id : undefined, quadra_id: form.quadra_id.value, inicio: v.inicio, fim: v.fim,
          cliente_nome: nome, cliente_whatsapp: whats, modalidade: form.modalidade.value,
          jogadores: form.jogadores.value, valor: form.valor.value, pago: form.pago.checked, observacoes: form.observacoes.value.trim(),
          status: r ? r.status : form.status.value
        });
        est.cache.set(salvo.id, salvo);
        const mudou = r && (r.inicio !== salvo.inicio || r.fim !== salvo.fim || r.quadra_id !== salvo.quadra_id);
        if (mudou && salvo.cliente_whatsapp) est.avisar[salvo.id] = { titulo: 'Remarcada. Avise ' + primeiroNome(salvo.cliente_nome) + '.', msg: msgRemarcacao(salvo) };
        if (!r && salvo.cliente_whatsapp && salvo.status === 'confirmada') est.avisar[salvo.id] = { titulo: 'Lançada. Mande a confirmação para ' + primeiroNome(salvo.cliente_nome) + '.', msg: msgConfirmacao(salvo) };
        toast(r ? 'Reserva atualizada.' : 'Reserva lançada.', 'ok');
        est.data = R.isoParaLocal(salvo.inicio).data;
        atualizarPendentes();
        renderSecao(est.secao);
        abrirReserva(salvo);
      } catch (err) {
        mostrarErro(A.traduzir(err).message);
        recarregar();
      } finally {
        ocupado(botao, false);
      }
    });
  }

  /* ==================== 1. Agenda (horas × quadras) ==================== */
  async function renderAgenda() {
    const el = corpo('agenda');
    const data = est.data;
    el.innerHTML =
      '<div class="toolbar">' +
        '<div class="toolbar__data">' +
          '<button class="icone-btn" type="button" data-dia="-1" aria-label="Dia anterior">' + ICONE('i-anterior') + '</button>' +
          '<input type="date" value="' + data + '" aria-label="Escolher o dia" data-escolher-dia>' +
          '<button class="icone-btn" type="button" data-dia="1" aria-label="Próximo dia">' + ICONE('i-proximo') + '</button>' +
        '</div>' +
        (data !== hoje() ? '<button class="btn btn--ghost btn--sm" type="button" data-dia="hoje">Hoje</button>' : '') +
        '<p class="toolbar__titulo">' + esc(R.dataLonga(data)) + (data === hoje() ? ' · hoje' : '') + '</p>' +
      '</div>' +
      '<div data-agenda-area><div class="esqueleto esqueleto--dias"></div></div>';
    $$('[data-dia]', el).forEach((b) => b.addEventListener('click', () => {
      const v = b.getAttribute('data-dia');
      est.data = v === 'hoje' ? hoje() : R.somarDias(est.data, Number(v));
      renderAgenda();
    }));
    $('[data-escolher-dia]', el).addEventListener('change', (e) => { if (R.dataValida(e.target.value)) { est.data = e.target.value; renderAgenda(); } });

    const reservas = await A.admin.reservas.listar(data, data);
    if (data !== est.data) return;
    reservas.forEach((x) => est.cache.set(x.id, x));
    const ctx = ctxCom(reservas);
    const c = R.cfg(ctx);
    const dia = R.horarioDoDia(data, ctx);
    const ocup = R.ocupacoesDoDia(data, ctx);
    const quadras = est.base.quadras;
    const agora = Date.now();

    let inicios = dia.aberto ? R.gradeDoDia(data, ctx, 1) : [];
    reservas.filter(ativa).forEach((x) => {
      const l = R.isoParaLocal(x.inicio);
      if (l.data === data && !inicios.includes(l.min)) inicios.push(l.min);
    });
    inicios = inicios.sort((a, b) => a - b);

    const doDia = reservas.filter((x) => R.isoParaLocal(x.inicio).data === data);
    const pend = doDia.filter((x) => x.status === 'pendente').length;
    const conf = doDia.filter((x) => x.status === 'confirmada').length;
    let livres = 0;
    let html = '';
    if (est.pendentes) html += '<div class="faixa faixa--pendentes"><p><b>' + est.pendentes + (est.pendentes === 1 ? ' pedido esperando' : ' pedidos esperando') + ' confirmação.</b> O cliente fica aguardando o seu WhatsApp.</p><a class="btn btn--escuro btn--sm" href="#pedidos">Ver pedidos</a></div>';
    if (!dia.aberto) html += '<div class="faixa faixa--fechado"><p><b>Arena fechada nesse dia.</b> ' + esc(dia.motivo || '') + '</p><a class="btn btn--ghost btn--sm" href="#feriados">Feriados e bloqueios</a></div>';
    else if (dia.especial) html += '<div class="faixa faixa--especial"><p><b>Horário especial:</b> ' + esc(dia.motivo || '') + ' (' + R.horaTexto(dia.abre) + ' às ' + R.horaTexto(dia.fecha) + ').</p></div>';

    let grade = '<div class="grade-rolagem"><div class="grade" role="table" aria-label="Agenda de ' + esc(R.dataLonga(data)) + '" data-grade>' +
      '<div class="grade__cab" role="columnheader">Hora</div>' +
      quadras.map((q) => '<div class="grade__cab' + (q.ativa === false ? ' grade__cab--off' : '') + '" role="columnheader">' + esc(q.nome) +
        (q.ativa === false ? '<small>Fora de uso</small>' : q.reserva_online === false ? '<small>Só no balcão</small>' : '<small>Site e balcão</small>') + '</div>').join('');
    inicios.forEach((ini) => {
      const iniMs = R.msLocal(data, ini);
      const fimMs = R.msLocal(data, ini + c.bloco_min);
      const passada = fimMs <= agora;
      grade += '<div class="grade__hora' + (passada ? ' grade__hora--passada' : '') + '" role="rowheader">' + R.minParaHhmm(ini) + '</div>';
      quadras.forEach((q) => {
        const o = ocup.find((x) => (!x.quadra_id || x.quadra_id === q.id) && new Date(x.inicio).getTime() < fimMs && iniMs < new Date(x.fim).getTime());
        if (o) {
          const cont = new Date(o.inicio).getTime() < iniMs;
          if (o.tipo === 'reserva') {
            const x = o.ref;
            const q2 = quandoCurto(x);
            grade += '<div class="cel" role="cell"><button class="ocup ocup--' + esc(x.status) + (cont ? ' ocup--cont' : '') + '" type="button" data-acao="abrir" data-id="' + esc(x.id) + '">' +
              '<b>' + (cont ? '↳ ' : '') + esc(x.cliente_nome) + '</b><span>' + esc(cont ? 'continuação' : (R.STATUS[x.status] || {}).curto + ' · ' + q2.horas) + '</span></button></div>';
          } else if (o.tipo === 'fixo') {
            grade += '<div class="cel" role="cell"><button class="ocup ocup--fixo' + (cont ? ' ocup--cont' : '') + '" type="button" data-acao="fixo" data-id="' + esc(o.ref.id) + '">' +
              '<b>' + (cont ? '↳ ' : '') + esc(o.ref.cliente_nome) + '</b><span>Horário fixo</span></button></div>';
          } else {
            grade += '<div class="cel" role="cell"><button class="ocup ocup--bloqueio" type="button" data-acao="bloqueio" data-id="' + esc(o.ref.id || '') + '">' +
              '<b>Bloqueada</b><span>' + esc(o.ref.motivo || 'Sem motivo') + '</span></button></div>';
          }
        } else if (q.ativa === false) {
          grade += '<div class="cel cel--off" role="cell"></div>';
        } else if (passada || !dia.aberto) {
          grade += '<div class="cel cel--passada" role="cell"></div>';
        } else {
          livres++;
          grade += '<div class="cel" role="cell"><button class="livre-btn" type="button" data-acao="livre" data-hora="' + R.minParaHhmm(ini) + '" data-quadra="' + esc(q.id) + '" aria-label="Lançar reserva às ' + R.minParaHhmm(ini) + ' na ' + esc(q.nome) + '">' + ICONE('i-mais') + ' Livre</button></div>';
        }
      });
    });
    grade += '</div></div>';
    html += '<div class="numeros"><span class="numero numero--pendente"><b>' + pend + '</b> pendente' + (pend === 1 ? '' : 's') + '</span>' +
      '<span class="numero numero--confirmada"><b>' + conf + '</b> confirmada' + (conf === 1 ? '' : 's') + '</span>' +
      '<span class="numero"><b>' + livres + '</b> horário' + (livres === 1 ? ' livre' : 's livres') + ' a partir de agora</span></div>';
    html += inicios.length ? grade : '<p class="vazio">Nenhum horário nesse dia.</p>';
    const area = $('[data-agenda-area]', el);
    area.innerHTML = html;
    const g = $('[data-grade]', area);
    if (g) g.style.setProperty('--cols', String(quadras.length));
  }

  /* ==================== 2. Pedidos ==================== */
  async function renderPedidos() {
    const el = corpo('pedidos');
    const abas = [['pendentes', 'Pendentes'], ['proximas', 'Próximas'], ['passadas', 'Já passaram'], ['canceladas', 'Canceladas']];
    el.innerHTML =
      '<div class="abas-adm" role="tablist" aria-label="Filtrar reservas">' +
        abas.map((a) => '<button class="aba-adm" type="button" role="tab" aria-selected="' + (est.aba === a[0]) + '" data-aba="' + a[0] + '">' + a[1] +
          (a[0] === 'pendentes' && est.pendentes ? '<span class="badge">' + est.pendentes + '</span>' : '') + '</button>').join('') +
        '<div class="busca-adm"><input type="search" placeholder="Buscar nome, WhatsApp ou código" aria-label="Buscar reserva" value="' + esc(est.busca) + '" data-busca></div>' +
      '</div><div class="pedidos" data-lista-pedidos><div class="esqueleto esqueleto--dias"></div></div>';
    $$('[data-aba]', el).forEach((b) => b.addEventListener('click', () => { est.aba = b.getAttribute('data-aba'); renderPedidos(); }));
    const busca = $('[data-busca]', el);
    busca.addEventListener('input', () => { est.busca = busca.value; desenhar(); });

    const h = hoje();
    let lista = [];
    if (est.aba === 'pendentes') lista = await A.admin.reservas.pendentes();
    else if (est.aba === 'proximas') lista = (await A.admin.reservas.listar(h, R.somarDias(h, 120))).filter((x) => ativa(x) && futura(x));
    else if (est.aba === 'passadas') lista = (await A.admin.reservas.listar(R.somarDias(h, -45), h)).filter((x) => !futura(x) && x.status !== 'cancelada').reverse();
    else lista = (await A.admin.reservas.listar(R.somarDias(h, -45), R.somarDias(h, 120))).filter((x) => x.status === 'cancelada').reverse();
    // Quem acabou de ser confirmado/cancelado continua na tela até o ADM mandar o aviso no WhatsApp
    const aAvisar = Object.keys(est.avisar).map((id) => est.cache.get(id)).filter((x) => x && !lista.some((y) => y.id === x.id));
    lista = aAvisar.concat(lista);
    lista.forEach((x) => est.cache.set(x.id, x));

    function desenhar() {
      const termo = est.busca.trim().toLowerCase();
      const digitos = termo.replace(/\D/g, '');
      const filtrada = !termo ? lista : lista.filter((x) => String(x.cliente_nome).toLowerCase().includes(termo) ||
        String(x.codigo).toLowerCase().includes(termo) || (digitos.length >= 4 && String(x.cliente_whatsapp).includes(digitos)));
      const area = $('[data-lista-pedidos]', el);
      if (!filtrada.length) {
        area.innerHTML = '<p class="vazio">' + (termo ? 'Nada encontrado com essa busca.' : est.aba === 'pendentes' ? 'Nenhum pedido esperando confirmação.' : 'Nada por aqui.') + '</p>';
        return;
      }
      area.innerHTML = filtrada.map(cartaoPedido).join('');
    }
    desenhar();
  }

  function cartaoPedido(r) {
    const q = quandoCurto(r);
    const st = R.STATUS[r.status] || { curto: r.status };
    const atrasado = ativa(r) && comecou(r);
    const b = (acao, texto, classe, icone) => '<button class="btn btn--sm ' + (classe || 'btn--ghost') + '" type="button" data-acao="' + acao + '" data-id="' + esc(r.id) + '">' + (icone ? ICONE(icone) + ' ' : '') + esc(texto) + '</button>';
    let acoes = '';
    if (ativa(r) && !comecou(r)) {
      if (r.status === 'pendente') acoes += b('confirmar', 'Confirmar', 'btn--primary', 'i-check') + b('cancelar', 'Recusar', 'btn--ghost', 'i-x');
      else if (r.cliente_whatsapp) acoes += '<a class="btn btn--sm btn--ghost" href="' + esc(linkWhats(r.cliente_whatsapp, msgLembrete(r))) + '" target="_blank" rel="noopener noreferrer">' + ICONE('i-whats') + ' Lembrete</a>';
    } else if (ativa(r)) {
      acoes += b('jogou', 'Jogou', 'btn--primary', 'i-check') + b('faltou', 'Faltou', 'btn--ghost', 'i-x');
    }
    acoes += b('abrir', 'Detalhes', 'btn--texto');
    const meta = [nomeQuadra(r.quadra_id), r.modalidade, r.jogadores ? r.jogadores + ' pessoas' : '', r.valor != null ? U.preco(r.valor) + (r.pago ? ' pago' : '') : ''].filter(Boolean).join(' · ');
    return '<article class="pedido pedido--' + esc(r.status) + (atrasado ? ' pedido--atrasado' : '') + '">' +
      '<div class="pedido__quando"><b>' + esc(q.dia) + '</b><span>' + esc(q.horas) + '</span></div>' +
      '<div class="pedido__info">' + botaoAvisar(r) +
        '<span class="pedido__nome">' + esc(r.cliente_nome) + ' <span class="selo selo--' + esc(r.status) + '">' + esc(st.curto) + '</span>' +
        (atrasado ? ' <span class="etiqueta etiqueta--alerta">' + (r.status === 'pendente' ? 'Passou sem confirmar' : 'Marcar presença') + '</span>' : '') + '</span>' +
        '<span class="pedido__meta">' + esc(meta) + '</span>' +
        '<span class="pedido__meta">' + esc(r.codigo) + ' · ' + (r.cliente_whatsapp ? '<a href="' + esc(linkWhats(r.cliente_whatsapp, 'Olá, ' + primeiroNome(r.cliente_nome) + '! Aqui é da Arena Esporte.')) + '" target="_blank" rel="noopener noreferrer">' + esc(R.formatarWhatsapp(r.cliente_whatsapp)) + '</a> · ' : '') +
          (r.origem === 'painel' ? 'lançada no painel' : 'pedido pelo site ' + esc(haQuanto(r.criado_em))) + '</span>' +
        (r.observacoes ? '<span class="pedido__obs">' + esc(r.observacoes) + '</span>' : '') +
        (r.status === 'cancelada' && r.motivo_cancelamento ? '<span class="pedido__obs">' + esc((r.cancelado_por === 'cliente' ? 'Cliente: ' : 'Arena: ') + r.motivo_cancelamento) + '</span>' : '') +
      '</div>' +
      '<div class="pedido__acoes">' + acoes + '</div></article>';
  }

  /* ==================== 3. Horários fixos ==================== */
  function renderFixos() {
    const el = corpo('fixos');
    const fixos = est.base.fixos.slice().sort((a, b) => ORDEM_SEMANA.indexOf(Number(a.dia_semana)) - ORDEM_SEMANA.indexOf(Number(b.dia_semana)) || String(a.hora).localeCompare(String(b.hora)));
    if (!fixos.length) {
      el.innerHTML = '<p class="vazio">Nenhum horário fixo ainda. Turma que joga toda semana no mesmo horário? Cadastre aqui e o horário some da agenda do site.</p>';
      return;
    }
    let html = '';
    let diaAtual = null;
    fixos.forEach((f) => {
      if (Number(f.dia_semana) !== diaAtual) {
        if (diaAtual !== null) html += '</div>';
        diaAtual = Number(f.dia_semana);
        html += '<p class="dia-grupo">' + DIAS_PLURAL[diaAtual] + '</p><div class="linhas">';
      }
      const ini = R.hhmmParaMin(f.hora);
      const puladas = (f.datas_puladas || []).filter((d) => d >= hoje()).sort();
      const validade = 'Desde ' + R.dataCurta(f.valido_de) + (f.valido_ate ? ' até ' + R.dataCurta(f.valido_ate) : ', sem data para acabar');
      html += '<div class="linha' + (f.ativo === false ? ' linha--off' : '') + '">' +
        '<div class="linha__principal"><b>' + R.minParaHhmm(ini) + ' às ' + R.minParaHhmm(ini + Number(f.duracao_min)) + ' · ' + esc(nomeQuadra(f.quadra_id)) + (f.ativo === false ? ' · pausado' : '') + '</b>' +
          '<span>' + esc(f.cliente_nome) + (f.cliente_whatsapp ? ' · ' + esc(R.formatarWhatsapp(f.cliente_whatsapp)) : '') + (f.valor != null ? ' · ' + esc(U.preco(f.valor)) : '') + ' · ' + esc(validade) + '</span>' +
          (puladas.length ? '<div class="chips-mini">' + puladas.map((d) => '<button class="chip-mini" type="button" data-despular="' + esc(f.id) + '" data-data="' + d + '" aria-label="Voltar a valer em ' + R.dataCurta(d) + '">Sem jogo ' + R.dataCurta(d) + ' ×</button>').join('') + '</div>' : '') +
        '</div>' +
        '<div class="linha__acoes">' +
          '<button class="btn btn--sm btn--ghost" type="button" data-pular="' + esc(f.id) + '">Pular uma data</button>' +
          '<button class="btn btn--sm btn--ghost" type="button" data-pausar="' + esc(f.id) + '">' + (f.ativo === false ? 'Reativar' : 'Pausar') + '</button>' +
          '<button class="btn btn--sm btn--ghost" type="button" data-editar-fixo="' + esc(f.id) + '">' + ICONE('i-editar') + ' Editar</button>' +
          '<button class="btn btn--sm btn--texto" type="button" data-excluir-fixo="' + esc(f.id) + '" aria-label="Excluir horário fixo">' + ICONE('i-lixo') + '</button>' +
        '</div></div>';
    });
    html += '</div>';
    el.innerHTML = html;
    const acha = (id) => est.base.fixos.find((x) => x.id === id);
    $$('[data-editar-fixo]', el).forEach((b) => b.addEventListener('click', () => abrirFormFixo(acha(b.getAttribute('data-editar-fixo')))));
    $$('[data-pausar]', el).forEach((b) => b.addEventListener('click', async () => {
      const f = acha(b.getAttribute('data-pausar'));
      await salvarFixo(Object.assign({}, f, { ativo: f.ativo === false }), f.ativo === false ? 'Horário fixo reativado.' : 'Horário fixo pausado: o horário volta para o site.');
    }));
    $$('[data-pular]', el).forEach((b) => b.addEventListener('click', async () => {
      const f = acha(b.getAttribute('data-pular'));
      const proxima = proximaData(Number(f.dia_semana));
      const resp = await confirmar({ titulo: 'Pular uma data', html: '<p>Nesse dia o horário de ' + esc(f.cliente_nome) + ' fica livre para o site. Escolha ' + DIAS_TIT[f.dia_semana].toLowerCase() + '.</p>', campo: 'data', rotulo: 'Data sem jogo', valor: proxima, min: hoje(), botao: 'Liberar a data' });
      if (!resp.ok || !resp.valor) return;
      if (!R.dataValida(resp.valor) || R.diaDaSemana(resp.valor) !== Number(f.dia_semana)) { toast('Escolha uma data que caia numa ' + DIAS_TIT[f.dia_semana].toLowerCase() + '.', 'erro'); return; }
      const puladas = Array.from(new Set((f.datas_puladas || []).concat(resp.valor))).sort();
      await salvarFixo(Object.assign({}, f, { datas_puladas: puladas }), 'Data liberada: ' + R.dataCurta(resp.valor) + '.');
    }));
    $$('[data-despular]', el).forEach((b) => b.addEventListener('click', async () => {
      const f = acha(b.getAttribute('data-despular'));
      const d = b.getAttribute('data-data');
      await salvarFixo(Object.assign({}, f, { datas_puladas: (f.datas_puladas || []).filter((x) => x !== d) }), 'A turma volta a ter jogo em ' + R.dataCurta(d) + '.');
    }));
    $$('[data-excluir-fixo]', el).forEach((b) => b.addEventListener('click', async () => {
      const f = acha(b.getAttribute('data-excluir-fixo'));
      const resp = await confirmar({ titulo: 'Excluir horário fixo?', html: '<p>' + esc(f.cliente_nome) + ', ' + DIAS_PLURAL[f.dia_semana].toLowerCase() + ' às ' + esc(f.hora) + '. Para parar só por um tempo, use "Pausar".</p>', botao: 'Excluir', perigo: true });
      if (!resp.ok) return;
      try { await A.admin.fixos.excluir(f); await carregarBase(); toast('Horário fixo excluído.', 'ok'); renderFixos(); } catch (e) { falha(e); }
    }));
  }
  function proximaData(diaSemana) {
    let d = hoje();
    for (let i = 0; i < 7; i++) { if (R.diaDaSemana(d) === diaSemana) return d; d = R.somarDias(d, 1); }
    return hoje();
  }
  async function salvarFixo(f, mensagem) {
    try {
      await A.admin.fixos.salvar(limparFixo(f));
      await carregarBase();
      toast(mensagem, 'ok');
      if (est.secao === 'fixos') renderFixos(); else renderSecao(est.secao);
      return true;
    } catch (e) { falha(e); return false; }
  }
  function limparFixo(f) {
    return {
      id: f.id, quadra_id: f.quadra_id, dia_semana: Number(f.dia_semana), hora: f.hora, duracao_min: Number(f.duracao_min),
      cliente_nome: f.cliente_nome, cliente_whatsapp: f.cliente_whatsapp ? R.normalizarWhatsapp(f.cliente_whatsapp) : '',
      valor: f.valor === '' || f.valor == null ? null : Number(f.valor), observacoes: f.observacoes || '',
      valido_de: f.valido_de, valido_ate: f.valido_ate || null, datas_puladas: f.datas_puladas || [], ativo: f.ativo !== false
    };
  }

  function abrirFormFixo(f) {
    const c = cfg();
    const quadras = est.base.quadras.filter((q) => q.ativa !== false || (f && q.id === f.quadra_id));
    let duracoes = '';
    for (let n = 1; n <= 4; n++) duracoes += '<option value="' + n * c.bloco_min + '"' + (f ? (Number(f.duracao_min) === n * c.bloco_min ? ' selected' : '') : n === 1 ? ' selected' : '') + '>' + duracaoTexto(n * c.bloco_min) + '</option>';
    const html = '<form class="form-grid" data-form-fixo novalidate>' +
      '<div class="form-grid form-grid--3">' +
        '<div class="campo"><label for="ff-dia">Dia da semana</label><select id="ff-dia" name="dia_semana">' + ORDEM_SEMANA.map((d) => '<option value="' + d + '"' + (f && Number(f.dia_semana) === d ? ' selected' : '') + '>' + DIAS_TIT[d] + '</option>').join('') + '</select></div>' +
        '<div class="campo"><label for="ff-hora">Começa às</label><input id="ff-hora" name="hora" type="time" step="' + c.bloco_min * 60 + '" value="' + esc(f ? f.hora : '19:00') + '" required></div>' +
        '<div class="campo"><label for="ff-dur">Duração</label><select id="ff-dur" name="duracao_min">' + duracoes + '</select></div>' +
      '</div>' +
      '<div class="campo"><label for="ff-quadra">Quadra</label><select id="ff-quadra" name="quadra_id">' + quadras.map((q) => '<option value="' + esc(q.id) + '"' + (f && f.quadra_id === q.id ? ' selected' : '') + '>' + esc(q.nome) + '</option>').join('') + '</select></div>' +
      '<div class="form-grid form-grid--2">' +
        '<div class="campo"><label for="ff-nome">Turma ou responsável</label><input id="ff-nome" name="cliente_nome" type="text" maxlength="80" value="' + esc(f ? f.cliente_nome : '') + '" required></div>' +
        '<div class="campo"><label for="ff-whats">WhatsApp</label><input id="ff-whats" name="cliente_whatsapp" type="tel" inputmode="tel" value="' + esc(f && f.cliente_whatsapp ? R.formatarWhatsapp(f.cliente_whatsapp) : '') + '"></div>' +
      '</div>' +
      '<div class="form-grid form-grid--3">' +
        '<div class="campo"><label for="ff-de">Vale a partir de</label><input id="ff-de" name="valido_de" type="date" value="' + esc(f ? f.valido_de : hoje()) + '" required></div>' +
        '<div class="campo"><label for="ff-ate">Até <small>(opcional)</small></label><input id="ff-ate" name="valido_ate" type="date" value="' + esc(f && f.valido_ate ? f.valido_ate : '') + '"></div>' +
        '<div class="campo"><label for="ff-valor">Valor por jogo (R$)</label><input id="ff-valor" name="valor" type="number" min="0" step="0.01" value="' + esc(f && f.valor != null ? f.valor : '') + '"></div>' +
      '</div>' +
      '<div class="campo"><label for="ff-obs">Observações</label><textarea id="ff-obs" name="observacoes" maxlength="300">' + esc(f ? f.observacoes || '' : '') + '</textarea></div>' +
      '<label class="campo--check"><input type="checkbox" name="ativo"' + (!f || f.ativo !== false ? ' checked' : '') + '> Ativo (some da agenda do site)</label>' +
      '<div data-ff-erro aria-live="assertive"></div>' +
      '<div class="acoes-modal"><button class="btn btn--primary btn--lg" type="submit">' + ICONE('i-check') + ' Salvar horário fixo</button></div>' +
    '</form>';
    const caixa = abrirModal(f ? 'Editar horário fixo' : 'Novo horário fixo', html);
    const form = $('[data-form-fixo]', caixa);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const erro = $('[data-ff-erro]', form);
      const mostrarErro = (m) => { erro.innerHTML = '<div class="alerta alerta--erro" role="alert">' + ICONE('i-alerta') + '<p>' + esc(m) + '</p></div>'; };
      erro.innerHTML = '';
      const novo = {
        id: f ? f.id : undefined, quadra_id: form.quadra_id.value, dia_semana: Number(form.dia_semana.value), hora: form.hora.value,
        duracao_min: Number(form.duracao_min.value), cliente_nome: R.limparNome(form.cliente_nome.value), cliente_whatsapp: form.cliente_whatsapp.value.trim(),
        valor: form.valor.value, observacoes: form.observacoes.value.trim(), valido_de: form.valido_de.value, valido_ate: form.valido_ate.value || null,
        datas_puladas: f ? f.datas_puladas || [] : [], ativo: form.ativo.checked
      };
      if (novo.cliente_nome.length < 2) { mostrarErro('Escreva o nome da turma ou do responsável.'); return; }
      if (novo.cliente_whatsapp && !R.whatsappValido(novo.cliente_whatsapp)) { mostrarErro(R.mensagem('WHATSAPP_INVALIDO')); return; }
      if (!R.dataValida(novo.valido_de)) { mostrarErro('Escolha a data de início.'); return; }
      if (novo.valido_ate && novo.valido_ate < novo.valido_de) { mostrarErro('A data final vem antes da inicial.'); return; }
      const ini = R.hhmmParaMin(novo.hora);
      const func = est.base.funcionamento.find((x) => Number(x.dia) === novo.dia_semana);
      if (!(ini >= 0)) { mostrarErro('Horário inválido.'); return; }
      if (!func || !func.aberto) { mostrarErro('A arena está marcada como fechada ' + DIAS_PLURAL[novo.dia_semana].toLowerCase().replace(/^tod[oa] /, 'na ') + '. Ajuste em Horário e regras.'); return; }
      const abre = R.hhmmParaMin(func.abre);
      const fecha = R.hhmmParaMin(func.fecha) || 1440;
      if (ini < abre || ini + novo.duracao_min > fecha || (ini - abre) % c.bloco_min !== 0) {
        mostrarErro('Nesse dia a agenda vai de ' + R.horaTexto(abre) + ' às ' + R.horaTexto(fecha) + ', com horários a cada ' + duracaoTexto(c.bloco_min) + '. Escolha um início dentro dela.');
        return;
      }
      const choque = novo.ativo && est.base.fixos.find((x) => x.id !== novo.id && x.ativo !== false && x.quadra_id === novo.quadra_id && Number(x.dia_semana) === novo.dia_semana &&
        x.valido_de <= (novo.valido_ate || '9999-12-31') && novo.valido_de <= (x.valido_ate || '9999-12-31') &&
        R.hhmmParaMin(x.hora) < ini + novo.duracao_min && ini < R.hhmmParaMin(x.hora) + Number(x.duracao_min));
      if (choque) { mostrarErro('Já existe a turma "' + choque.cliente_nome + '" nessa quadra, nesse dia e horário.'); return; }

      // Reservas avulsas que já caem nesse horário
      if (novo.ativo) {
        const ate = novo.valido_ate && novo.valido_ate < R.somarDias(hoje(), 120) ? novo.valido_ate : R.somarDias(hoje(), 120);
        const de = novo.valido_de > hoje() ? novo.valido_de : hoje();
        let afetadas = [];
        try {
          afetadas = (await A.admin.reservas.listar(de, ate)).filter((x) => ativa(x) && futura(x) && x.quadra_id === novo.quadra_id && (() => {
            const l = R.isoParaLocal(x.inicio);
            const fimL = l.min + Math.round((new Date(x.fim) - new Date(x.inicio)) / 60000);
            return R.diaDaSemana(l.data) === novo.dia_semana && !novo.datas_puladas.includes(l.data) && l.min < ini + novo.duracao_min && ini < fimL;
          })());
        } catch (err) { falha(err); return; }
        if (afetadas.length) {
          const resp = await confirmar({
            titulo: 'Já tem reserva nesse horário', botao: 'Salvar mesmo assim',
            html: '<p>Estas reservas avulsas caem no horário da turma:</p><ul>' + afetadas.map((x) => '<li>' + esc(quandoCurto(x).dia + ' · ' + x.cliente_nome) + '</li>').join('') +
              '</ul><p>O fixo será salvo e essas reservas continuam valendo. Remarque ou cancele cada uma, ou use "Pular uma data" no fixo.</p>'
          });
          if (!resp.ok) return;
        }
      }
      const botao = $('button[type="submit"]', form);
      ocupado(botao, true);
      const ok = await salvarFixo(novo, f ? 'Horário fixo atualizado.' : 'Horário fixo criado.');
      ocupado(botao, false);
      if (ok) fecharModal();
    });
  }

  /* ==================== 4. Feriados e bloqueios ==================== */
  function renderFeriados() {
    const el = corpo('feriados');
    const datas = est.base.datasEspeciais.filter((d) => d.data >= hoje()).sort((a, b) => a.data.localeCompare(b.data));
    const bloqueios = est.base.bloqueios.filter((b) => new Date(b.fim).getTime() > Date.now()).sort((a, b) => String(a.inicio).localeCompare(String(b.inicio)));
    const opQuadras = '<option value="">Todas as quadras</option>' + est.base.quadras.map((q) => '<option value="' + esc(q.id) + '">' + esc(q.nome) + '</option>').join('');
    el.innerHTML =
      '<section class="bloco" aria-labelledby="h-datas">' +
        '<h2 class="bloco__titulo" id="h-datas">Feriados e datas especiais</h2>' +
        '<p class="bloco__sub">Vale mais que o horário normal da semana. Fechado tira o dia da agenda; horário especial troca a abertura e o fechamento só naquela data.</p>' +
        '<form class="form-grid" data-form-data novalidate>' +
          '<div class="form-grid form-grid--4">' +
            '<div class="campo"><label for="fd-data">Data</label><input id="fd-data" name="data" type="date" min="' + hoje() + '" required></div>' +
            '<div class="campo"><label for="fd-tipo">O que acontece</label><select id="fd-tipo" name="tipo"><option value="fechado">Arena fechada</option><option value="horario">Horário especial</option></select></div>' +
            '<div class="campo" data-fd-hora hidden><label for="fd-abre">Abre</label><input id="fd-abre" name="abre" type="time" value="08:00"></div>' +
            '<div class="campo" data-fd-hora hidden><label for="fd-fecha">Fecha</label><input id="fd-fecha" name="fecha" type="time" value="12:00"></div>' +
          '</div>' +
          '<div class="campo"><label for="fd-motivo">Motivo (aparece no site)</label><input id="fd-motivo" name="motivo" type="text" maxlength="60" placeholder="Ex.: Natal, Torneio de verão"></div>' +
          '<div class="bloco__acoes"><button class="btn btn--primary" type="submit">' + ICONE('i-check') + ' Salvar data</button>' +
          '<button class="btn btn--ghost" type="button" data-importar>' + ICONE('i-feriado') + ' Adicionar feriados nacionais</button></div>' +
        '</form>' +
        '<div class="linhas mt-5" data-lista-datas>' + (datas.length ? datas.map((d) => {
          const desc = d.tipo === 'fechado' ? 'Fechada' : 'Horário especial: ' + R.horaTexto(d.abre) + ' às ' + R.horaTexto(d.fecha);
          return '<div class="linha"><div class="linha__principal"><b>' + esc(R.dataLonga(d.data)) + '</b><span>' + esc(desc) + (d.motivo ? ' · ' + esc(d.motivo) : '') + '</span></div>' +
            '<div class="linha__acoes"><button class="btn btn--sm btn--ghost" type="button" data-editar-data="' + d.data + '">' + ICONE('i-editar') + ' Editar</button>' +
            '<button class="btn btn--sm btn--texto" type="button" data-excluir-data="' + d.data + '" aria-label="Excluir data especial">' + ICONE('i-lixo') + '</button></div></div>';
        }).join('') : '<p class="vazio">Nenhum feriado ou data especial cadastrado daqui pra frente.</p>') + '</div>' +
      '</section>' +
      '<section class="bloco" aria-labelledby="h-bloqueios">' +
        '<h2 class="bloco__titulo" id="h-bloqueios">Bloqueios de quadra</h2>' +
        '<p class="bloco__sub">Manutenção, troca de areia, torneio, evento fechado. O período some da agenda do site.</p>' +
        '<form class="form-grid" data-form-bloqueio novalidate>' +
          '<div class="campo"><label for="fb-quadra">Quadra</label><select id="fb-quadra" name="quadra_id">' + opQuadras + '</select></div>' +
          '<div class="form-grid form-grid--4">' +
            '<div class="campo"><label for="fb-di">De (dia)</label><input id="fb-di" name="data_ini" type="date" min="' + hoje() + '" value="' + hoje() + '" required></div>' +
            '<div class="campo"><label for="fb-hi">Hora</label><input id="fb-hi" name="hora_ini" type="time" value="17:00" required></div>' +
            '<div class="campo"><label for="fb-df">Até (dia)</label><input id="fb-df" name="data_fim" type="date" min="' + hoje() + '" value="' + hoje() + '" required></div>' +
            '<div class="campo"><label for="fb-hf">Hora</label><input id="fb-hf" name="hora_fim" type="time" value="23:00" required></div>' +
          '</div>' +
          '<div class="campo"><label for="fb-motivo">Motivo</label><input id="fb-motivo" name="motivo" type="text" maxlength="60" placeholder="Ex.: Manutenção da rede"></div>' +
          '<div class="bloco__acoes"><button class="btn btn--primary" type="submit">' + ICONE('i-check') + ' Bloquear</button></div>' +
        '</form>' +
        '<div class="linhas mt-5">' + (bloqueios.length ? bloqueios.map((b) => '<div class="linha"><div class="linha__principal"><b>' +
          esc(b.quadra_id ? nomeQuadra(b.quadra_id) : 'Todas as quadras') + ' · ' + esc(dataHora(b.inicio)) + ' até ' + esc(dataHora(b.fim)) + '</b><span>' + esc(b.motivo || 'Sem motivo') + '</span></div>' +
          '<div class="linha__acoes"><button class="btn btn--sm btn--ghost" type="button" data-excluir-bloqueio="' + esc(b.id) + '">' + ICONE('i-lixo') + ' Liberar</button></div></div>').join('')
          : '<p class="vazio">Nenhuma quadra bloqueada daqui pra frente.</p>') + '</div>' +
      '</section>';

    const fd = $('[data-form-data]', el);
    const alternarHoras = () => $$('[data-fd-hora]', fd).forEach((x) => { x.hidden = fd.tipo.value !== 'horario'; });
    fd.tipo.addEventListener('change', alternarHoras);
    fd.addEventListener('submit', (e) => { e.preventDefault(); salvarDataEspecial(fd); });
    $$('[data-editar-data]', el).forEach((b) => b.addEventListener('click', () => {
      const d = est.base.datasEspeciais.find((x) => x.data === b.getAttribute('data-editar-data'));
      fd.data.value = d.data;
      fd.tipo.value = d.tipo;
      if (d.abre) fd.abre.value = d.abre;
      if (d.fecha) fd.fecha.value = d.fecha;
      fd.motivo.value = d.motivo || '';
      alternarHoras();
      fd.scrollIntoView({ behavior: 'smooth', block: 'center' });
      fd.data.focus();
    }));
    $$('[data-excluir-data]', el).forEach((b) => b.addEventListener('click', async () => {
      const d = est.base.datasEspeciais.find((x) => x.data === b.getAttribute('data-excluir-data'));
      const resp = await confirmar({ titulo: 'Excluir data especial?', html: '<p>' + esc(R.dataLonga(d.data)) + ' volta a seguir o horário normal da semana.</p>', botao: 'Excluir', perigo: true });
      if (!resp.ok) return;
      try { await A.admin.datas.excluir(d); await carregarBase(); toast('Data removida.', 'ok'); renderFeriados(); } catch (err) { falha(err); }
    }));
    $('[data-importar]', el).addEventListener('click', abrirImportarFeriados);
    const fb = $('[data-form-bloqueio]', el);
    fb.addEventListener('submit', (e) => { e.preventDefault(); salvarBloqueio(fb); });
    $$('[data-excluir-bloqueio]', el).forEach((b) => b.addEventListener('click', async () => {
      const bl = est.base.bloqueios.find((x) => x.id === b.getAttribute('data-excluir-bloqueio'));
      const resp = await confirmar({ titulo: 'Liberar a quadra?', html: '<p>O período volta para a agenda do site.</p>', botao: 'Liberar' });
      if (!resp.ok) return;
      try { await A.admin.bloqueios.excluir(bl); await carregarBase(); toast('Bloqueio removido.', 'ok'); renderFeriados(); } catch (err) { falha(err); }
    }));
  }

  // Reservas ativas e futuras que deixam de caber depois de uma mudança
  async function reservasAfetadas(de, ate, cabe) {
    const lista = await A.admin.reservas.listar(de, ate);
    return lista.filter((x) => ativa(x) && futura(x) && !cabe(x));
  }
  // Pergunta o que fazer com as reservas afetadas. Devolve false se o ADM desistir.
  async function tratarAfetadas(afetadas, motivo, oQue) {
    if (!afetadas.length) return { seguir: true, cancelar: false };
    const resp = await confirmar({
      titulo: afetadas.length === 1 ? '1 reserva fica de fora' : afetadas.length + ' reservas ficam de fora',
      html: '<p>' + esc(oQue) + ' atinge:</p><ul>' + afetadas.map((x) => '<li>' + esc(quandoCurto(x).dia + ', ' + quandoCurto(x).horas + ' · ' + nomeQuadra(x.quadra_id) + ' · ' + x.cliente_nome) + '</li>').join('') + '</ul>',
      campo: 'check', rotulo: 'Cancelar essas reservas e preparar o aviso no WhatsApp', valor: true, botao: 'Salvar'
    });
    return { seguir: resp.ok, cancelar: resp.ok && resp.valor };
  }
  async function cancelarEmLote(afetadas, motivo) {
    const feitos = [];
    for (const x of afetadas) {
      try {
        const novo = await A.admin.reservas.status(x, 'cancelada', { motivo_cancelamento: motivo, cancelado_por: 'arena' });
        feitos.push(novo);
      } catch (e) { falha(e); }
    }
    atualizarPendentes();
    const comWhats = feitos.filter((x) => x.cliente_whatsapp);
    if (!comWhats.length) return;
    abrirModal('Avise os clientes', '<p>' + (comWhats.length === 1 ? 'A reserva foi cancelada.' : comWhats.length + ' reservas foram canceladas.') + ' Toque em cada um para mandar a mensagem pronta:</p>' +
      '<ul class="lista-aviso">' + comWhats.map((x) => '<li><span><b>' + esc(x.cliente_nome) + '</b><br><small>' + esc(quandoCurto(x).dia + ', ' + quandoCurto(x).horas) + '</small></span>' +
        '<a class="btn btn--whatsapp btn--sm" href="' + esc(linkWhats(x.cliente_whatsapp, msgCancelamento(x, motivo))) + '" target="_blank" rel="noopener noreferrer">' + ICONE('i-whats') + ' Avisar</a></li>').join('') + '</ul>');
  }

  async function salvarDataEspecial(fd) {
    const item = { data: fd.data.value, tipo: fd.tipo.value, abre: fd.abre.value, fecha: fd.fecha.value, motivo: fd.motivo.value.trim() };
    if (!R.dataValida(item.data)) { toast('Escolha a data.', 'erro'); fd.data.focus(); return; }
    if (item.data < hoje()) { toast('Essa data já passou.', 'erro'); return; }
    let abre = 0;
    let fecha = 0;
    if (item.tipo === 'horario') {
      abre = R.hhmmParaMin(item.abre);
      fecha = R.hhmmParaMin(item.fecha);
      if (fecha === 0) fecha = 1440;
      if (!(abre >= 0) || !(fecha > abre)) { toast('O fechamento precisa ser depois da abertura (meia-noite = 00:00).', 'erro'); return; }
      if (fecha - abre < cfg().bloco_min) { toast('O horário especial precisa ter pelo menos ' + duracaoTexto(cfg().bloco_min) + '.', 'erro'); return; }
    }
    const motivo = item.motivo || (item.tipo === 'fechado' ? 'Arena fechada' : 'Horário especial');
    let afetadas;
    try {
      afetadas = await reservasAfetadas(item.data, item.data, (x) => {
        if (item.tipo === 'fechado') return false;
        const l = R.isoParaLocal(x.inicio);
        const dur = Math.round((new Date(x.fim) - new Date(x.inicio)) / 60000);
        return l.min >= abre && l.min + dur <= fecha && (l.min - abre) % cfg().bloco_min === 0;
      });
    } catch (e) { falha(e); return; }
    const t = await tratarAfetadas(afetadas, motivo, (item.tipo === 'fechado' ? 'Fechar a arena' : 'O horário especial') + ' em ' + R.dataLonga(item.data));
    if (!t.seguir) return;
    try {
      await A.admin.datas.salvar(item);
      await carregarBase();
      toast('Data salva: ' + R.dataLonga(item.data) + '.', 'ok');
      renderFeriados();
      if (t.cancelar) await cancelarEmLote(afetadas, motivo);
    } catch (e) { falha(e); }
  }

  async function salvarBloqueio(fb) {
    const ini = R.hhmmParaMin(fb.hora_ini.value);
    const fimMin = R.hhmmParaMin(fb.hora_fim.value);
    if (!R.dataValida(fb.data_ini.value) || !R.dataValida(fb.data_fim.value) || !(ini >= 0) || !(fimMin >= 0)) { toast('Preencha o começo e o fim do bloqueio.', 'erro'); return; }
    const inicio = R.localParaIso(fb.data_ini.value, ini);
    const fim = R.localParaIso(fb.data_fim.value, fimMin === 0 && fb.data_fim.value === fb.data_ini.value ? 1440 : fimMin);
    if (new Date(fim) <= new Date(inicio)) { toast('O fim do bloqueio precisa ser depois do começo.', 'erro'); return; }
    if (new Date(fim).getTime() <= Date.now()) { toast('Esse período já passou.', 'erro'); return; }
    const item = { quadra_id: fb.quadra_id.value || null, inicio, fim, motivo: fb.motivo.value.trim() };
    const motivo = item.motivo || 'Quadra bloqueada pela arena';
    let afetadas;
    try {
      afetadas = await reservasAfetadas(fb.data_ini.value, fb.data_fim.value, (x) =>
        (item.quadra_id && x.quadra_id !== item.quadra_id) || !(new Date(x.inicio) < new Date(fim) && new Date(inicio) < new Date(x.fim)));
    } catch (e) { falha(e); return; }
    const t = await tratarAfetadas(afetadas, motivo, 'O bloqueio');
    if (!t.seguir) return;
    try {
      await A.admin.bloqueios.salvar(item);
      await carregarBase();
      toast('Bloqueio salvo.', 'ok');
      renderFeriados();
      if (t.cancelar) await cancelarEmLote(afetadas, motivo);
    } catch (e) { falha(e); }
  }

  function abrirImportarFeriados() {
    const ano = Number(hoje().slice(0, 4));
    const ja = new Set(est.base.datasEspeciais.map((d) => d.data));
    const lista = R.feriadosNacionais(ano).concat(R.feriadosNacionais(ano + 1)).filter((f) => f.data >= hoje()).slice(0, 18);
    const caixa = abrirModal('Feriados nacionais',
      '<p class="dica">Marque os dias em que a arena NÃO abre. Os facultativos vêm desmarcados. Depois dá para trocar qualquer um para horário especial.</p>' +
      '<form data-form-importar><div class="linhas">' + lista.map((f, i) => '<label class="linha"><span class="campo--check"><input type="checkbox" name="f' + i + '" value="' + f.data + '"' +
        (ja.has(f.data) ? ' disabled' : f.facultativo ? '' : ' checked') + '> <span><b>' + esc(R.dataLonga(f.data)) + '</b><br><small>' + esc(f.nome) + (f.facultativo ? ' (ponto facultativo)' : '') +
        (ja.has(f.data) ? ' · já cadastrado' : '') + '</small></span></span></label>').join('') + '</div>' +
      '<div class="acoes-modal mt-4"><button class="btn btn--primary btn--lg" type="submit">' + ICONE('i-check') + ' Fechar a arena nesses dias</button></div></form>');
    $('[data-form-importar]', caixa).addEventListener('submit', async (e) => {
      e.preventDefault();
      const marcados = $$('input[type="checkbox"]:checked:not(:disabled)', e.currentTarget).map((i) => lista.find((f) => f.data === i.value));
      if (!marcados.length) { fecharModal(); return; }
      let afetadas = [];
      try {
        for (const f of marcados) afetadas = afetadas.concat(await reservasAfetadas(f.data, f.data, () => false));
      } catch (err) { falha(err); return; }
      const t = await tratarAfetadas(afetadas, 'Feriado', 'Fechar a arena nos feriados');
      if (!t.seguir) return;
      try {
        for (const f of marcados) await A.admin.datas.salvar({ data: f.data, tipo: 'fechado', motivo: f.nome });
        await carregarBase();
        fecharModal();
        toast(marcados.length + (marcados.length === 1 ? ' feriado adicionado.' : ' feriados adicionados.'), 'ok');
        renderFeriados();
        if (t.cancelar) {
          for (const f of marcados) {
            const doDia = afetadas.filter((x) => R.isoParaLocal(x.inicio).data === f.data);
            if (doDia.length) await cancelarEmLote(doDia, f.nome);
          }
        }
      } catch (err) { falha(err); }
    });
  }

  /* ==================== 5. Quadras ==================== */
  function renderQuadras() {
    const el = corpo('quadras');
    const q = est.base.quadras;
    el.innerHTML = q.length ? '<div class="linhas">' + q.map((x) =>
      '<div class="linha' + (x.ativa === false ? ' linha--off' : '') + '"><div class="linha__principal"><b>' + esc(x.nome) + '</b><span>' + esc(x.descricao || 'Sem descrição') + ' · ordem ' + (x.ordem || 0) + '</span></div>' +
      '<div class="linha__acoes">' +
        '<label class="switch"><input type="checkbox" data-q-ativa="' + esc(x.id) + '"' + (x.ativa !== false ? ' checked' : '') + '><span class="switch__trilho"></span> Em uso</label>' +
        '<label class="switch"><input type="checkbox" data-q-online="' + esc(x.id) + '"' + (x.reserva_online !== false ? ' checked' : '') + '><span class="switch__trilho"></span> Reserva pelo site</label>' +
        '<button class="btn btn--sm btn--ghost" type="button" data-q-editar="' + esc(x.id) + '">' + ICONE('i-editar') + ' Editar</button>' +
        '<button class="btn btn--sm btn--texto" type="button" data-q-excluir="' + esc(x.id) + '" aria-label="Excluir ' + esc(x.nome) + '">' + ICONE('i-lixo') + '</button>' +
      '</div></div>').join('') + '</div>' : '<p class="vazio">Nenhuma quadra cadastrada. Sem quadra, o site não mostra horários.</p>';
    const acha = (id) => est.base.quadras.find((x) => x.id === id);
    $$('[data-q-ativa]', el).forEach((i) => i.addEventListener('change', async () => {
      const x = acha(i.getAttribute('data-q-ativa'));
      if (!i.checked) {
        const h = hoje();
        let afetadas = [];
        try { afetadas = await reservasAfetadas(h, R.somarDias(h, 180), (r) => r.quadra_id !== x.id); } catch (e) { falha(e); i.checked = true; return; }
        const t = await tratarAfetadas(afetadas, 'Quadra fora de uso', 'Tirar a ' + x.nome + ' de uso');
        if (!t.seguir) { i.checked = true; return; }
        if (!(await salvarQuadra(Object.assign({}, x, { ativa: false }), x.nome + ' fora de uso.'))) { i.checked = true; return; }
        if (t.cancelar) await cancelarEmLote(afetadas, 'Quadra fora de uso');
        return;
      }
      if (!(await salvarQuadra(Object.assign({}, x, { ativa: true }), x.nome + ' de volta.'))) i.checked = false;
    }));
    $$('[data-q-online]', el).forEach((i) => i.addEventListener('change', async () => {
      const x = acha(i.getAttribute('data-q-online'));
      if (!(await salvarQuadra(Object.assign({}, x, { reserva_online: i.checked }), i.checked ? x.nome + ' aparece no site.' : x.nome + ' agora só no balcão.'))) i.checked = !i.checked;
    }));
    $$('[data-q-editar]', el).forEach((b) => b.addEventListener('click', () => abrirFormQuadra(acha(b.getAttribute('data-q-editar')))));
    $$('[data-q-excluir]', el).forEach((b) => b.addEventListener('click', async () => {
      const x = acha(b.getAttribute('data-q-excluir'));
      const resp = await confirmar({ titulo: 'Excluir ' + x.nome + '?', html: '<p>Os horários fixos e bloqueios dessa quadra também saem. Se ela tem reservas no histórico, não dá para excluir: desligue "Em uso".</p>', botao: 'Excluir', perigo: true });
      if (!resp.ok) return;
      try { await A.admin.quadras.excluir(x); await carregarBase(); toast(x.nome + ' excluída.', 'ok'); renderQuadras(); } catch (e) { falha(e); }
    }));
  }
  async function salvarQuadra(q, mensagem) {
    try {
      await A.admin.quadras.salvar({ id: q.id, nome: q.nome, descricao: q.descricao || '', ordem: Number(q.ordem) || 0, ativa: q.ativa !== false, reserva_online: q.reserva_online !== false });
      await carregarBase();
      toast(mensagem, 'ok');
      renderQuadras();
      return true;
    } catch (e) { falha(e); return false; }
  }
  function abrirFormQuadra(q) {
    const caixa = abrirModal(q ? 'Editar quadra' : 'Nova quadra',
      '<form class="form-grid" data-form-quadra novalidate>' +
        '<div class="form-grid form-grid--2">' +
          '<div class="campo"><label for="fq-nome">Nome</label><input id="fq-nome" name="nome" type="text" maxlength="40" value="' + esc(q ? q.nome : 'Quadra ' + (est.base.quadras.length + 1)) + '" required></div>' +
          '<div class="campo"><label for="fq-ordem">Ordem na tela</label><input id="fq-ordem" name="ordem" type="number" min="0" max="99" value="' + esc(q ? q.ordem || 0 : est.base.quadras.length + 1) + '"></div>' +
        '</div>' +
        '<div class="campo"><label for="fq-desc">Descrição curta (aparece para o cliente)</label><input id="fq-desc" name="descricao" type="text" maxlength="60" value="' + esc(q ? q.descricao || '' : '') + '" placeholder="Ex.: Rede de futevôlei"></div>' +
        '<label class="campo--check"><input type="checkbox" name="ativa"' + (!q || q.ativa !== false ? ' checked' : '') + '> Em uso</label>' +
        '<label class="campo--check"><input type="checkbox" name="reserva_online"' + (!q || q.reserva_online !== false ? ' checked' : '') + '> Cliente pode reservar pelo site</label>' +
        '<div class="acoes-modal"><button class="btn btn--primary btn--lg" type="submit">' + ICONE('i-check') + ' Salvar quadra</button></div>' +
      '</form>');
    $('[data-form-quadra]', caixa).addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.currentTarget;
      const nome = f.nome.value.trim();
      if (nome.length < 2) { toast('Dê um nome para a quadra.', 'erro'); return; }
      if (est.base.quadras.some((x) => x.nome.toLowerCase() === nome.toLowerCase() && (!q || x.id !== q.id))) { toast('Já existe uma quadra com esse nome.', 'erro'); return; }
      const ok = await salvarQuadra({ id: q ? q.id : undefined, nome, ordem: f.ordem.value, descricao: f.descricao.value.trim(), ativa: f.ativa.checked, reserva_online: f.reserva_online.checked }, q ? 'Quadra atualizada.' : 'Quadra criada.');
      if (ok) fecharModal();
    });
  }

  /* ==================== 6. Horário e regras ==================== */
  function renderRegras() {
    const el = corpo('regras');
    const c = cfg();
    const func = {};
    est.base.funcionamento.forEach((f) => { func[f.dia] = f; });
    const sel = (nome, opcoes, atual) => '<select id="rg-' + nome + '" name="' + nome + '">' + opcoes.map((o) => '<option value="' + o[0] + '"' + (String(o[0]) === String(atual) ? ' selected' : '') + '>' + esc(o[1]) + '</option>').join('') + '</select>';
    el.innerHTML =
      '<form class="bloco" data-form-func novalidate aria-labelledby="h-func">' +
        '<h2 class="bloco__titulo" id="h-func">Dias e horário de funcionamento</h2>' +
        '<p class="bloco__sub">A agenda do site monta os horários a partir daqui. Fecha à meia-noite? Use 00:00. Feriados ficam em "Feriados e bloqueios".</p>' +
        '<div class="semana">' + ORDEM_SEMANA.map((d) => {
          const f = func[d] || { aberto: false, abre: '17:00', fecha: '23:00' };
          return '<div class="semana__dia' + (f.aberto ? '' : ' is-fechado') + '" data-semana="' + d + '">' +
            '<label class="campo--check"><input type="checkbox" name="aberto-' + d + '"' + (f.aberto ? ' checked' : '') + '> ' + DIAS_TIT[d] + '</label>' +
            '<div class="semana__horas"><input type="time" name="abre-' + d + '" value="' + esc(f.abre) + '" aria-label="' + DIAS_TIT[d] + ': abre"> às ' +
            '<input type="time" name="fecha-' + d + '" value="' + esc(f.fecha) + '" aria-label="' + DIAS_TIT[d] + ': fecha"></div></div>';
        }).join('') + '</div>' +
        '<div class="bloco__acoes"><button class="btn btn--primary" type="submit">' + ICONE('i-check') + ' Salvar horários</button></div>' +
      '</form>' +

      '<form class="bloco" data-form-regras novalidate aria-labelledby="h-regras-reserva">' +
        '<h2 class="bloco__titulo" id="h-regras-reserva">Regras da reserva</h2>' +
        '<p class="bloco__sub">Valem para quem reserva pelo site. No painel você pode passar por cima de antecedência, limite e janela, mas nunca marcar dois no mesmo horário.</p>' +
        '<div class="form-grid form-grid--3">' +
          '<div class="campo"><label for="rg-bloco_min">Cada horário dura</label>' + sel('bloco_min', [[30, '30 min'], [45, '45 min'], [60, '1 hora'], [90, '1h30'], [120, '2 horas']], c.bloco_min) + '</div>' +
          '<div class="campo"><label for="rg-max_blocos">Horários seguidos por reserva</label>' + sel('max_blocos', [[1, 'Só 1'], [2, 'Até 2'], [3, 'Até 3'], [4, 'Até 4']], c.max_blocos) + '</div>' +
          '<div class="campo"><label for="rg-antecedencia_min">Antecedência mínima</label>' + sel('antecedencia_min', [[0, 'Nenhuma'], [30, '30 minutos'], [60, '1 hora'], [120, '2 horas'], [180, '3 horas'], [360, '6 horas'], [720, '12 horas'], [1440, '1 dia']], c.antecedencia_min) + '</div>' +
          '<div class="campo"><label for="rg-janela_dias">Agenda aberta para (dias)</label><input id="rg-janela_dias" name="janela_dias" type="number" min="1" max="180" value="' + c.janela_dias + '"></div>' +
          '<div class="campo"><label for="rg-limite_ativas">Reservas ativas por WhatsApp</label><input id="rg-limite_ativas" name="limite_ativas" type="number" min="0" max="10" value="' + c.limite_ativas + '"><small>0 = sem limite</small></div>' +
          '<div class="campo"><label for="rg-prazo_cancelamento_h">Cancelar pelo site até (horas antes)</label><input id="rg-prazo_cancelamento_h" name="prazo_cancelamento_h" type="number" min="0" max="72" value="' + c.prazo_cancelamento_h + '"></div>' +
          '<div class="campo"><label for="rg-faltas_bloqueio">Faltas que suspendem o cliente</label><input id="rg-faltas_bloqueio" name="faltas_bloqueio" type="number" min="0" max="10" value="' + c.faltas_bloqueio + '"><small>Conta os últimos 6 meses. 0 = não suspende</small></div>' +
        '</div>' +
        '<div class="bloco__acoes"><button class="btn btn--primary" type="submit">' + ICONE('i-check') + ' Salvar regras</button></div>' +
      '</form>' +

      '<form class="bloco" data-form-preco novalidate aria-labelledby="h-preco">' +
        '<h2 class="bloco__titulo" id="h-preco">Preço e modalidades</h2>' +
        '<p class="bloco__sub">Sem preço, o site mostra "combinado na arena". O horário nobre vale a partir da hora escolhida e, se marcar, o fim de semana inteiro.</p>' +
        '<div class="form-grid form-grid--4">' +
          '<div class="campo"><label for="rg-preco_hora">Valor da hora (R$)</label><input id="rg-preco_hora" name="preco_hora" type="number" min="0" step="0.01" value="' + esc(c.preco_hora != null ? c.preco_hora : '') + '" placeholder="Combinado"></div>' +
          '<div class="campo"><label for="rg-preco_nobre">Hora nobre (R$)</label><input id="rg-preco_nobre" name="preco_nobre" type="number" min="0" step="0.01" value="' + esc(c.preco_nobre != null ? c.preco_nobre : '') + '" placeholder="Igual"></div>' +
          '<div class="campo"><label for="rg-nobre_inicio">Nobre a partir das</label><input id="rg-nobre_inicio" name="nobre_inicio" type="time" value="' + esc(c.nobre_inicio || '') + '"></div>' +
          '<label class="campo--check"><input type="checkbox" name="nobre_fds"' + (c.nobre_fds ? ' checked' : '') + '> Sábado e domingo são nobres</label>' +
        '</div>' +
        '<div class="campo"><label for="rg-modalidades">Modalidades (separe por vírgula)</label><input id="rg-modalidades" name="modalidades" type="text" value="' + esc(c.modalidades.join(', ')) + '"></div>' +
        '<div class="bloco__acoes"><button class="btn btn--primary" type="submit">' + ICONE('i-check') + ' Salvar preço</button></div>' +
      '</form>';

    const ff = $('[data-form-func]', el);
    ff.addEventListener('change', (e) => {
      const linha = e.target.closest('[data-semana]');
      if (linha && e.target.type === 'checkbox') linha.classList.toggle('is-fechado', !e.target.checked);
    });
    ff.addEventListener('submit', async (e) => {
      e.preventDefault();
      const lista = [];
      for (const d of [0, 1, 2, 3, 4, 5, 6]) {
        const aberto = ff['aberto-' + d].checked;
        const abre = ff['abre-' + d].value;
        const fecha = ff['fecha-' + d].value;
        if (aberto) {
          const a = R.hhmmParaMin(abre);
          let f = R.hhmmParaMin(fecha);
          if (f === 0) f = 1440;
          if (!(a >= 0) || !(f > a)) { toast(DIAS_TIT[d] + ': o fechamento precisa ser depois da abertura (meia-noite = 00:00).', 'erro'); return; }
          if (f - a < cfg().bloco_min) { toast(DIAS_TIT[d] + ': aberto por menos tempo que um horário.', 'erro'); return; }
        }
        // Dia fechado com horário inválido travaria a regra do banco (fecha > abre): volta ao padrão
        const horasOk = R.hhmmParaMin(abre) >= 0 && (R.hhmmParaMin(fecha) === 0 || R.hhmmParaMin(fecha) > R.hhmmParaMin(abre));
        lista.push({ dia: d, aberto, abre: horasOk ? abre : '17:00', fecha: horasOk ? fecha : '23:00' });
      }
      const h = hoje();
      let afetadas;
      try {
        const nova = Object.assign({}, est.base, { funcionamento: lista });
        afetadas = await reservasAfetadas(h, R.somarDias(h, cfg().janela_dias + 30), (x) => {
          const l = R.isoParaLocal(x.inicio);
          const dia = R.horarioDoDia(l.data, nova);
          const dur = Math.round((new Date(x.fim) - new Date(x.inicio)) / 60000);
          return dia.aberto && l.min >= dia.abre && l.min + dur <= dia.fecha && (l.min - dia.abre) % cfg().bloco_min === 0;
        });
      } catch (err) { falha(err); return; }
      const t = await tratarAfetadas(afetadas, 'Mudança no horário da arena', 'O novo horário');
      if (!t.seguir) return;
      try {
        await A.admin.funcionamento.salvar(lista);
        await carregarBase();
        toast('Horários salvos. A agenda do site já usa os novos.', 'ok');
        if (t.cancelar) await cancelarEmLote(afetadas, 'Mudança no horário da arena');
      } catch (err) { falha(err); }
    });

    const fr = $('[data-form-regras]', el);
    fr.addEventListener('submit', async (e) => {
      e.preventDefault();
      const num = (n, min, max) => { const v = Number(fr[n].value); return Number.isInteger(v) && v >= min && v <= max ? v : NaN; };
      const dados = {
        bloco_min: Number(fr.bloco_min.value), max_blocos: Number(fr.max_blocos.value), antecedencia_min: Number(fr.antecedencia_min.value),
        janela_dias: num('janela_dias', 1, 180), limite_ativas: num('limite_ativas', 0, 10),
        prazo_cancelamento_h: num('prazo_cancelamento_h', 0, 72), faltas_bloqueio: num('faltas_bloqueio', 0, 10)
      };
      const errado = Object.keys(dados).find((k) => isNaN(dados[k]));
      if (errado) { toast('Confira o campo "' + $('label[for="rg-' + errado + '"]', fr).textContent + '".', 'erro'); return; }
      if (dados.bloco_min !== cfg().bloco_min) {
        const resp = await confirmar({ titulo: 'Mudar a duração do horário?', html: '<p>A grade da agenda muda para horários de ' + duracaoTexto(dados.bloco_min) + '. Reservas já feitas continuam valendo, mas confira os horários fixos e os horários de funcionamento.</p>', botao: 'Mudar' });
        if (!resp.ok) return;
      }
      await salvarConfig(dados, 'Regras salvas.');
    });

    const fp = $('[data-form-preco]', el);
    fp.addEventListener('submit', async (e) => {
      e.preventDefault();
      const preco = (v) => (v === '' ? null : Number(v));
      const dados = {
        preco_hora: preco(fp.preco_hora.value), preco_nobre: preco(fp.preco_nobre.value), nobre_inicio: fp.nobre_inicio.value || null,
        nobre_fds: fp.nobre_fds.checked, modalidades: fp.modalidades.value.split(',').map((x) => x.trim()).filter(Boolean).slice(0, 8)
      };
      if ([dados.preco_hora, dados.preco_nobre].some((v) => v != null && (isNaN(v) || v < 0))) { toast('Valor inválido.', 'erro'); return; }
      if (!dados.modalidades.length) dados.modalidades = ['Futevôlei', 'Vôlei de areia'];
      await salvarConfig(dados, 'Preço salvo.');
    });
  }
  async function salvarConfig(dados, mensagem) {
    try {
      await A.admin.configuracoes.salvar(dados);
      await carregarBase();
      toast(mensagem, 'ok');
      renderSecao(est.secao);
      return true;
    } catch (e) { falha(e); return false; }
  }

  /* ==================== 7. Clientes ==================== */
  async function renderClientes() {
    const el = corpo('clientes');
    el.innerHTML = '<div class="toolbar"><div class="busca-adm"><input type="search" placeholder="Buscar nome ou WhatsApp" aria-label="Buscar cliente" value="' + esc(est.buscaClientes) + '" data-busca-clientes></div></div><div data-lista-clientes><div class="esqueleto esqueleto--dias"></div></div>';
    const [hist, bloqueados] = await Promise.all([A.admin.reservas.historico(), A.admin.bloqueados.listar()]);
    const limiteFaltas = cfg().faltas_bloqueio;
    const seisMeses = Date.now() - 180 * 86400000;
    const mapa = new Map();
    hist.slice().sort((a, b) => String(b.inicio).localeCompare(String(a.inicio))).forEach((r) => {
      const w = r.cliente_whatsapp;
      if (!w) return;
      const c = mapa.get(w) || { whatsapp: w, nome: r.cliente_nome, total: 0, jogos: 0, faltas: 0, faltasRecentes: [], canceladas: 0, ultima: null, proxima: null };
      c.total++;
      if (r.status === 'concluida' || (r.status === 'confirmada' && !futura(r))) c.jogos++;
      if (r.status === 'falta') { c.faltas++; if (new Date(r.inicio).getTime() >= seisMeses) c.faltasRecentes.push(r); }
      if (r.status === 'cancelada') c.canceladas++;
      if (comecou(r) && r.status !== 'cancelada' && (!c.ultima || r.inicio > c.ultima)) c.ultima = r.inicio;
      if (ativa(r) && futura(r) && (!c.proxima || r.inicio < c.proxima)) c.proxima = r.inicio;
      mapa.set(w, c);
    });
    bloqueados.forEach((b) => {
      const c = mapa.get(b.whatsapp) || { whatsapp: b.whatsapp, nome: b.nome || 'Sem nome', total: 0, jogos: 0, faltas: 0, faltasRecentes: [], canceladas: 0, ultima: null, proxima: null };
      c.bloqueio = b;
      mapa.set(b.whatsapp, c);
    });
    const clientes = Array.from(mapa.values()).map((c) => Object.assign(c, { suspensoFaltas: limiteFaltas > 0 && c.faltasRecentes.length >= limiteFaltas }))
      .sort((a, b) => String(b.ultima || b.proxima || '').localeCompare(String(a.ultima || a.proxima || '')));
    const busca = $('[data-busca-clientes]', el);
    function desenhar() {
      const termo = est.buscaClientes.trim().toLowerCase();
      const dig = termo.replace(/\D/g, '');
      const lista = !termo ? clientes : clientes.filter((c) => String(c.nome).toLowerCase().includes(termo) || (dig.length >= 4 && c.whatsapp.includes(dig)));
      const area = $('[data-lista-clientes]', el);
      if (!lista.length) { area.innerHTML = '<p class="vazio">' + (termo ? 'Ninguém encontrado.' : 'Os clientes aparecem aqui depois das primeiras reservas.') + '</p>'; return; }
      area.innerHTML = '<div class="tabela-rolagem"><table class="tabela"><thead><tr><th scope="col">Cliente</th><th scope="col">Reservas</th><th scope="col">Jogou</th><th scope="col">Faltas</th><th scope="col">Última vez</th><th scope="col">Próxima</th><th scope="col">Situação</th><th scope="col">Ações</th></tr></thead><tbody>' +
        lista.map((c) => {
          const suspenso = c.bloqueio || c.suspensoFaltas;
          return '<tr><td><b>' + esc(c.nome) + '</b><br><a href="' + esc(linkWhats(c.whatsapp, 'Olá, ' + primeiroNome(c.nome) + '! Aqui é da Arena Esporte.')) + '" target="_blank" rel="noopener noreferrer">' + esc(R.formatarWhatsapp(c.whatsapp)) + '</a></td>' +
            '<td class="num">' + c.total + '</td><td class="num">' + c.jogos + '</td><td class="num">' + c.faltas + '</td>' +
            '<td>' + (c.ultima ? esc(R.dataCurta(R.isoParaLocal(c.ultima).data)) : 'Ainda não') + '</td>' +
            '<td>' + (c.proxima ? esc(R.dataCurta(R.isoParaLocal(c.proxima).data)) : 'Nenhuma') + '</td>' +
            '<td>' + (suspenso ? '<span class="selo selo--cancelada">Suspenso</span><br><small>' + esc(c.bloqueio ? (c.bloqueio.motivo || 'Pela arena') : c.faltasRecentes.length + ' faltas') + '</small>' : '<span class="selo selo--confirmada">Liberado</span>') + '</td>' +
            '<td>' + (suspenso ? '<button class="btn btn--sm btn--ghost" type="button" data-liberar="' + esc(c.whatsapp) + '">Liberar</button>' : '<button class="btn btn--sm btn--ghost" type="button" data-suspender="' + esc(c.whatsapp) + '">Suspender</button>') + '</td></tr>';
        }).join('') + '</tbody></table></div>';
      $$('[data-suspender]', area).forEach((b) => b.addEventListener('click', async () => {
        const c = mapa.get(b.getAttribute('data-suspender'));
        const resp = await confirmar({ titulo: 'Suspender ' + c.nome + '?', html: '<p>Esse WhatsApp não consegue mais reservar pelo site. Você ainda pode lançar reservas para ele no painel.</p>', campo: 'texto', rotulo: 'Motivo (só a arena vê)', botao: 'Suspender', perigo: true });
        if (!resp.ok) return;
        try { await A.admin.bloqueados.salvar({ whatsapp: c.whatsapp, nome: c.nome, motivo: resp.valor }); toast(c.nome + ' suspenso.', 'ok'); renderClientes(); } catch (e) { falha(e); }
      }));
      $$('[data-liberar]', area).forEach((b) => b.addEventListener('click', async () => {
        const c = mapa.get(b.getAttribute('data-liberar'));
        const resp = await confirmar({ titulo: 'Liberar ' + c.nome + '?', html: '<p>Volta a poder reservar pelo site.' + (c.suspensoFaltas ? ' As ' + c.faltasRecentes.length + ' faltas recentes ficam registradas como "falta perdoada".' : '') + '</p>', botao: 'Liberar' });
        if (!resp.ok) return;
        try {
          if (c.bloqueio) await A.admin.bloqueados.excluir(c.whatsapp);
          if (c.suspensoFaltas) for (const r of c.faltasRecentes) await A.admin.reservas.status(r, 'cancelada', { motivo_cancelamento: 'Falta perdoada pela arena', cancelado_por: 'arena' });
          toast(c.nome + ' liberado.', 'ok');
          renderClientes();
        } catch (e) { falha(e); }
      }));
    }
    busca.addEventListener('input', () => { est.buscaClientes = busca.value; desenhar(); });
    desenhar();
  }

  /* ==================== 8. Contatos e aviso ==================== */
  function renderContatos() {
    const el = corpo('contatos');
    const c = cfg();
    el.innerHTML =
      '<form class="bloco" data-form-contatos novalidate>' +
        '<h2 class="bloco__titulo">Contatos</h2>' +
        '<div class="form-grid form-grid--2">' +
          '<div class="campo"><label for="ct-whats">WhatsApp da arena</label><input id="ct-whats" name="whatsapp" type="tel" inputmode="tel" value="' + esc(R.formatarWhatsapp(c.whatsapp)) + '" required></div>' +
          '<div class="campo"><label for="ct-insta">Instagram (link)</label><input id="ct-insta" name="instagram_url" type="url" value="' + esc(c.instagram_url || '') + '"></div>' +
        '</div>' +
        '<div class="campo"><label for="ct-msg">Mensagem padrão do WhatsApp</label><input id="ct-msg" name="mensagem_whatsapp" type="text" maxlength="160" value="' + esc(c.mensagem_whatsapp || '') + '"></div>' +
        '<div class="campo"><label for="ct-end">Endereço (rodapé e página de reserva)</label><input id="ct-end" name="endereco" type="text" maxlength="200" value="' + esc(c.endereco || '') + '"></div>' +
        '<div class="campo"><label for="ct-maps">Link do Google Maps</label><input id="ct-maps" name="maps_url" type="url" value="' + esc(c.maps_url || '') + '"></div>' +
        '<h2 class="bloco__titulo mt-5">Faixa de aviso no topo do site</h2>' +
        '<label class="campo--check"><input type="checkbox" name="aviso_ativo"' + (c.aviso_ativo ? ' checked' : '') + '> Mostrar a faixa</label>' +
        '<div class="form-grid form-grid--2">' +
          '<div class="campo"><label for="ct-aviso">Texto</label><input id="ct-aviso" name="aviso_texto" type="text" maxlength="140" value="' + esc(c.aviso_texto || '') + '" placeholder="Ex.: Sábado tem torneio, quadras fechadas à tarde"></div>' +
          '<div class="campo"><label for="ct-link">Link (opcional)</label><input id="ct-link" name="aviso_link" type="url" value="' + esc(c.aviso_link || '') + '"></div>' +
        '</div>' +
        '<h2 class="bloco__titulo mt-5">Pix (opcional)</h2>' +
        '<p class="bloco__sub">O padrão é pagar na arena. Ligado, o cliente vê o Pix copia e cola depois de reservar, para adiantar se quiser.</p>' +
        '<label class="campo--check"><input type="checkbox" name="pix_ativo"' + (c.pix_ativo ? ' checked' : '') + '> Mostrar o Pix para o cliente</label>' +
        '<div class="form-grid form-grid--3">' +
          '<div class="campo"><label for="ct-chave">Chave Pix</label><input id="ct-chave" name="pix_chave" type="text" maxlength="77" value="' + esc(c.pix_chave || '') + '"></div>' +
          '<div class="campo"><label for="ct-nome">Nome do recebedor</label><input id="ct-nome" name="pix_nome" type="text" maxlength="25" value="' + esc(c.pix_nome || '') + '"></div>' +
          '<div class="campo"><label for="ct-cidade">Cidade do recebedor</label><input id="ct-cidade" name="pix_cidade" type="text" maxlength="15" value="' + esc(c.pix_cidade || '') + '"></div>' +
        '</div>' +
        '<div class="bloco__acoes"><button class="btn btn--primary" type="submit">' + ICONE('i-check') + ' Salvar contatos</button></div>' +
      '</form>';
    const f = $('[data-form-contatos]', el);
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!R.whatsappValido(f.whatsapp.value)) { toast(R.mensagem('WHATSAPP_INVALIDO'), 'erro'); f.whatsapp.focus(); return; }
      const url = (v) => !v || /^https?:\/\//i.test(v);
      if (![f.instagram_url.value, f.maps_url.value, f.aviso_link.value].every(url)) { toast('Os links precisam começar com https://', 'erro'); return; }
      if (f.aviso_ativo.checked && !f.aviso_texto.value.trim()) { toast('Escreva o texto da faixa de aviso.', 'erro'); return; }
      if (f.pix_ativo.checked && (!f.pix_chave.value.trim() || !f.pix_nome.value.trim())) { toast('Para ligar o Pix, preencha a chave e o nome do recebedor.', 'erro'); return; }
      await salvarConfig({
        whatsapp: R.normalizarWhatsapp(f.whatsapp.value), instagram_url: f.instagram_url.value.trim(), mensagem_whatsapp: f.mensagem_whatsapp.value.trim(),
        endereco: f.endereco.value.trim(), maps_url: f.maps_url.value.trim(), aviso_ativo: f.aviso_ativo.checked, aviso_texto: f.aviso_texto.value.trim(),
        aviso_link: f.aviso_link.value.trim(), pix_ativo: f.pix_ativo.checked, pix_chave: f.pix_chave.value.trim(), pix_nome: f.pix_nome.value.trim(),
        pix_cidade: f.pix_cidade.value.trim()
      }, 'Contatos salvos.');
    });
  }

  /* ==================== Início ==================== */
  document.addEventListener('DOMContentLoaded', async () => {
    ligarLogin();
    if (A.modo === 'supabase') A.auth.aoRecuperar(() => mostrarLogin('nova'));
    if (A.modo === 'supabase' && /type=recovery/.test(location.hash)) { mostrarLogin('nova'); return; }
    let sessao = null;
    try { sessao = await A.auth.sessao(); } catch (e) { mostrarLogin('login', A.traduzir(e).message); return; }
    if (sessao) {
      let admin = false;
      try { admin = await A.auth.ehAdmin(); } catch (e) { admin = false; }
      if (admin) { await entrarNoPainel(); return; }
      await A.auth.sair();
      mostrarLogin('login', 'Esta conta não tem acesso ao painel da arena.');
      return;
    }
    mostrarLogin('login');
  });
})();
