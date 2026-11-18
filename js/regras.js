/* ============================================================
   Arena Esporte: regras de negócio do agendamento
   ------------------------------------------------------------
   Funções puras (sem tela e sem banco). Usadas:
   - na tela de agendamento, para mostrar só o que pode ser marcado;
   - no painel, para avisar conflitos antes de salvar;
   - no modo demonstração, fazendo o papel do banco.
   Com o Supabase ligado, o banco repete estas mesmas checagens
   (supabase/schema.sql), então ninguém fura a regra pelo navegador.

   Fuso: horário de Brasília fixo (UTC-3). Goiás não tem horário de
   verão desde 2019. Se voltar a ter, ajuste OFFSET_MIN.
   ============================================================ */
(function (raiz) {
  'use strict';

  const OFFSET_MIN = -180;
  const MS_MIN = 60000;
  const MS_DIA = 86400000;
  const ATIVOS = ['pendente', 'confirmada'];
  const ALFABETO_CODIGO = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
  const DIAS_CURTOS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
  const DIAS_PLURAL = ['aos domingos', 'às segundas', 'às terças', 'às quartas', 'às quintas', 'às sextas', 'aos sábados'];
  const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  const MESES_CURTOS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

  // DDDs válidos no Brasil (Anatel)
  const DDDS = new Set([
    11, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 24, 27, 28, 31, 32, 33, 34, 35, 37, 38,
    41, 42, 43, 44, 45, 46, 47, 48, 49, 51, 53, 54, 55, 61, 62, 63, 64, 65, 66, 67, 68, 69,
    71, 73, 74, 75, 77, 79, 81, 82, 83, 84, 85, 86, 87, 88, 89, 91, 92, 93, 94, 95, 96, 97, 98, 99
  ]);

  const CONFIG_PADRAO = {
    bloco_min: 60,              // cada horário dura 60 min
    max_blocos: 2,              // o cliente pode pegar até 2 horários seguidos
    antecedencia_min: 60,       // reserva online até 1h antes do início
    janela_dias: 30,            // agenda aberta para os próximos 30 dias
    limite_ativas: 1,           // reservas futuras ao mesmo tempo por WhatsApp
    prazo_cancelamento_h: 3,    // cliente cancela pelo link até 3h antes
    faltas_bloqueio: 2,         // faltas sem aviso que travam a reserva online (0 = desliga)
    preco_hora: null,
    preco_nobre: null,
    nobre_inicio: '',
    nobre_fds: false
  };

  const STATUS = {
    pendente: { texto: 'Aguardando confirmação', curto: 'Pendente' },
    confirmada: { texto: 'Confirmada', curto: 'Confirmada' },
    concluida: { texto: 'Jogo realizado', curto: 'Realizada' },
    cancelada: { texto: 'Cancelada', curto: 'Cancelada' },
    falta: { texto: 'Não compareceu', curto: 'Falta' }
  };

  /* ---------- Números e textos ---------- */
  const pad = (n) => String(n).padStart(2, '0');

  // '17:00' ou '17:00:00' -> 1020. '24:00' -> 1440. Inválido -> NaN
  function hhmmParaMin(t) {
    const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(String(t == null ? '' : t).trim());
    if (!m) return NaN;
    const h = Number(m[1]);
    const mi = Number(m[2]);
    if (mi > 59 || h > 24 || (h === 24 && mi !== 0)) return NaN;
    return h * 60 + mi;
  }
  function minParaHhmm(min) {
    return pad(Math.floor(min / 60)) + ':' + pad(min % 60);
  }
  function horaTexto(min) {
    if (typeof min === 'string') min = hhmmParaMin(min);
    if (min === 0 || min === 1440) return 'meia-noite';
    const h = Math.floor(min / 60);
    const m = min % 60;
    return h + 'h' + (m ? pad(m) : '');
  }

  /* ---------- Datas (sempre 'AAAA-MM-DD' no horário de Brasília) ---------- */
  function dataValida(s) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s || ''))) return false;
    const [a, m, d] = s.split('-').map(Number);
    const t = new Date(Date.UTC(a, m - 1, d));
    return t.getUTCFullYear() === a && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
  }
  function partesData(s) { return s.split('-').map(Number); }
  // Instante (ms UTC) de uma data + minuto do dia no horário local
  function msLocal(data, min) {
    const [a, m, d] = partesData(data);
    return Date.UTC(a, m - 1, d) + (min - OFFSET_MIN) * MS_MIN;
  }
  function localParaIso(data, min) { return new Date(msLocal(data, min)).toISOString(); }
  function deslocar(ms) {
    const d = new Date(ms + OFFSET_MIN * MS_MIN);
    return { data: d.toISOString().slice(0, 10), min: d.getUTCHours() * 60 + d.getUTCMinutes() };
  }
  function isoParaLocal(iso) { return deslocar(new Date(iso).getTime()); }
  function agoraLocal(agora) {
    const ms = agora == null ? Date.now() : new Date(agora).getTime();
    return Object.assign(deslocar(ms), { ms });
  }
  function somarDias(data, n) {
    const [a, m, d] = partesData(data);
    return new Date(Date.UTC(a, m - 1, d + n)).toISOString().slice(0, 10);
  }
  function diasEntre(de, ate) {
    const [a1, m1, d1] = partesData(de);
    const [a2, m2, d2] = partesData(ate);
    return Math.round((Date.UTC(a2, m2 - 1, d2) - Date.UTC(a1, m1 - 1, d1)) / MS_DIA);
  }
  function diaDaSemana(data) {
    const [a, m, d] = partesData(data);
    return new Date(Date.UTC(a, m - 1, d)).getUTCDay();
  }
  function dataLonga(data) {
    const [, m, d] = partesData(data);
    return DIAS[diaDaSemana(data)].replace(/^./, (c) => c.toUpperCase()) +
      (diaDaSemana(data) === 0 || diaDaSemana(data) === 6 ? '' : '-feira') + ', ' + d + ' de ' + MESES[m - 1];
  }
  function dataCurta(data) {
    const [, m, d] = partesData(data);
    return pad(d) + '/' + pad(m);
  }

  /* ---------- WhatsApp e nome ---------- */
  function normalizarWhatsapp(valor) {
    let n = String(valor == null ? '' : valor).replace(/\D/g, '');
    if (n.length === 11 && n.startsWith('0')) n = n.slice(1);          // 064 9xxxx-xxxx sem o 9? deixa a validação decidir
    if (n.length === 12 && n.startsWith('0')) n = n.slice(1);          // 0 + DDD + 9 dígitos
    if (n.length === 10 || n.length === 11) n = '55' + n;
    return n;
  }
  function whatsappValido(valor) {
    const n = normalizarWhatsapp(valor);
    const m = /^55(\d{2})(\d{8,9})$/.exec(n);
    if (!m) return false;
    if (!DDDS.has(Number(m[1]))) return false;
    const numero = m[2];
    if (numero.length === 9) return numero[0] === '9';
    return /^[2-5]/.test(numero);                                       // fixo com WhatsApp Business
  }
  function formatarWhatsapp(valor) {
    const n = normalizarWhatsapp(valor);
    const m = /^55(\d{2})(\d{4,5})(\d{4})$/.exec(n);
    return m ? '(' + m[1] + ') ' + m[2] + '-' + m[3] : String(valor || '');
  }
  function limparNome(nome) {
    return String(nome == null ? '' : nome).replace(/\s+/g, ' ').trim();
  }
  function nomeValido(nome) {
    const n = limparNome(nome);
    return n.length >= 3 && n.length <= 80 && /[A-Za-zÀ-ÿ]{2}/.test(n);
  }

  /* ---------- Configuração ---------- */
  function cfg(ctx) {
    return Object.assign({}, CONFIG_PADRAO, (ctx && ctx.config) || {});
  }

  /* ---------- Horário do dia (funcionamento + feriados/datas especiais) ---------- */
  function horarioDoDia(data, ctx) {
    const especial = ((ctx && ctx.datasEspeciais) || []).find((x) => x.data === data);
    let abre;
    let fecha;
    if (especial && especial.tipo === 'fechado') {
      return { aberto: false, especial: true, motivo: especial.motivo || 'Fechado nesta data' };
    }
    if (especial && especial.tipo === 'horario') {
      abre = hhmmParaMin(especial.abre);
      fecha = hhmmParaMin(especial.fecha);
    } else {
      const dia = diaDaSemana(data);
      const f = ((ctx && ctx.funcionamento) || []).find((x) => Number(x.dia) === dia);
      if (!f || !f.aberto) return { aberto: false, especial: false, motivo: 'Fechado ' + DIAS_PLURAL[dia] };
      abre = hhmmParaMin(f.abre);
      fecha = hhmmParaMin(f.fecha);
    }
    if (fecha === 0) fecha = 1440;                                       // "00:00" = meia-noite
    if (!(abre >= 0) || !(fecha > abre)) {
      return { aberto: false, especial: !!especial, motivo: 'Horário desta data está sem configuração' };
    }
    return { aberto: true, especial: !!especial, abre, fecha, motivo: especial ? especial.motivo || '' : '' };
  }

  // Inícios possíveis do dia, alinhados à grade (ex.: 17:00, 18:00 ... 22:00)
  function gradeDoDia(data, ctx, blocos) {
    const h = horarioDoDia(data, ctx);
    if (!h.aberto) return [];
    const c = cfg(ctx);
    const dur = c.bloco_min * (blocos || 1);
    const lista = [];
    for (let ini = h.abre; ini + dur <= h.fecha; ini += c.bloco_min) lista.push(ini);
    return lista;
  }

  /* ---------- Ocupações: reservas ativas, horários fixos e bloqueios ---------- */
  function fixosDoDia(data, fixos) {
    const dia = diaDaSemana(data);
    return (fixos || []).filter((f) => f.ativo !== false &&
      Number(f.dia_semana) === dia &&
      (!f.valido_de || f.valido_de <= data) &&
      (!f.valido_ate || f.valido_ate >= data) &&
      !(f.datas_puladas || []).includes(data));
  }

  // Junta tudo que ocupa quadra num dia, no formato que o banco devolve na função ocupacao()
  function ocupacoesDoDia(data, ctx) {
    const iniDia = msLocal(data, 0);
    const fimDia = msLocal(data, 1440);
    const lista = [];
    const dentro = (ini, fim) => ini < fimDia && fim > iniDia;
    ((ctx && ctx.reservas) || []).forEach((r) => {
      if (!ATIVOS.includes(r.status)) return;
      const ini = new Date(r.inicio).getTime();
      const fim = new Date(r.fim).getTime();
      if (dentro(ini, fim)) lista.push({ quadra_id: r.quadra_id, inicio: r.inicio, fim: r.fim, tipo: 'reserva', ref: r });
    });
    fixosDoDia(data, ctx && ctx.fixos).forEach((f) => {
      const ini = hhmmParaMin(f.hora);
      lista.push({
        quadra_id: f.quadra_id, inicio: localParaIso(data, ini),
        fim: localParaIso(data, ini + Number(f.duracao_min || 60)), tipo: 'fixo', ref: f
      });
    });
    ((ctx && ctx.bloqueios) || []).forEach((b) => {
      const ini = new Date(b.inicio).getTime();
      const fim = new Date(b.fim).getTime();
      if (dentro(ini, fim)) lista.push({ quadra_id: b.quadra_id || null, inicio: b.inicio, fim: b.fim, tipo: 'bloqueio', ref: b });
    });
    return lista;
  }

  // Primeira ocupação que bate com [iniMs, fimMs) na quadra (bloqueio sem quadra vale para todas)
  function conflito(quadraId, iniMs, fimMs, ocupacoes, ignorarId) {
    return (ocupacoes || []).find((o) => {
      if (o.quadra_id && o.quadra_id !== quadraId) return false;
      if (ignorarId && o.tipo === 'reserva' && o.ref && o.ref.id === ignorarId) return false;
      return new Date(o.inicio).getTime() < fimMs && iniMs < new Date(o.fim).getTime();
    }) || null;
  }

  function quadrasReservaveis(ctx, admin) {
    return ((ctx && ctx.quadras) || [])
      .filter((q) => q.ativa !== false && (admin || q.reserva_online !== false))
      .sort((a, b) => (a.ordem || 0) - (b.ordem || 0) || String(a.nome).localeCompare(String(b.nome)));
  }

  /* ---------- Preço ---------- */
  function horarioNobre(data, ini, c) {
    const fds = diaDaSemana(data) === 0 || diaDaSemana(data) === 6;
    const inicioNobre = hhmmParaMin(c.nobre_inicio);
    return (c.nobre_fds && fds) || (inicioNobre >= 0 && ini >= inicioNobre);
  }
  function valorReserva(data, ini, blocos, ctx) {
    const c = cfg(ctx);
    const base = c.preco_hora == null || c.preco_hora === '' ? null : Number(c.preco_hora);
    if (base == null || isNaN(base)) return null;
    const nobre = c.preco_nobre == null || c.preco_nobre === '' ? base : Number(c.preco_nobre);
    let total = 0;
    for (let i = 0; i < (blocos || 1); i++) {
      const inicioBloco = ini + i * c.bloco_min;
      total += (horarioNobre(data, inicioBloco, c) ? nobre : base) * (c.bloco_min / 60);
    }
    return Math.round(total * 100) / 100;
  }

  /* ---------- Disponibilidade de um dia (o que a tela mostra) ---------- */
  // opcoes: { blocos, agora, admin, ocupacoes (se já vierem prontas do banco) }
  function disponibilidade(data, ctx, opcoes) {
    const o = opcoes || {};
    const c = cfg(ctx);
    const blocos = o.blocos || 1;
    const dia = horarioDoDia(data, ctx);
    const agora = agoraLocal(o.agora);
    const quadras = quadrasReservaveis(ctx, o.admin);
    const ocupacoes = o.ocupacoes || ocupacoesDoDia(data, ctx);
    const resultado = { data, dia, slots: [], foraDaJanela: false, passado: false };
    if (!dataValida(data)) return resultado;
    if (data < agora.data) { resultado.passado = true; return resultado; }
    if (!o.admin && diasEntre(agora.data, data) > c.janela_dias) { resultado.foraDaJanela = true; return resultado; }
    if (!dia.aberto) return resultado;
    const dur = c.bloco_min * blocos;
    gradeDoDia(data, ctx, blocos).forEach((ini) => {
      const iniMs = msLocal(data, ini);
      const fimMs = msLocal(data, ini + dur);
      let estado = 'livre';
      if (o.admin ? fimMs <= agora.ms : iniMs <= agora.ms) estado = 'passado';
      else if (!o.admin && iniMs < agora.ms + c.antecedencia_min * MS_MIN) estado = 'antecedencia';
      const lista = quadras.map((q) => {
        const oc = conflito(q.id, iniMs, fimMs, ocupacoes);
        return { id: q.id, nome: q.nome, livre: !oc, motivo: oc ? oc.tipo : null };
      });
      const livres = lista.filter((q) => q.livre).length;
      if (estado === 'livre' && !livres) estado = 'lotado';
      resultado.slots.push({
        ini, fim: ini + dur, hora: minParaHhmm(ini), horaFim: minParaHhmm(ini + dur),
        estado, livres: estado === 'livre' ? livres : 0, quadras: lista,
        valor: valorReserva(data, ini, blocos, ctx)
      });
    });
    return resultado;
  }

  // Próximos dias da janela com o resumo de cada um (para a fita de datas)
  function diasDaJanela(ctx, agora) {
    const c = cfg(ctx);
    const hoje = agoraLocal(agora).data;
    const dias = [];
    for (let i = 0; i <= c.janela_dias; i++) {
      const data = somarDias(hoje, i);
      const h = horarioDoDia(data, ctx);
      const [, m, d] = partesData(data);
      dias.push({
        data, dia: d, mes: MESES_CURTOS[m - 1], semana: DIAS_CURTOS[diaDaSemana(data)],
        rotulo: i === 0 ? 'Hoje' : i === 1 ? 'Amanhã' : DIAS_CURTOS[diaDaSemana(data)],
        aberto: h.aberto, motivo: h.motivo, especial: h.especial
      });
    }
    return dias;
  }

  /* ---------- Validação de uma reserva ---------- */
  const MENSAGENS = {
    NOME_INVALIDO: 'Escreva seu nome (pelo menos 3 letras).',
    WHATSAPP_INVALIDO: 'Confira o WhatsApp: DDD + número, como (64) 98457-9527.',
    DATA_INVALIDA: 'Essa data não existe.',
    DATA_PASSADA: 'Essa data já passou. Escolha hoje ou um dia mais pra frente.',
    FORA_DA_JANELA: 'A agenda online abre só para os próximos {janela} dias.',
    DIA_FECHADO: 'A arena não abre nesse dia.',
    HORARIO_INEXISTENTE: 'Esse horário não existe na agenda da arena.',
    FORA_DO_HORARIO: 'Esse horário passa do funcionamento da arena nesse dia.',
    DURACAO_INVALIDA: 'Dá para reservar de 1 a {max} horário(s) seguidos.',
    HORARIO_PASSADO: 'Esse horário já começou ou já passou.',
    ANTECEDENCIA: 'Pelo site, a reserva precisa de pelo menos {antecedencia} de antecedência. Para agora, chama a gente no WhatsApp.',
    QUADRA_INEXISTENTE: 'Escolha uma quadra.',
    QUADRA_INATIVA: 'Essa quadra está fora de uso no momento.',
    QUADRA_SEM_RESERVA_ONLINE: 'Essa quadra não é alugada pelo site. Fale com a arena no WhatsApp.',
    CONFLITO_RESERVA: 'Alguém acabou de pegar esse horário nessa quadra. Escolha outro.',
    CONFLITO_FIXO: 'Esse horário é de uma turma fixa nessa quadra.',
    CONFLITO_BLOQUEIO: 'Essa quadra está bloqueada nesse horário.',
    CLIENTE_BLOQUEADO: 'A reserva pelo site está suspensa para este WhatsApp. Fale com a arena.',
    LIMITE_CLIENTE: 'Você já tem {limite} reserva(s) marcada(s). Depois que jogar (ou se cancelar), pode marcar outra.',
    MUITAS_TENTATIVAS: 'Muitas reservas em pouco tempo. Espere uns minutos e tente de novo.',
    PRAZO_CANCELAMENTO: 'O cancelamento pelo site vai até {prazo}h antes do jogo. Agora, só pelo WhatsApp.'
  };
  function mensagem(codigo, ctx) {
    const c = cfg(ctx);
    const antecedencia = c.antecedencia_min % 60 === 0
      ? (c.antecedencia_min / 60) + (c.antecedencia_min === 60 ? ' hora' : ' horas')
      : c.antecedencia_min + ' minutos';
    return (MENSAGENS[codigo] || 'Não deu para concluir a reserva.')
      .replace('{janela}', c.janela_dias).replace('{max}', c.max_blocos)
      .replace('{antecedencia}', antecedencia).replace('{limite}', c.limite_ativas)
      .replace('{prazo}', c.prazo_cancelamento_h);
  }

  function faltasDoCliente(whats, reservas, agora) {
    const limite = agoraLocal(agora).ms - 180 * MS_DIA;
    return (reservas || []).filter((r) => r.status === 'falta' &&
      normalizarWhatsapp(r.cliente_whatsapp) === whats && new Date(r.inicio).getTime() >= limite).length;
  }
  function reservasAtivasDoCliente(whats, reservas, agora, ignorarId) {
    const ms = agoraLocal(agora).ms;
    return (reservas || []).filter((r) => ATIVOS.includes(r.status) && r.id !== ignorarId &&
      normalizarWhatsapp(r.cliente_whatsapp) === whats && new Date(r.fim).getTime() > ms);
  }

  /*
    pedido: { quadra_id, data, hora, blocos, nome, whatsapp, id? (remarcação) }
    ctx:    { config, funcionamento, datasEspeciais, quadras, reservas, fixos, bloqueios, bloqueados, ocupacoes? }
    opcoes: { agora, admin, semCliente }
    O admin pode: marcar sem antecedência, além da janela, em quadra fora do site,
    passar do limite do cliente e atender cliente suspenso. Conflito, dia fechado,
    horário inexistente e data passada valem para todo mundo.
  */
  function validarReserva(pedido, ctx, opcoes) {
    const o = opcoes || {};
    const c = cfg(ctx);
    const p = pedido || {};
    const erros = [];
    const erro = (codigo, campo) => { erros.push({ codigo, campo, mensagem: mensagem(codigo, ctx) }); };
    const fim = (extra) => Object.assign({ ok: !erros.length, erro: erros[0] || null, erros }, extra || {});

    const whats = normalizarWhatsapp(p.whatsapp);
    if (!o.semCliente) {
      if (!nomeValido(p.nome)) erro('NOME_INVALIDO', 'nome');
      if (!whatsappValido(whats)) erro('WHATSAPP_INVALIDO', 'whatsapp');
    }

    if (!dataValida(p.data)) { erro('DATA_INVALIDA', 'data'); return fim(); }
    const ini = hhmmParaMin(p.hora);
    if (!(ini >= 0) || ini >= 1440) { erro('HORARIO_INEXISTENTE', 'hora'); return fim(); }
    const blocos = p.blocos == null || p.blocos === '' ? 1 : Number(p.blocos);
    const maxBlocos = o.admin ? Math.max(c.max_blocos, 8) : c.max_blocos;
    if (!Number.isInteger(blocos) || blocos < 1 || blocos > maxBlocos) { erro('DURACAO_INVALIDA', 'blocos'); return fim(); }

    const agora = agoraLocal(o.agora);
    if (p.data < agora.data) { erro('DATA_PASSADA', 'data'); return fim(); }
    if (!o.admin && diasEntre(agora.data, p.data) > c.janela_dias) { erro('FORA_DA_JANELA', 'data'); return fim(); }

    const dia = horarioDoDia(p.data, ctx);
    if (!dia.aberto) {
      erros.push({ codigo: 'DIA_FECHADO', campo: 'data', mensagem: dia.motivo ? 'A arena não abre nesse dia: ' + dia.motivo.toLowerCase() + '.' : mensagem('DIA_FECHADO', ctx) });
      return fim();
    }
    const dur = c.bloco_min * blocos;
    if (ini < dia.abre || ini >= dia.fecha || (ini - dia.abre) % c.bloco_min !== 0) { erro('HORARIO_INEXISTENTE', 'hora'); return fim(); }
    if (ini + dur > dia.fecha) { erro('FORA_DO_HORARIO', 'hora'); return fim(); }

    const iniMs = msLocal(p.data, ini);
    const fimMs = msLocal(p.data, ini + dur);
    if (o.admin ? fimMs <= agora.ms : iniMs <= agora.ms) { erro('HORARIO_PASSADO', 'hora'); return fim(); }
    if (!o.admin && iniMs < agora.ms + c.antecedencia_min * MS_MIN) { erro('ANTECEDENCIA', 'hora'); return fim(); }

    const quadra = ((ctx && ctx.quadras) || []).find((q) => q.id === p.quadra_id);
    if (!quadra) { erro('QUADRA_INEXISTENTE', 'quadra_id'); return fim(); }
    if (quadra.ativa === false) { erro('QUADRA_INATIVA', 'quadra_id'); return fim(); }
    if (!o.admin && quadra.reserva_online === false) { erro('QUADRA_SEM_RESERVA_ONLINE', 'quadra_id'); return fim(); }

    const ocupacoes = (ctx && ctx.ocupacoes) || ocupacoesDoDia(p.data, ctx);
    const oc = conflito(quadra.id, iniMs, fimMs, ocupacoes, p.id);
    if (oc) {
      erro(oc.tipo === 'fixo' ? 'CONFLITO_FIXO' : oc.tipo === 'bloqueio' ? 'CONFLITO_BLOQUEIO' : 'CONFLITO_RESERVA', 'hora');
      return fim();
    }

    if (!o.admin && !o.semCliente && whatsappValido(whats)) {
      const suspenso = ((ctx && ctx.bloqueados) || []).some((b) => normalizarWhatsapp(b.whatsapp || b) === whats);
      const faltas = faltasDoCliente(whats, ctx && ctx.reservas, o.agora);
      if (suspenso || (c.faltas_bloqueio > 0 && faltas >= c.faltas_bloqueio)) erro('CLIENTE_BLOQUEADO', 'whatsapp');
      else if (c.limite_ativas > 0 && reservasAtivasDoCliente(whats, ctx && ctx.reservas, o.agora, p.id).length >= c.limite_ativas) {
        erro('LIMITE_CLIENTE', 'whatsapp');
      }
    }

    return fim({
      inicio: new Date(iniMs).toISOString(),
      fim: new Date(fimMs).toISOString(),
      whatsapp: whats,
      nome: limparNome(p.nome),
      valor: valorReserva(p.data, ini, blocos, ctx)
    });
  }

  /* ---------- Cancelamento pelo cliente ---------- */
  function podeCancelar(reserva, ctx, agora) {
    const c = cfg(ctx);
    const ms = agoraLocal(agora).ms;
    if (!reserva || !ATIVOS.includes(reserva.status)) return { pode: false, motivo: 'Essa reserva não está mais ativa.' };
    const inicio = new Date(reserva.inicio).getTime();
    if (inicio <= ms) return { pode: false, motivo: 'O horário já começou.' };
    const limite = inicio - c.prazo_cancelamento_h * 3600000;
    if (reserva.status === 'confirmada' && ms > limite) {
      return { pode: false, motivo: mensagem('PRAZO_CANCELAMENTO', ctx), limite };
    }
    return { pode: true, limite };
  }

  /* ---------- Feriados nacionais (para o ADM importar com um clique) ---------- */
  function pascoa(ano) {
    const a = ano % 19;
    const b = Math.floor(ano / 100);
    const c = ano % 100;
    const d = Math.floor(b / 4);
    const e = b % 4;
    const f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4);
    const k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const mes = Math.floor((h + l - 7 * m + 114) / 31);
    const dia = ((h + l - 7 * m + 114) % 31) + 1;
    return ano + '-' + pad(mes) + '-' + pad(dia);
  }
  function feriadosNacionais(ano) {
    const p = pascoa(ano);
    const lista = [
      [ano + '-01-01', 'Confraternização Universal', false],
      [somarDias(p, -48), 'Carnaval (segunda)', true],
      [somarDias(p, -47), 'Carnaval (terça)', true],
      [somarDias(p, -2), 'Sexta-feira Santa', false],
      [ano + '-04-21', 'Tiradentes', false],
      [ano + '-05-01', 'Dia do Trabalho', false],
      [somarDias(p, 60), 'Corpus Christi', true],
      [ano + '-09-07', 'Independência do Brasil', false],
      [ano + '-10-12', 'Nossa Senhora Aparecida', false],
      [ano + '-11-02', 'Finados', false],
      [ano + '-11-15', 'Proclamação da República', false],
      [ano + '-11-20', 'Dia da Consciência Negra', false],
      [ano + '-12-24', 'Véspera de Natal', true],
      [ano + '-12-25', 'Natal', false],
      [ano + '-12-31', 'Véspera de Ano Novo', true]
    ];
    return lista.map(([data, nome, facultativo]) => ({ data, nome, facultativo })).sort((a, b) => a.data.localeCompare(b.data));
  }

  /* ---------- Status de funcionamento agora ---------- */
  function statusAgora(ctx, agora) {
    const a = agoraLocal(agora);
    const hoje = horarioDoDia(a.data, ctx);
    if (hoje.aberto && a.min >= hoje.abre && a.min < hoje.fecha) {
      return { aberto: true, texto: 'Aberto agora', detalhe: 'até ' + horaTexto(hoje.fecha) };
    }
    for (let i = 0; i <= 14; i++) {
      const data = somarDias(a.data, i);
      const h = horarioDoDia(data, ctx);
      if (!h.aberto || (i === 0 && a.min >= h.abre)) continue;
      const quando = i === 0 ? 'hoje' : i === 1 ? 'amanhã' : DIAS[diaDaSemana(data)];
      return { aberto: false, texto: 'Fechado agora', detalhe: 'abre ' + quando + ' às ' + horaTexto(h.abre) };
    }
    return { aberto: false, texto: 'Fechado', detalhe: '' };
  }

  function gerarCodigo(aleatorio) {
    const rnd = aleatorio || Math.random;
    let s = 'AE-';
    for (let i = 0; i < 4; i++) s += ALFABETO_CODIGO[Math.floor(rnd() * ALFABETO_CODIGO.length)];
    return s;
  }

  const API = {
    OFFSET_MIN, ATIVOS, STATUS, DIAS, DIAS_CURTOS, MESES, MESES_CURTOS, CONFIG_PADRAO, MENSAGENS,
    hhmmParaMin, minParaHhmm, horaTexto, dataValida, msLocal, localParaIso, isoParaLocal, agoraLocal,
    somarDias, diasEntre, diaDaSemana, dataLonga, dataCurta,
    normalizarWhatsapp, whatsappValido, formatarWhatsapp, limparNome, nomeValido,
    cfg, horarioDoDia, gradeDoDia, fixosDoDia, ocupacoesDoDia, conflito, quadrasReservaveis,
    valorReserva, disponibilidade, diasDaJanela, mensagem, validarReserva, podeCancelar,
    faltasDoCliente, reservasAtivasDoCliente, feriadosNacionais, pascoa, statusAgora, gerarCodigo
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else raiz.ArenaRegras = API;
})(typeof window !== 'undefined' ? window : globalThis);
