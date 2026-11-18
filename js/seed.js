/* ============================================================
   Arena Esporte: dados de exemplo do MODO DEMONSTRAÇÃO
   ------------------------------------------------------------
   Só é usado quando js/config.js está sem as chaves do Supabase.
   As reservas de exemplo são montadas a partir de hoje, para a
   agenda nunca aparecer vazia na apresentação ao cliente.
   ============================================================ */
(function () {
  'use strict';
  const R = window.ArenaRegras;
  if (!R) return;

  const hoje = R.agoraLocal().data;
  const amanha = R.somarDias(hoje, 1);
  const depois = R.somarDias(hoje, 2);
  const ano = Number(hoje.slice(0, 4));
  let n = 0;
  const id = (p) => p + '-' + (++n);
  const reserva = (quadra, data, hora, blocos, nome, whats, status, origem) => ({
    id: id('r'), codigo: 'AE-' + ['K7QP', 'M3TX', 'R9DW', 'B4HN', 'Z2VC', 'J8LF'][n % 6],
    token: 'demo-' + n + '-' + Math.random().toString(36).slice(2, 10),
    quadra_id: quadra, inicio: R.localParaIso(data, R.hhmmParaMin(hora)),
    fim: R.localParaIso(data, R.hhmmParaMin(hora) + 60 * blocos),
    cliente_nome: nome, cliente_whatsapp: whats, jogadores: 4, modalidade: 'Futevôlei', observacoes: '',
    status, origem: origem || 'site', valor: null, pago: false, motivo_cancelamento: '', cancelado_por: null,
    criado_em: new Date(Date.now() - 3600000 * (n + 1)).toISOString(),
    confirmado_em: status === 'confirmada' ? new Date().toISOString() : null, cancelado_em: null
  });

  window.ARENA_SEED = {
    config: Object.assign({}, R.CONFIG_PADRAO, {
      modalidades: ['Futevôlei', 'Vôlei de areia'],
      pix_ativo: false, pix_chave: '', pix_nome: '', pix_cidade: 'SAO LUIS DE MONTES BELOS',
      aviso_ativo: false, aviso_texto: '', aviso_link: ''
    }),
    // [CONFIRMAR com a arena] O Google só mostra "abre às 17h". Ajuste no painel.
    funcionamento: [0, 1, 2, 3, 4, 5, 6].map((dia) => ({ dia, aberto: true, abre: '17:00', fecha: '23:00' })),
    datasEspeciais: [
      { data: ano + '-12-25', tipo: 'fechado', abre: null, fecha: null, motivo: 'Natal' },
      { data: (ano + 1) + '-01-01', tipo: 'fechado', abre: null, fecha: null, motivo: 'Confraternização Universal' }
    ],
    quadras: [
      { id: 'q1', nome: 'Quadra 1', descricao: 'Rede de futevôlei', ordem: 1, ativa: true, reserva_online: true },
      { id: 'q2', nome: 'Quadra 2', descricao: 'Rede de futevôlei', ordem: 2, ativa: true, reserva_online: true },
      { id: 'q3', nome: 'Quadra 3', descricao: 'Rede de futevôlei', ordem: 3, ativa: true, reserva_online: true }
    ],
    fixos: [
      { id: 'f1', quadra_id: 'q3', dia_semana: R.diaDaSemana(depois), hora: '20:00', duracao_min: 60,
        cliente_nome: 'Turma de exemplo (fixo)', cliente_whatsapp: '5564999990010', valor: null, observacoes: 'Joga toda semana',
        valido_de: hoje, valido_ate: null, datas_puladas: [], ativo: true }
    ],
    bloqueios: [],
    bloqueados: [],
    reservas: [
      reserva('q1', hoje, '19:00', 1, 'Lucas (exemplo)', '5564999990001', 'confirmada'),
      reserva('q2', hoje, '20:00', 2, 'Rafa (exemplo)', '5564999990002', 'pendente'),
      reserva('q1', amanha, '18:00', 1, 'Bruna (exemplo)', '5564999990003', 'pendente'),
      reserva('q3', amanha, '21:00', 1, 'Thiago (exemplo)', '5564999990004', 'confirmada', 'painel'),
      reserva('q2', depois, '19:00', 1, 'Camila (exemplo)', '5564999990005', 'confirmada')
    ]
  };
})();
