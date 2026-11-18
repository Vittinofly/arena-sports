// Testes das regras de negócio (js/regras.js). Rode na pasta do projeto:
//   node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const R = require('../js/regras.js');

// "Agora" fixo: quarta, 18/11/2026, 14:00 em Brasília (17:00 UTC)
const AGORA = '2026-11-18T17:00:00.000Z';

function contexto(extra) {
  return Object.assign({
    config: { bloco_min: 60, max_blocos: 2, antecedencia_min: 60, janela_dias: 30, limite_ativas: 1, prazo_cancelamento_h: 3, faltas_bloqueio: 2, preco_hora: 100, preco_nobre: 120, nobre_inicio: '19:00', nobre_fds: false },
    funcionamento: [0, 1, 2, 3, 4, 5, 6].map((dia) => ({ dia, aberto: dia !== 1, abre: '17:00', fecha: '23:00' })),
    datasEspeciais: [
      { data: '2026-12-25', tipo: 'fechado', motivo: 'Natal' },
      { data: '2026-11-20', tipo: 'horario', abre: '08:00', fecha: '12:00', motivo: 'Consciência Negra' }
    ],
    quadras: [
      { id: 'q1', nome: 'Quadra 1', ativa: true, reserva_online: true, ordem: 1 },
      { id: 'q2', nome: 'Quadra 2', ativa: true, reserva_online: true, ordem: 2 },
      { id: 'q3', nome: 'Quadra 3', ativa: true, reserva_online: false, ordem: 3 },
      { id: 'q4', nome: 'Quadra 4', ativa: false, reserva_online: true, ordem: 4 }
    ],
    reservas: [],
    fixos: [],
    bloqueios: [],
    bloqueados: []
  }, extra || {});
}
const pedido = (extra) => Object.assign({ quadra_id: 'q1', data: '2026-11-19', hora: '19:00', blocos: 1, nome: 'João Silva', whatsapp: '(64) 98457-9527' }, extra || {});
const codigo = (r) => (r.erro ? r.erro.codigo : 'OK');

test('fuso de Brasília: 19h local = 22h UTC', () => {
  assert.equal(R.localParaIso('2026-11-19', 19 * 60), '2026-11-19T22:00:00.000Z');
  assert.deepEqual(R.isoParaLocal('2026-11-19T22:00:00.000Z'), { data: '2026-11-19', min: 1140 });
  assert.equal(R.agoraLocal(AGORA).data, '2026-11-18');
  assert.equal(R.agoraLocal(AGORA).min, 14 * 60);
  assert.equal(R.agoraLocal('2026-11-19T02:30:00Z').data, '2026-11-18'); // 23h30 do dia 18 em Brasília
});

test('reserva válida passa e calcula preço', () => {
  const r = R.validarReserva(pedido(), contexto(), { agora: AGORA });
  assert.equal(codigo(r), 'OK');
  assert.equal(r.inicio, '2026-11-19T22:00:00.000Z');
  assert.equal(r.fim, '2026-11-19T23:00:00.000Z');
  assert.equal(r.whatsapp, '5564984579527');
  assert.equal(r.valor, 120); // 19h é horário nobre
  const duas = R.validarReserva(pedido({ hora: '18:00', blocos: 2 }), contexto(), { agora: AGORA });
  assert.equal(duas.valor, 220); // 18h normal + 19h nobre
});

test('datas e horas que não existem', () => {
  assert.equal(codigo(R.validarReserva(pedido({ data: '2026-02-30' }), contexto(), { agora: AGORA })), 'DATA_INVALIDA');
  assert.equal(codigo(R.validarReserva(pedido({ data: 'amanhã' }), contexto(), { agora: AGORA })), 'DATA_INVALIDA');
  assert.equal(codigo(R.validarReserva(pedido({ hora: '25:00' }), contexto(), { agora: AGORA })), 'HORARIO_INEXISTENTE');
  assert.equal(codigo(R.validarReserva(pedido({ hora: '19:61' }), contexto(), { agora: AGORA })), 'HORARIO_INEXISTENTE');
  assert.equal(codigo(R.validarReserva(pedido({ hora: '19:30' }), contexto(), { agora: AGORA })), 'HORARIO_INEXISTENTE');
  assert.equal(codigo(R.validarReserva(pedido({ hora: '10:00' }), contexto(), { agora: AGORA })), 'HORARIO_INEXISTENTE');
  assert.equal(codigo(R.validarReserva(pedido({ hora: '23:00' }), contexto(), { agora: AGORA })), 'HORARIO_INEXISTENTE');
  assert.equal(codigo(R.validarReserva(pedido({ hora: '22:00', blocos: 2 }), contexto(), { agora: AGORA })), 'FORA_DO_HORARIO');
  assert.equal(codigo(R.validarReserva(pedido({ blocos: 3 }), contexto(), { agora: AGORA })), 'DURACAO_INVALIDA');
  assert.equal(codigo(R.validarReserva(pedido({ blocos: 0 }), contexto(), { agora: AGORA })), 'DURACAO_INVALIDA');
});

