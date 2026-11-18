/* ============================================================
   Arena Esporte: camada de dados
   ------------------------------------------------------------
   Uma só interface (window.Arena) para o site, o app e o painel.
   - Com supabaseUrl + supabaseAnonKey em config.js: Supabase.
   - Sem eles: modo demonstração, salvo no localStorage, com as
     regras de js/regras.js fazendo o papel do banco.
   O cliente do Supabase só é baixado quando é usado.
   ============================================================ */
(function () {
  'use strict';

  const CFG = window.ARENA_CONFIG || { negocio: {} };
  const R = window.ArenaRegras;
  const SUPABASE_CDN = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js';
  const CHAVE_DEMO = 'arena-esporte-demo-v1';
  const CHAVE_MINHAS = 'arena-esporte-minhas-reservas';
  const modo = CFG.supabaseUrl && CFG.supabaseAnonKey ? 'supabase' : 'demo';

  /* ---------- Erros com código (o mesmo código que o banco manda no "hint") ---------- */
  class ErroArena extends Error {
    constructor(codigo, mensagem) {
      super(mensagem);
      this.codigo = codigo;
    }
  }
  function traduzir(e) {
    if (e instanceof ErroArena) return e;
    const porCodigo = { '23P01': 'CONFLITO_RESERVA', '42501': 'SEM_PERMISSAO', '23503': 'EM_USO', '23505': 'DUPLICADO', PGRST301: 'SESSAO_EXPIRADA' };
    const codigo = e && (e.hint || porCodigo[e.code] || '');
    let msg = e && e.message ? e.message : 'Algo deu errado. Tente de novo.';
    if (codigo === 'CONFLITO_RESERVA' && e.code === '23P01') msg = R.mensagem('CONFLITO_RESERVA');
    if (codigo === 'SEM_PERMISSAO') msg = 'Sua conta não tem permissão para isso. Entre de novo no painel.';
    if (codigo === 'EM_USO') msg = 'Esse item está ligado a reservas do histórico e não pode ser apagado. Desative em vez de excluir.';
    if (codigo === 'DUPLICADO') msg = 'Já existe um cadastro igual a esse.';
    if (codigo === 'SESSAO_EXPIRADA' || /JWT expired/i.test(msg)) msg = 'Sua sessão expirou. Entre de novo no painel.';
    if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) msg = 'Sem conexão com a internet. Confira o sinal e tente de novo.';
    return new ErroArena(codigo || 'ERRO', msg);
  }

  /* ---------- Utilidades ---------- */
  const util = {
    escapar(texto) {
      return String(texto == null ? '' : texto)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    },
    id() {
      if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
      return 'id-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
    },
    preco(valor) {
      if (valor === null || valor === undefined || valor === '' || isNaN(Number(valor))) return '';
      return Number(valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    },
    whatsapp(numero, mensagem) {
      const n = String(numero || '').replace(/\D/g, '');
      return 'https://wa.me/' + n + (mensagem ? '?text=' + encodeURIComponent(mensagem) : '');
    },
    hora(hhmm) { return String(hhmm || '').slice(0, 5); },
    // "Quinta-feira, 19 de novembro · 19h às 20h"
    quando(inicio, fim) {
      const a = R.isoParaLocal(inicio);
      const b = R.isoParaLocal(fim);
      return R.dataLonga(a.data) + ' · ' + R.horaTexto(a.min) + ' às ' + R.horaTexto(b.data === a.data ? b.min : 1440);
    },
    linkAgenda(reserva, nomeQuadra) {
      const f = (d) => new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
      const p = new URLSearchParams({
        action: 'TEMPLATE',
        text: 'Jogo na Arena Esporte · ' + (nomeQuadra || 'quadra de areia'),
        dates: f(reserva.inicio) + '/' + f(reserva.fim),
        location: (CFG.negocio && CFG.negocio.endereco) || 'Arena Esporte, São Luís de Montes Belos - GO',
        details: 'Reserva ' + (reserva.codigo || '') + '. Chegue uns 10 minutos antes.'
      });
      return 'https://calendar.google.com/calendar/render?' + p.toString();
    },
    linkReserva(token) {
      const base = location.protocol.startsWith('http') ? new URL('reserva.html', location.href).href : (CFG.siteUrl || '') + 'reserva.html';
      return base + '?t=' + encodeURIComponent(token);
    }
  };

  /* ---------- Supabase ---------- */
  let promessaCliente = null;
  function carregarScript(src) {
    return new Promise((ok, falha) => {
      const s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.onload = ok;
      s.onerror = () => falha(new ErroArena('ERRO', 'Não foi possível carregar o sistema. Confira a internet.'));
      document.head.appendChild(s);
    });
  }
  function sb() {
    if (!promessaCliente) {
      promessaCliente = (window.supabase ? Promise.resolve() : carregarScript(SUPABASE_CDN))
        .then(() => window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey));
    }
    return promessaCliente;
  }
  function checar({ data, error }) {
    if (error) throw traduzir(error);
    return data;
  }

  /* ---------- Demonstração (localStorage) ---------- */
  let memoria = null;
  function demo() {
    if (memoria) return memoria;
    try {
      const salvo = localStorage.getItem(CHAVE_DEMO);
      if (salvo) memoria = JSON.parse(salvo);
    } catch (e) { memoria = null; }
    if (!memoria) {
      memoria = JSON.parse(JSON.stringify(window.ARENA_SEED || {
        config: R.CONFIG_PADRAO, funcionamento: [], datasEspeciais: [], quadras: [], fixos: [], bloqueios: [], bloqueados: [], reservas: []
      }));
      gravar();
    }
    return memoria;
  }
  function gravar() {
    try { localStorage.setItem(CHAVE_DEMO, JSON.stringify(memoria)); }
    catch (e) { /* navegador sem armazenamento: segue só na memória */ }
  }
  window.addEventListener('storage', (ev) => {
    if (ev.key === CHAVE_DEMO) { memoria = null; cacheContexto = null; }
  });

  /* ---------- Normalização das linhas do banco ---------- */
  function normFuncionamento(l) {
    return { dia: Number(l.dia), aberto: !!l.aberto, abre: util.hora(l.abre), fecha: util.hora(l.fecha) };
  }
  function normData(l) {
    return { data: l.data, tipo: l.tipo, abre: l.abre ? util.hora(l.abre) : null, fecha: l.fecha ? util.hora(l.fecha) : null, motivo: l.motivo || '' };
  }
  function normFixo(l) {
    return Object.assign({}, l, { hora: util.hora(l.hora), datas_puladas: l.datas_puladas || [] });
  }
  function normConfig(l) {
    const c = Object.assign({}, R.CONFIG_PADRAO, l || {});
    c.nobre_inicio = c.nobre_inicio ? util.hora(c.nobre_inicio) : '';
    ['preco_hora', 'preco_nobre'].forEach((k) => { c[k] = c[k] === null || c[k] === undefined || c[k] === '' ? null : Number(c[k]); });
    const n = CFG.negocio || {};
    const usar = (v, padrao) => (v === null || v === undefined || v === '' ? padrao : v);
    c.nome = n.nome || 'Arena Esporte';
    c.whatsapp = usar(c.whatsapp, n.whatsapp);
    c.mensagem_whatsapp = usar(c.mensagem_whatsapp, n.mensagemWhatsapp);
    c.instagram_url = usar(c.instagram_url, n.instagramUrl);
    c.maps_url = usar(c.maps_url, n.mapsUrl);
    c.endereco = usar(c.endereco, n.endereco);
    c.modalidades = c.modalidades && c.modalidades.length ? c.modalidades : ['Futevôlei', 'Vôlei de areia'];
    return c;
  }

  /* ---------- Público: o que a tela de agendamento usa ---------- */
  let cacheContexto = null;
  const publico = {
    async contexto(forcar) {
      if (cacheContexto && !forcar) return cacheContexto;
      let r;
      if (modo === 'demo') {
        const d = demo();
        r = { config: d.config, funcionamento: d.funcionamento, datasEspeciais: d.datasEspeciais, quadras: d.quadras };
      } else {
        const c = await sb();
        const hoje = R.agoraLocal().data;
        const [cf, fu, de, qu] = await Promise.all([
          c.from('configuracoes').select('*').eq('id', 1).maybeSingle(),
          c.from('funcionamento').select('*').order('dia'),
          c.from('datas_especiais').select('*').gte('data', hoje).order('data'),
          c.from('quadras').select('*').order('ordem')
        ]);
        r = { config: checar(cf), funcionamento: checar(fu), datasEspeciais: checar(de), quadras: checar(qu) };
      }
      cacheContexto = {
        config: normConfig(r.config),
        funcionamento: (r.funcionamento || []).map(normFuncionamento),
        datasEspeciais: (r.datasEspeciais || []).map(normData),
        quadras: (r.quadras || []).slice()
      };
      return cacheContexto;
    },
    // Tudo que ocupa quadra no dia, sem dados pessoais
    async ocupacao(data) {
      if (modo === 'demo') {
        const d = demo();
        return R.ocupacoesDoDia(data, d).map((o) => ({ quadra_id: o.quadra_id, inicio: o.inicio, fim: o.fim, tipo: o.tipo }));
      }
      const c = await sb();
      return checar(await c.rpc('ocupacao', { p_data: data }));
    },
    async criarReserva(p) {
      if (modo === 'demo') {
        const d = demo();
        const ctx = Object.assign({}, d, { config: normConfig(d.config) });
        const v = R.validarReserva(p, ctx, {});
        if (!v.ok) throw new ErroArena(v.erro.codigo, v.erro.mensagem);
        let codigo;
        do { codigo = R.gerarCodigo(); } while (d.reservas.some((x) => x.codigo === codigo));
        const nova = {
          id: util.id(), codigo, token: util.id(), quadra_id: p.quadra_id, inicio: v.inicio, fim: v.fim,
          cliente_nome: v.nome, cliente_whatsapp: v.whatsapp,
          jogadores: Number(p.jogadores) >= 1 && Number(p.jogadores) <= 40 ? Number(p.jogadores) : null,
          modalidade: String(p.modalidade || '').slice(0, 40), observacoes: String(p.observacoes || '').slice(0, 300),
          status: 'pendente', origem: 'site', valor: v.valor, pago: false, motivo_cancelamento: '', cancelado_por: null,
          criado_em: new Date().toISOString(), confirmado_em: null, cancelado_em: null
        };
        d.reservas.push(nova);
        gravar();
        const q = d.quadras.find((x) => x.id === p.quadra_id);
        return { codigo, token: nova.token, status: 'pendente', inicio: v.inicio, fim: v.fim, valor: v.valor, quadra: q ? q.nome : '', quadra_id: p.quadra_id };
      }
      const c = await sb();
      return checar(await c.rpc('criar_reserva', {
        p_quadra: p.quadra_id, p_data: p.data, p_hora: p.hora, p_blocos: Number(p.blocos || 1),
        p_nome: p.nome, p_whatsapp: p.whatsapp,
        p_jogadores: p.jogadores ? Number(p.jogadores) : null,
        p_modalidade: p.modalidade || '', p_observacoes: p.observacoes || ''
      }));
    },
    async minhaReserva(token) {
      if (!token) return null;
      if (modo === 'demo') {
        const d = demo();
        const r = d.reservas.find((x) => x.token === token);
        if (!r) return null;
        const q = d.quadras.find((x) => x.id === r.quadra_id);
        return Object.assign({}, r, { quadra: q ? q.nome : '' });
      }
      if (!/^[0-9a-f-]{36}$/i.test(token)) return null;
      const c = await sb();
      return checar(await c.rpc('minha_reserva', { p_token: token }));
    },
    async cancelarReserva(token) {
      if (modo === 'demo') {
        const d = demo();
        const r = d.reservas.find((x) => x.token === token);
        if (!r) throw new ErroArena('RESERVA_NAO_ENCONTRADA', 'Reserva não encontrada.');
        const pode = R.podeCancelar(r, { config: normConfig(d.config) });
        if (!pode.pode) throw new ErroArena('PRAZO_CANCELAMENTO', pode.motivo);
        Object.assign(r, { status: 'cancelada', cancelado_por: 'cliente', cancelado_em: new Date().toISOString(), motivo_cancelamento: 'Cancelada pelo cliente no site' });
        gravar();
        return publico.minhaReserva(token);
      }
      const c = await sb();
      return checar(await c.rpc('cancelar_minha_reserva', { p_token: token }));
    },
    async buscarReserva(codigo, whatsapp) {
      const limpo = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (modo === 'demo') {
        const w = R.normalizarWhatsapp(whatsapp);
        const r = demo().reservas.find((x) => limpo(x.codigo) === limpo(codigo) && x.cliente_whatsapp === w);
        return r ? r.token : null;
      }
      const c = await sb();
      return checar(await c.rpc('buscar_reserva', { p_codigo: codigo, p_whatsapp: whatsapp }));
    }
  };

  /* ---------- Reservas guardadas neste aparelho (o "app" lembra do cliente) ---------- */
  const aparelho = {
    listar() {
      try { return JSON.parse(localStorage.getItem(CHAVE_MINHAS) || '[]'); } catch (e) { return []; }
    },
    guardar(item) {
      const lista = aparelho.listar().filter((x) => x.token !== item.token);
      lista.unshift(item);
      try { localStorage.setItem(CHAVE_MINHAS, JSON.stringify(lista.slice(0, 10))); } catch (e) { /* sem armazenamento */ }
    },
    remover(token) {
      try { localStorage.setItem(CHAVE_MINHAS, JSON.stringify(aparelho.listar().filter((x) => x.token !== token))); } catch (e) { /* sem armazenamento */ }
    },
    cliente() {
      try { return JSON.parse(localStorage.getItem(CHAVE_MINHAS + '-cliente') || 'null'); } catch (e) { return null; }
    },
    lembrarCliente(dados) {
      try { localStorage.setItem(CHAVE_MINHAS + '-cliente', JSON.stringify(dados)); } catch (e) { /* sem armazenamento */ }
    }
  };

  /* ---------- Painel (só ADM) ---------- */
  function crudDemo(chave) {
    return {
      async listar() { return demo()[chave].slice(); },
      async salvar(item) {
        const lista = demo()[chave];
        if (item.id) {
          const i = lista.findIndex((x) => x.id === item.id);
          if (i >= 0) { lista[i] = Object.assign({}, lista[i], item); gravar(); return lista[i]; }
        }
        const novo = Object.assign({}, item, { id: util.id() });
        lista.push(novo);
        gravar();
        return novo;
      },
      async excluir(item) {
        demo()[chave] = demo()[chave].filter((x) => x.id !== item.id);
        gravar();
      }
    };
  }
  function crudSupabase(tabela, ordem, norm) {
    const n = norm || ((x) => x);
    return {
      async listar() {
        const c = await sb();
        return checar(await c.from(tabela).select('*').order(ordem)).map(n);
      },
      async salvar(item) {
        const c = await sb();
        const linha = Object.assign({}, item);
        delete linha.criado_em;
        if (item.id) {
          const id = linha.id;
          delete linha.id;
          return n(checar(await c.from(tabela).update(linha).eq('id', id).select().single()));
        }
        delete linha.id;
        return n(checar(await c.from(tabela).insert(linha).select().single()));
      },
      async excluir(item) {
        const c = await sb();
        checar(await c.from(tabela).delete().eq('id', item.id));
      }
    };
  }

  // Ao criar/remarcar pelo painel, o demo faz o papel do gatilho do banco
  function validarDemoAdmin(r) {
    const d = demo();
    const a = R.isoParaLocal(r.inicio);
    const blocos = Math.round((new Date(r.fim) - new Date(r.inicio)) / 60000 / normConfig(d.config).bloco_min);
    const v = R.validarReserva({ id: r.id, quadra_id: r.quadra_id, data: a.data, hora: R.minParaHhmm(a.min), blocos, nome: r.cliente_nome, whatsapp: r.cliente_whatsapp },
      Object.assign({}, d, { config: normConfig(d.config) }), { admin: true, semCliente: true });
    if (!v.ok) throw new ErroArena(v.erro.codigo, v.erro.mensagem);
  }

  const reservasAdmin = {
    // Reservas entre duas datas locais (inclusive)
    async listar(de, ate) {
      const ini = R.localParaIso(de, 0);
      const fim = R.localParaIso(ate, 1440);
      if (modo === 'demo') {
        return demo().reservas.filter((r) => r.inicio < fim && r.fim > ini)
          .sort((a, b) => a.inicio.localeCompare(b.inicio));
      }
      const c = await sb();
      return checar(await c.from('reservas').select('*').lt('inicio', fim).gt('fim', ini).order('inicio'));
    },
    async pendentes() {
      if (modo === 'demo') return demo().reservas.filter((r) => r.status === 'pendente').sort((a, b) => a.inicio.localeCompare(b.inicio));
      const c = await sb();
      return checar(await c.from('reservas').select('*').eq('status', 'pendente').order('inicio'));
    },
    async doCliente(whatsapp) {
      const w = R.normalizarWhatsapp(whatsapp);
      if (modo === 'demo') return demo().reservas.filter((r) => r.cliente_whatsapp === w).sort((a, b) => b.inicio.localeCompare(a.inicio));
      const c = await sb();
      return checar(await c.from('reservas').select('*').eq('cliente_whatsapp', w).order('inicio', { ascending: false }).limit(100));
    },
    async salvar(r) {
      const linha = {
        quadra_id: r.quadra_id, inicio: r.inicio, fim: r.fim, cliente_nome: R.limparNome(r.cliente_nome),
        cliente_whatsapp: r.cliente_whatsapp ? R.normalizarWhatsapp(r.cliente_whatsapp) : '',
        jogadores: r.jogadores ? Number(r.jogadores) : null, modalidade: r.modalidade || '',
        observacoes: r.observacoes || '', valor: r.valor === '' || r.valor == null ? null : Number(r.valor),
        pago: !!r.pago, status: r.status || 'confirmada'
      };
      if (modo === 'demo') {
        const d = demo();
        if (r.id) {
          const atual = d.reservas.find((x) => x.id === r.id);
          const mudou = atual.inicio !== linha.inicio || atual.fim !== linha.fim || atual.quadra_id !== linha.quadra_id ||
            (R.ATIVOS.includes(linha.status) && !R.ATIVOS.includes(atual.status));
          if (mudou && R.ATIVOS.includes(linha.status)) validarDemoAdmin(Object.assign({}, atual, linha));
          if (linha.status === 'confirmada' && atual.status !== 'confirmada') linha.confirmado_em = new Date().toISOString();
          Object.assign(atual, linha);
          gravar();
          return atual;
        }
        const nova = Object.assign({ id: util.id(), token: util.id(), origem: 'painel', criado_em: new Date().toISOString(), motivo_cancelamento: '', cancelado_por: null }, linha);
        validarDemoAdmin(nova);
        do { nova.codigo = R.gerarCodigo(); } while (d.reservas.some((x) => x.codigo === nova.codigo));
        if (nova.status === 'confirmada') nova.confirmado_em = new Date().toISOString();
        d.reservas.push(nova);
        gravar();
        return nova;
      }
      const c = await sb();
      if (r.id) return checar(await c.from('reservas').update(linha).eq('id', r.id).select().single());
      linha.origem = 'painel';
      let ultimo;
      for (let i = 0; i < 4; i++) {
        linha.codigo = R.gerarCodigo();
        const res = await c.from('reservas').insert(linha).select().single();
        if (!res.error) return res.data;
        ultimo = res.error;
        if (!(res.error.code === '23505' && /codigo/.test(res.error.message))) break;
      }
      throw traduzir(ultimo);
    },
    async status(r, status, extra) {
      const linha = Object.assign({ status }, extra || {});
      if (status === 'cancelada') linha.cancelado_por = linha.cancelado_por || 'arena';
      if (modo === 'demo') {
        const atual = demo().reservas.find((x) => x.id === r.id);
        if (R.ATIVOS.includes(status) && !R.ATIVOS.includes(atual.status)) validarDemoAdmin(Object.assign({}, atual, { status }));
        if (status === 'confirmada' && !atual.confirmado_em) linha.confirmado_em = new Date().toISOString();
        if (status === 'cancelada') linha.cancelado_em = new Date().toISOString();
        Object.assign(atual, linha);
        gravar();
        return atual;
      }
      const c = await sb();
      return checar(await c.from('reservas').update(linha).eq('id', r.id).select().single());
    },
    // Lista para a tela de clientes (últimos 12 meses)
    async historico() {
      const desde = new Date(Date.now() - 365 * 86400000).toISOString();
      if (modo === 'demo') return demo().reservas.filter((r) => r.inicio >= desde);
      const c = await sb();
      return checar(await c.from('reservas').select('id, codigo, quadra_id, cliente_nome, cliente_whatsapp, status, inicio, fim, valor').gte('inicio', desde).order('inicio', { ascending: false }).limit(5000));
    }
  };

  const admin = {
    reservas: reservasAdmin,
    fixos: modo === 'demo' ? crudDemo('fixos') : crudSupabase('horarios_fixos', 'dia_semana', normFixo),
    bloqueios: modo === 'demo' ? crudDemo('bloqueios') : crudSupabase('bloqueios', 'inicio'),
    quadras: modo === 'demo' ? Object.assign(crudDemo('quadras'), {
      async excluir(item) {
        if (demo().reservas.some((r) => r.quadra_id === item.id)) throw traduzir({ code: '23503', message: '' });
        demo().quadras = demo().quadras.filter((x) => x.id !== item.id);
        demo().fixos = demo().fixos.filter((x) => x.quadra_id !== item.id);
        demo().bloqueios = demo().bloqueios.filter((x) => x.quadra_id !== item.id);
        gravar();
      }
    }) : crudSupabase('quadras', 'ordem'),
    datas: {
      async listar() {
        if (modo === 'demo') return demo().datasEspeciais.slice().sort((a, b) => a.data.localeCompare(b.data));
        const c = await sb();
        return checar(await c.from('datas_especiais').select('*').order('data')).map(normData);
      },
      async salvar(item) {
        const linha = { data: item.data, tipo: item.tipo, abre: item.tipo === 'horario' ? item.abre : null, fecha: item.tipo === 'horario' ? item.fecha : null, motivo: item.motivo || '' };
        if (modo === 'demo') {
          const lista = demo().datasEspeciais;
          const i = lista.findIndex((x) => x.data === item.data);
          if (i >= 0) lista[i] = linha; else lista.push(linha);
          gravar();
          return linha;
        }
        const c = await sb();
        return normData(checar(await c.from('datas_especiais').upsert(linha).select().single()));
      },
      async excluir(item) {
        if (modo === 'demo') {
          demo().datasEspeciais = demo().datasEspeciais.filter((x) => x.data !== item.data);
          gravar();
          return;
        }
        const c = await sb();
        checar(await c.from('datas_especiais').delete().eq('data', item.data));
      }
    },
    funcionamento: {
      async salvar(lista) {
        const linhas = lista.map((f) => ({ dia: f.dia, aberto: !!f.aberto, abre: f.abre, fecha: f.fecha }));
        if (modo === 'demo') { demo().funcionamento = linhas; gravar(); return; }
        const c = await sb();
        checar(await c.from('funcionamento').upsert(linhas));
      }
    },
    configuracoes: {
      async salvar(dados) {
        const permitidos = ['whatsapp', 'mensagem_whatsapp', 'instagram_url', 'maps_url', 'endereco', 'aviso_ativo', 'aviso_texto', 'aviso_link',
          'bloco_min', 'max_blocos', 'antecedencia_min', 'janela_dias', 'limite_ativas', 'prazo_cancelamento_h', 'faltas_bloqueio',
          'preco_hora', 'preco_nobre', 'nobre_inicio', 'nobre_fds', 'modalidades', 'pix_ativo', 'pix_chave', 'pix_nome', 'pix_cidade'];
        const linha = { id: 1 };
        permitidos.forEach((k) => { if (k in dados) linha[k] = dados[k]; });
        if ('nobre_inicio' in linha && !linha.nobre_inicio) linha.nobre_inicio = null;
        if (modo === 'demo') { demo().config = Object.assign({}, demo().config, linha); gravar(); cacheContexto = null; return; }
        const c = await sb();
        checar(await c.from('configuracoes').upsert(linha));
        cacheContexto = null;
      }
    },
    bloqueados: {
      async listar() {
        if (modo === 'demo') return demo().bloqueados.slice();
        const c = await sb();
        return checar(await c.from('clientes_bloqueados').select('*').order('criado_em', { ascending: false }));
      },
      async salvar(item) {
        const linha = { whatsapp: R.normalizarWhatsapp(item.whatsapp), nome: item.nome || '', motivo: item.motivo || '' };
        if (modo === 'demo') {
          const lista = demo().bloqueados.filter((x) => x.whatsapp !== linha.whatsapp);
          lista.push(Object.assign({ criado_em: new Date().toISOString() }, linha));
          demo().bloqueados = lista;
          gravar();
          return;
        }
        const c = await sb();
        checar(await c.from('clientes_bloqueados').upsert(linha));
      },
      async excluir(whatsapp) {
        const w = R.normalizarWhatsapp(whatsapp);
        if (modo === 'demo') { demo().bloqueados = demo().bloqueados.filter((x) => x.whatsapp !== w); gravar(); return; }
        const c = await sb();
        checar(await c.from('clientes_bloqueados').delete().eq('whatsapp', w));
      }
    },
    // Tudo que as regras precisam para avisar conflito antes de salvar
    async contexto(de, ate) {
      const base = await publico.contexto(true);
      const [fixos, bloqueios, reservas] = await Promise.all([admin.fixos.listar(), admin.bloqueios.listar(), reservasAdmin.listar(de, ate)]);
      let datasEspeciais = base.datasEspeciais;
      if (modo === 'supabase') datasEspeciais = await admin.datas.listar();
      return Object.assign({}, base, { fixos: fixos.map(normFixo), bloqueios, reservas, datasEspeciais });
    },
    // Avisa quando chega reserva nova: tempo real no Supabase, evento entre abas no demo
    assinar(aoMudar) {
      if (modo === 'demo') {
        const h = (ev) => { if (ev.key === CHAVE_DEMO) aoMudar(); };
        window.addEventListener('storage', h);
        return () => window.removeEventListener('storage', h);
      }
      let canal = null;
      sb().then((c) => {
        canal = c.channel('reservas-painel')
          .on('postgres_changes', { event: '*', schema: 'public', table: 'reservas' }, () => aoMudar())
          .subscribe();
      }).catch(() => { /* sem tempo real: o painel atualiza sozinho a cada minuto */ });
      return () => { if (canal) sb().then((c) => c.removeChannel(canal)); };
    }
  };

  /* ---------- Login do painel (obrigatório, inclusive no modo demonstração) ---------- */
  const CHAVE_SESSAO_DEMO = 'arena-esporte-sessao-demo';
  const CHAVE_TENTATIVAS = 'arena-esporte-tentativas-login';
  const MAX_TENTATIVAS = 5;
  const ESPERA_MS = 60000;

  function lerTentativas() {
    try { return JSON.parse(sessionStorage.getItem(CHAVE_TENTATIVAS) || '{"n":0,"ate":0}'); } catch (e) { return { n: 0, ate: 0 }; }
  }
  function gravarTentativas(t) {
    try { sessionStorage.setItem(CHAVE_TENTATIVAS, JSON.stringify(t)); } catch (e) { /* sem armazenamento */ }
  }
  function conferirTrava() {
    const t = lerTentativas();
    if (t.ate > Date.now()) {
      const s = Math.ceil((t.ate - Date.now()) / 1000);
      throw new ErroArena('LOGIN_TRAVADO', 'Muitas tentativas erradas. Espere ' + s + ' segundos e tente de novo.');
    }
  }
  function registrarFalha() {
    const t = lerTentativas();
    t.n = (t.ate && t.ate <= Date.now() ? 0 : t.n) + 1;
    t.ate = t.n >= MAX_TENTATIVAS ? Date.now() + ESPERA_MS : 0;
    if (t.ate) t.n = 0;
    gravarTentativas(t);
  }

  const auth = {
    async sessao() {
      if (modo === 'demo') {
        try {
          const s = JSON.parse(sessionStorage.getItem(CHAVE_SESSAO_DEMO) || 'null');
          return s && s.expira > Date.now() ? { user: { email: s.email } } : null;
        } catch (e) { return null; }
      }
      const c = await sb();
      const { data } = await c.auth.getSession();
      return data.session;
    },
    async entrar(email, senha) {
      conferirTrava();
      const e = String(email || '').trim().toLowerCase();
      if (!e || !senha) throw new ErroArena('LOGIN', 'Preencha o e-mail e a senha.');
      if (modo === 'demo') {
        const d = CFG.demoAdmin || {};
        if (e !== String(d.email || '').toLowerCase() || senha !== d.senha) {
          registrarFalha();
          throw new ErroArena('LOGIN', 'E-mail ou senha incorretos.');
        }
        try { sessionStorage.setItem(CHAVE_SESSAO_DEMO, JSON.stringify({ email: e, expira: Date.now() + 8 * 3600000 })); } catch (x) { /* sem armazenamento */ }
        gravarTentativas({ n: 0, ate: 0 });
        return;
      }
      const c = await sb();
      const { error } = await c.auth.signInWithPassword({ email: e, password: senha });
      if (error) {
        registrarFalha();
        throw new ErroArena('LOGIN', error.message === 'Invalid login credentials' ? 'E-mail ou senha incorretos.' : traduzir(error).message);
      }
      gravarTentativas({ n: 0, ate: 0 });
    },
    async sair() {
      if (modo === 'demo') {
        try { sessionStorage.removeItem(CHAVE_SESSAO_DEMO); } catch (e) { /* sem armazenamento */ }
        return;
      }
      const c = await sb();
      await c.auth.signOut();
    },
    async ehAdmin() {
      if (modo === 'demo') return !!(await auth.sessao());
      const c = await sb();
      const { data } = await c.auth.getUser();
      if (!data || !data.user) return false;
      const r = await c.from('admins').select('user_id').eq('user_id', data.user.id).maybeSingle();
      return !!(r.data && !r.error);
    },
    // "Esqueci minha senha": o Supabase manda um link para o e-mail, que volta para admin.html
    async recuperarSenha(email) {
      if (modo === 'demo') throw new ErroArena('DEMO', 'No modo demonstração a senha fica em js/config.js (demoAdmin).');
      const c = await sb();
      const volta = new URL('admin.html', location.href).href;
      const { error } = await c.auth.resetPasswordForEmail(String(email || '').trim(), { redirectTo: volta });
      if (error) throw traduzir(error);
    },
    async novaSenha(senha) {
      if (String(senha || '').length < 8) throw new ErroArena('SENHA_CURTA', 'A senha precisa ter pelo menos 8 caracteres.');
      const c = await sb();
      const { error } = await c.auth.updateUser({ password: senha });
      if (error) throw traduzir(error);
    },
    // Avisa quando o usuário chega pelo link de recuperação de senha
    async aoRecuperar(callback) {
      if (modo === 'demo') return;
      const c = await sb();
      c.auth.onAuthStateChange((evento) => { if (evento === 'PASSWORD_RECOVERY') callback(); });
    },
    resetarDemo() {
      try { localStorage.removeItem(CHAVE_DEMO); } catch (e) { /* sem acesso ao storage */ }
      memoria = null;
      cacheContexto = null;
    }
  };

  window.Arena = { modo, config: CFG, R, util, ErroArena, traduzir, publico, aparelho, admin, auth };
})();
