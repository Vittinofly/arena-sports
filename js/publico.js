/* ============================================================
   Arena Esporte: partes vivas da landing
   Horários livres de hoje/amanhã, aberto agora, regras com os
   números do painel, horário de funcionamento, contatos e aviso.
   ============================================================ */
(function () {
  'use strict';

  const A = window.Arena;
  if (!A) return;
  const R = A.R;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = A.util.escapar;
  const NOMES = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

  // "Seg a sex · 17h às 23h" juntando dias seguidos com o mesmo horário
  function linhasDeHorario(funcionamento) {
    const ordem = [1, 2, 3, 4, 5, 6, 0];
    const chave = (f) => (f && f.aberto ? f.abre + '-' + f.fecha : 'fechado');
    const porDia = {};
    funcionamento.forEach((f) => { porDia[f.dia] = f; });
    const grupos = [];
    ordem.forEach((d) => {
      const f = porDia[d];
      const ultimo = grupos[grupos.length - 1];
      if (ultimo && ultimo.chave === chave(f)) ultimo.dias.push(d);
      else grupos.push({ chave: chave(f), dias: [d], f });
    });
    if (grupos.length === 1) {
      const f = grupos[0].f;
      return [{ dias: 'Todos os dias', horas: f && f.aberto ? R.horaTexto(f.abre) + ' às ' + R.horaTexto(f.fecha) : 'Fechado' }];
    }
    return grupos.map((g) => ({
      dias: g.dias.length === 1 ? NOMES[g.dias[0]] : NOMES[g.dias[0]] + ' a ' + NOMES[g.dias[g.dias.length - 1]].toLowerCase(),
      horas: g.f && g.f.aberto ? R.horaTexto(g.f.abre) + ' às ' + R.horaTexto(g.f.fecha) : 'Fechado'
    }));
  }

  function textoAntecedencia(min) {
    if (min % 60 === 0) return (min / 60) + (min === 60 ? ' hora' : ' horas');
    return min + ' minutos';
  }

  function trocarNumeroWhatsapp(numero) {
    const n = String(numero || '').replace(/\D/g, '');
    if (!n) return;
    $$('a[data-whats]').forEach((a) => {
      try {
        const url = new URL(a.href);
        if (!/wa\.me$/.test(url.hostname)) return;
        url.pathname = '/' + n;
        a.href = url.toString();
      } catch (e) { /* link fora do padrão: mantém */ }
    });
    $$('[data-telefone]').forEach((el) => { el.textContent = R.formatarWhatsapp(n); });
  }

  function aplicarConfig(ctx) {
    const c = ctx.config;
    const valores = {
      janela_dias: c.janela_dias, limite_ativas: c.limite_ativas, max_blocos: c.max_blocos,
      prazo_cancelamento_h: c.prazo_cancelamento_h, faltas_bloqueio: c.faltas_bloqueio,
      antecedencia_texto: textoAntecedencia(c.antecedencia_min)
    };
    $$('[data-cfg]').forEach((el) => {
      const k = el.getAttribute('data-cfg');
      if (valores[k] !== undefined && valores[k] !== null) el.textContent = String(valores[k]);
    });
    if (c.pix_ativo && c.pix_chave) {
      $$('[data-cfg-pagamento]').forEach((el) => { el.textContent = 'Você paga na arena, no dia do jogo, ou adianta pelo Pix na tela da reserva.'; });
    }
    if (c.preco_hora != null) {
      let t = 'A hora de quadra sai por ' + A.util.preco(c.preco_hora) + '.';
      if (c.preco_nobre != null && Number(c.preco_nobre) !== Number(c.preco_hora)) {
        const quando = [c.nobre_inicio ? 'a partir das ' + R.horaTexto(c.nobre_inicio) : '', c.nobre_fds ? 'no fim de semana' : ''].filter(Boolean).join(' e ');
        t += ' ' + (quando ? 'Horário nobre (' + quando + '): ' : 'Horário nobre: ') + A.util.preco(c.preco_nobre) + '.';
      }
      t += ' O valor certinho aparece antes de você confirmar.';
      $$('[data-cfg-preco]').forEach((el) => { el.textContent = t; });
    }
    if (c.whatsapp) trocarNumeroWhatsapp(c.whatsapp);
    if (c.endereco) $$('[data-endereco]').forEach((el) => { el.textContent = c.endereco; });

    const linhas = linhasDeHorario(ctx.funcionamento);
    const lista = $('[data-horario-lista]');
    if (lista && ctx.funcionamento.length) {
      lista.innerHTML = linhas.map((l) => '<span class="linha-horario"><span>' + esc(l.dias) + '</span><b>' + esc(l.horas) + '</b></span>').join('');
    }
    const resumo = $('[data-horario-resumo]');
    if (resumo) {
      const hoje = R.horarioDoDia(R.agoraLocal().data, ctx);
      resumo.textContent = hoje.aberto ? 'Hoje a arena fica aberta até ' + R.horaTexto(hoje.fecha) + '.' : '';
    }

    const st = R.statusAgora(ctx);
    $$('[data-status]').forEach((el) => {
      const t = $('[data-status-texto]', el);
      if (t) t.textContent = st.texto + (st.detalhe ? ' · ' + st.detalhe : '');
      el.classList.toggle('is-aberto', st.aberto);
      el.hidden = false;
    });

    const aviso = $('[data-aviso]');
    if (aviso && c.aviso_ativo && c.aviso_texto) {
      const txt = $('[data-aviso-texto]', aviso);
      txt.textContent = c.aviso_texto + ' ';
      if (c.aviso_link) {
        const a = document.createElement('a');
        a.href = c.aviso_link;
        a.textContent = 'Saiba mais';
        if (/^https?:/.test(c.aviso_link)) { a.target = '_blank'; a.rel = 'noopener noreferrer'; }
        txt.appendChild(a);
      }
      aviso.hidden = false;
    }
  }

  async function initLivres(ctx) {
    const painel = $('[data-livres]');
    if (!painel) return;
    const abas = $$('[data-livres-dia]');
    async function mostrar(desloc) {
      const data = R.somarDias(R.agoraLocal().data, desloc);
      painel.innerHTML = '<p class="livres__carregando">Carregando os horários da arena...</p>';
      try {
        const ocupacoes = await A.publico.ocupacao(data);
        const d = R.disponibilidade(data, ctx, { ocupacoes });
        const livres = d.slots.filter((s) => s.estado === 'livre');
        const quando = desloc === 0 ? 'hoje' : 'amanhã';
        if (!d.dia.aberto) {
          painel.innerHTML = '<p class="livres__vazio"><b>A arena não abre ' + quando + '.</b> ' + (d.dia.motivo ? esc(d.dia.motivo) + '. ' : '') + 'Veja os próximos dias na agenda.</p>';
          return;
        }
        if (!livres.length) {
          painel.innerHTML = '<p class="livres__vazio"><b>Não sobrou horário pelo site ' + quando + '.</b> ' +
            (desloc === 0 ? 'Pode ter vaga de última hora: chama no WhatsApp. ' : '') + 'Ou escolha outro dia na agenda.</p>';
          return;
        }
        painel.innerHTML = '<ul class="chips">' + livres.map((s) => {
          const pouco = s.livres === 1;
          return '<li><a class="chip-hora" href="agendar.html?data=' + data + '&amp;hora=' + s.hora + '">' +
            '<span class="chip-hora__hora">' + s.hora + '</span>' +
            '<span class="chip-hora__info' + (pouco ? ' chip-hora__info--pouco' : '') + '">' +
            (pouco ? 'Só 1 quadra livre' : s.livres + ' quadras livres') + '</span></a></li>';
        }).join('') + '</ul>';
      } catch (e) {
        painel.innerHTML = '<p class="livres__vazio">Não deu para carregar a agenda agora. <a href="agendar.html">Abrir a página de agendamento</a>.</p>';
      }
    }
    abas.forEach((aba, i) => {
      aba.addEventListener('click', () => {
        abas.forEach((x) => { x.setAttribute('aria-selected', String(x === aba)); x.tabIndex = x === aba ? 0 : -1; });
        painel.setAttribute('aria-labelledby', aba.id);
        mostrar(Number(aba.getAttribute('data-livres-dia')));
      });
      aba.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
          const outra = abas[(i + (e.key === 'ArrowRight' ? 1 : -1) + abas.length) % abas.length];
          outra.focus();
          outra.click();
        }
      });
    });
    await mostrar(0);
  }

  document.addEventListener('DOMContentLoaded', async () => {
    try {
      const ctx = await A.publico.contexto();
      aplicarConfig(ctx);
      initLivres(ctx);
    } catch (e) {
      const painel = $('[data-livres]');
      if (painel) painel.innerHTML = '<p class="livres__vazio">Não deu para carregar a agenda agora. <a href="agendar.html">Abrir a página de agendamento</a>.</p>';
    }
  });

  window.ArenaPublico = { linhasDeHorario, textoAntecedencia };
})();