test('dias passados, horário que já passou e antecedência', () => {
  assert.equal(codigo(R.validarReserva(pedido({ data: '2026-11-17' }), contexto(), { agora: AGORA })), 'DATA_PASSADA');
  // hoje às 14h: 17h ainda pode (3h de antecedência)
  assert.equal(codigo(R.validarReserva(pedido({ data: '2026-11-18', hora: '17:00' }), contexto(), { agora: AGORA })), 'OK');
  // hoje às 16h30: 17h começa em 30 min e fere a antecedência de 1h
  assert.equal(codigo(R.validarReserva(pedido({ data: '2026-11-18', hora: '17:00' }), contexto(), { agora: '2026-11-18T19:30:00Z' })), 'ANTECEDENCIA');
  // hoje às 17h10: 17h já começou
  assert.equal(codigo(R.validarReserva(pedido({ data: '2026-11-18', hora: '17:00' }), contexto(), { agora: '2026-11-18T20:10:00Z' })), 'HORARIO_PASSADO');
  // o ADM consegue lançar um jogo que está acontecendo agora
  assert.equal(codigo(R.validarReserva(pedido({ data: '2026-11-18', hora: '17:00' }), contexto(), { agora: '2026-11-18T20:10:00Z', admin: true })), 'OK');
  assert.equal(codigo(R.validarReserva(pedido({ data: '2026-12-19' }), contexto(), { agora: AGORA })), 'FORA_DA_JANELA');
  assert.equal(codigo(R.validarReserva(pedido({ data: '2026-12-19' }), contexto(), { agora: AGORA, admin: true })), 'OK');
});

test('dia fechado, feriado e horário especial', () => {
  assert.equal(codigo(R.validarReserva(pedido({ data: '2026-11-23' }), contexto(), { agora: AGORA })), 'DIA_FECHADO'); // segunda
  const natal = R.validarReserva(pedido({ data: '2026-12-25' }), contexto(), { agora: AGORA, admin: true });
  assert.equal(codigo(natal), 'DIA_FECHADO');
  assert.match(natal.erro.mensagem, /natal/);
  // feriado com horário especial: 8h às 12h
  assert.equal(codigo(R.validarReserva(pedido({ data: '2026-11-20', hora: '09:00' }), contexto(), { agora: AGORA })), 'OK');
  assert.equal(codigo(R.validarReserva(pedido({ data: '2026-11-20', hora: '19:00' }), contexto(), { agora: AGORA })), 'HORARIO_INEXISTENTE');
});

test('quadras: inexistente, fora de uso e só no balcão', () => {
  assert.equal(codigo(R.validarReserva(pedido({ quadra_id: 'q9' }), contexto(), { agora: AGORA })), 'QUADRA_INEXISTENTE');
  assert.equal(codigo(R.validarReserva(pedido({ quadra_id: 'q4' }), contexto(), { agora: AGORA })), 'QUADRA_INATIVA');
  assert.equal(codigo(R.validarReserva(pedido({ quadra_id: 'q3' }), contexto(), { agora: AGORA })), 'QUADRA_SEM_RESERVA_ONLINE');
  assert.equal(codigo(R.validarReserva(pedido({ quadra_id: 'q3' }), contexto(), { agora: AGORA, admin: true })), 'OK');
});

test('horário repetido: reserva, turma fixa e bloqueio', () => {
  const outra = { id: 'r1', quadra_id: 'q1', inicio: '2026-11-19T22:00:00Z', fim: '2026-11-19T23:00:00Z', status: 'pendente', cliente_whatsapp: '5564999990000' };
  assert.equal(codigo(R.validarReserva(pedido(), contexto({ reservas: [outra] }), { agora: AGORA })), 'CONFLITO_RESERVA');
  assert.equal(codigo(R.validarReserva(pedido(), contexto({ reservas: [outra] }), { agora: AGORA, admin: true })), 'CONFLITO_RESERVA');
  // 2 horas começando às 18h também batem com a das 19h
  assert.equal(codigo(R.validarReserva(pedido({ hora: '18:00', blocos: 2 }), contexto({ reservas: [outra] }), { agora: AGORA })), 'CONFLITO_RESERVA');
  // outra quadra no mesmo horário pode
  assert.equal(codigo(R.validarReserva(pedido({ quadra_id: 'q2' }), contexto({ reservas: [outra] }), { agora: AGORA })), 'OK');
  // cancelada libera
  assert.equal(codigo(R.validarReserva(pedido(), contexto({ reservas: [Object.assign({}, outra, { status: 'cancelada' })] }), { agora: AGORA })), 'OK');
  // remarcar a própria reserva para o mesmo horário não conflita com ela mesma
  assert.equal(codigo(R.validarReserva(pedido({ id: 'r1' }), contexto({ reservas: [outra] }), { agora: AGORA, admin: true })), 'OK');

  const fixo = { id: 'f1', quadra_id: 'q1', dia_semana: 4, hora: '19:00', duracao_min: 60, valido_de: '2026-11-01', ativo: true, datas_puladas: [] };
  assert.equal(codigo(R.validarReserva(pedido(), contexto({ fixos: [fixo] }), { agora: AGORA })), 'CONFLITO_FIXO');
  assert.equal(codigo(R.validarReserva(pedido(), contexto({ fixos: [Object.assign({}, fixo, { datas_puladas: ['2026-11-19'] })] }), { agora: AGORA })), 'OK');
  assert.equal(codigo(R.validarReserva(pedido(), contexto({ fixos: [Object.assign({}, fixo, { valido_ate: '2026-11-15' })] }), { agora: AGORA })), 'OK');

  const bloqueioGeral = { id: 'b1', quadra_id: null, inicio: '2026-11-19T20:00:00Z', fim: '2026-11-20T02:00:00Z', motivo: 'Torneio' };
  assert.equal(codigo(R.validarReserva(pedido({ quadra_id: 'q2' }), contexto({ bloqueios: [bloqueioGeral] }), { agora: AGORA })), 'CONFLITO_BLOQUEIO');
  const bloqueioQ1 = Object.assign({}, bloqueioGeral, { quadra_id: 'q1' });
  assert.equal(codigo(R.validarReserva(pedido({ quadra_id: 'q2' }), contexto({ bloqueios: [bloqueioQ1] }), { agora: AGORA })), 'OK');
});

test('cliente: só 1 reserva ativa, faltas e WhatsApp suspenso', () => {
  const minha = { id: 'r1', quadra_id: 'q2', inicio: '2026-11-21T20:00:00Z', fim: '2026-11-21T21:00:00Z', status: 'confirmada', cliente_whatsapp: '5564984579527' };
  assert.equal(codigo(R.validarReserva(pedido(), contexto({ reservas: [minha] }), { agora: AGORA })), 'LIMITE_CLIENTE');
  // mesmo número escrito de outro jeito
  assert.equal(codigo(R.validarReserva(pedido({ whatsapp: '064 98457 9527' }), contexto({ reservas: [minha] }), { agora: AGORA })), 'LIMITE_CLIENTE');
  // a reserva antiga já aconteceu: libera
  const antiga = Object.assign({}, minha, { inicio: '2026-11-10T20:00:00Z', fim: '2026-11-10T21:00:00Z' });
  assert.equal(codigo(R.validarReserva(pedido(), contexto({ reservas: [antiga] }), { agora: AGORA })), 'OK');
  // limite ajustado para 2
  assert.equal(codigo(R.validarReserva(pedido(), contexto({ reservas: [minha], config: Object.assign(R.cfg(contexto()), { limite_ativas: 2 }) }), { agora: AGORA })), 'OK');
  // ADM passa do limite
  assert.equal(codigo(R.validarReserva(pedido(), contexto({ reservas: [minha] }), { agora: AGORA, admin: true })), 'OK');

  const falta = (id, dia) => ({ id, quadra_id: 'q1', inicio: dia + 'T20:00:00Z', fim: dia + 'T21:00:00Z', status: 'falta', cliente_whatsapp: '5564984579527' });
  assert.equal(codigo(R.validarReserva(pedido(), contexto({ reservas: [falta('a', '2026-11-01')] }), { agora: AGORA })), 'OK');
  assert.equal(codigo(R.validarReserva(pedido(), contexto({ reservas: [falta('a', '2026-11-01'), falta('b', '2026-11-08')] }), { agora: AGORA })), 'CLIENTE_BLOQUEADO');
  assert.equal(codigo(R.validarReserva(pedido(), contexto({ bloqueados: [{ whatsapp: '5564984579527' }] }), { agora: AGORA })), 'CLIENTE_BLOQUEADO');
});

test('nome e WhatsApp', () => {
  assert.equal(codigo(R.validarReserva(pedido({ nome: 'Jo' }), contexto(), { agora: AGORA })), 'NOME_INVALIDO');
  assert.equal(codigo(R.validarReserva(pedido({ whatsapp: '98457-9527' }), contexto(), { agora: AGORA })), 'WHATSAPP_INVALIDO');
  assert.equal(R.whatsappValido('(64) 98457-9527'), true);
  assert.equal(R.whatsappValido('5564984579527'), true);
  assert.equal(R.whatsappValido('(20) 98457-9527'), false); // DDD 20 não existe
  assert.equal(R.whatsappValido('(64) 88457-9527'), false); // celular começa com 9
  assert.equal(R.formatarWhatsapp('64984579527'), '(64) 98457-9527');
});

test('disponibilidade do dia', () => {
  const ctx = contexto({
    reservas: [{ id: 'r1', quadra_id: 'q1', inicio: '2026-11-19T22:00:00Z', fim: '2026-11-19T23:00:00Z', status: 'confirmada', cliente_whatsapp: '5564999990000' },
      { id: 'r2', quadra_id: 'q2', inicio: '2026-11-19T22:00:00Z', fim: '2026-11-19T23:00:00Z', status: 'pendente', cliente_whatsapp: '5564999990001' }]
  });
  const d = R.disponibilidade('2026-11-19', ctx, { agora: AGORA });
  assert.deepEqual(d.slots.map((s) => s.hora), ['17:00', '18:00', '19:00', '20:00', '21:00', '22:00']);
  assert.equal(d.slots.find((s) => s.hora === '19:00').estado, 'lotado'); // q3 não é online
  assert.equal(d.slots.find((s) => s.hora === '20:00').livres, 2);
  const adm = R.disponibilidade('2026-11-19', ctx, { agora: AGORA, admin: true });
  assert.equal(adm.slots.find((s) => s.hora === '19:00').livres, 1); // o ADM vê a quadra 3
  const hoje = R.disponibilidade('2026-11-18', ctx, { agora: '2026-11-18T20:30:00Z' }); // 17h30
  assert.equal(hoje.slots.find((s) => s.hora === '17:00').estado, 'passado');
  assert.equal(hoje.slots.find((s) => s.hora === '18:00').estado, 'antecedencia');
  assert.equal(hoje.slots.find((s) => s.hora === '19:00').estado, 'livre');
  assert.equal(R.disponibilidade('2026-11-23', ctx, { agora: AGORA }).slots.length, 0); // segunda fechada
});

test('cancelamento pelo cliente respeita o prazo', () => {
  const ctx = contexto();
  const r = { status: 'confirmada', inicio: '2026-11-18T22:00:00Z' }; // 19h de hoje
  assert.equal(R.podeCancelar(r, ctx, AGORA).pode, true);                     // 14h: faltam 5h
  assert.equal(R.podeCancelar(r, ctx, '2026-11-18T20:30:00Z').pode, false);   // 17h30: faltam 1h30
  assert.equal(R.podeCancelar(Object.assign({}, r, { status: 'pendente' }), ctx, '2026-11-18T20:30:00Z').pode, true);
  assert.equal(R.podeCancelar(Object.assign({}, r, { status: 'cancelada' }), ctx, AGORA).pode, false);
});

test('feriados nacionais', () => {
  assert.equal(R.pascoa(2026), '2026-04-05');
  assert.equal(R.pascoa(2027), '2027-03-28');
  const f = R.feriadosNacionais(2026);
  assert.ok(f.some((x) => x.data === '2026-04-03' && /Santa/.test(x.nome)));
  assert.ok(f.some((x) => x.data === '2026-02-16' && /Carnaval/.test(x.nome)));
  assert.ok(f.some((x) => x.data === '2026-06-04' && /Corpus/.test(x.nome)));
  assert.ok(f.some((x) => x.data === '2026-11-20'));
});

test('status de funcionamento', () => {
  assert.equal(R.statusAgora(contexto(), '2026-11-18T21:00:00Z').aberto, true);       // 18h
  assert.match(R.statusAgora(contexto(), AGORA).detalhe, /abre hoje às 17h/);        // 14h
  assert.match(R.statusAgora(contexto(), '2026-11-22T21:00:00Z').texto, /Aberto/);    // domingo 18h
  assert.match(R.statusAgora(contexto(), '2026-11-23T02:30:00Z').detalhe, /terça/);   // domingo 23h30 → segunda fechada
  assert.match(R.statusAgora(contexto(), '2026-11-23T03:00:00Z').detalhe, /amanhã/);  // segunda 0h → abre terça
});
