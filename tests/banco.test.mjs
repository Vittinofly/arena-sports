// Testa supabase/schema.sql num Postgres em memória (PGlite), simulando o Supabase:
// papéis anon/authenticated, auth.uid() e a publicação do tempo real.
// Uso (dentro de tests/): npm install  e depois  npm run banco
import { PGlite } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const schema = readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8');
const db = new PGlite({ extensions: { btree_gist } });

await db.exec(`
  create role anon nologin;
  create role authenticated nologin;
  create schema auth;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;
  create publication supabase_realtime;
`);

await db.exec(schema);
await db.exec(schema); // idempotente
console.log('schema rodou 2x sem erro');

const ADMIN = '11111111-1111-1111-1111-111111111111';
await db.exec(`insert into auth.users values ('${ADMIN}', 'arena@exemplo.com');
  insert into public.admins (user_id) values ('${ADMIN}');`);

async function comoAnon() { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false); set role anon;`); }
async function comoAdmin() { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${ADMIN}', false); set role authenticated;`); }
async function comoDono() { await db.exec(`reset role;`); }

const um = async (sql, params) => (await db.query(sql, params)).rows[0];
async function erro(sql, params) {
  try { await db.query(sql, params); return 'OK'; } catch (e) { return e.hint || e.code || e.message; }
}

await comoDono();
const { hoje } = await um(`select (now() at time zone 'America/Sao_Paulo')::date::text as hoje`);
const dia = async (n) => (await um(`select ($1::date + $2::int)::text as d`, [hoje, n])).d;
const quadras = (await db.query(`select id, nome from public.quadras order by ordem`)).rows;
assert.equal(quadras.length, 3, '3 quadras criadas');
const [q1, q2, q3] = quadras.map((q) => q.id);
console.log('hoje (Brasília):', hoje, '| quadras:', quadras.map((q) => q.nome).join(', '));

const reservar = (q, data, hora, blocos, nome, whats) =>
  `select public.criar_reserva('${q}', '${data}', '${hora}', ${blocos}, '${nome}', '${whats}') as r`;

const D1 = await dia(1), D2 = await dia(2), D3 = await dia(3), D4 = await dia(4), D5 = await dia(5);

await comoAnon();
const ok1 = (await um(reservar(q1, D1, '19:00', 1, 'João Silva', '(64) 98457-9527'))).r;
assert.equal(ok1.status, 'pendente');
assert.match(ok1.codigo, /^AE-[A-Z0-9]{4}$/);
console.log('reserva criada:', ok1.codigo, ok1.inicio);

const casos = [
  ['mesmo horário, outra pessoa', reservar(q1, D1, '19:00', 1, 'Maria Souza', '64999990001'), 'CONFLITO_RESERVA'],
  ['2h que invadem o horário das 19h', reservar(q1, D1, '18:00', 2, 'Maria Souza', '64999990001'), 'CONFLITO_RESERVA'],
  ['mesmo cliente, segunda reserva', reservar(q2, D2, '19:00', 1, 'João Silva', '64984579527'), 'LIMITE_CLIENTE'],
  ['19:30 fora da grade', reservar(q2, D1, '19:30', 1, 'Maria Souza', '64999990001'), 'HORARIO_INEXISTENTE'],
  ['25:00', reservar(q2, D1, '25:00', 1, 'Maria Souza', '64999990001'), 'HORARIO_INEXISTENTE'],
  ['10:00 antes de abrir', reservar(q2, D1, '10:00', 1, 'Maria Souza', '64999990001'), 'HORARIO_INEXISTENTE'],
  ['30 de fevereiro', reservar(q2, '2027-02-30', '19:00', 1, 'Maria Souza', '64999990001'), 'DATA_INVALIDA'],
  ['ontem', reservar(q2, await dia(-1), '19:00', 1, 'Maria Souza', '64999990001'), 'DATA_PASSADA'],
  ['daqui a 40 dias', reservar(q2, await dia(40), '19:00', 1, 'Maria Souza', '64999990001'), 'FORA_DA_JANELA'],
  ['3 horas seguidas', reservar(q2, D1, '18:00', 3, 'Maria Souza', '64999990001'), 'DURACAO_INVALIDA'],
  ['22h por 2 horas', reservar(q2, D1, '22:00', 2, 'Maria Souza', '64999990001'), 'FORA_DO_HORARIO'],
  ['nome curto', reservar(q2, D1, '20:00', 1, 'Jo', '64999990001'), 'NOME_INVALIDO'],
  ['WhatsApp sem DDD', reservar(q2, D1, '20:00', 1, 'Maria Souza', '999990001'), 'WHATSAPP_INVALIDO'],
  ['quadra que não existe', reservar('00000000-0000-0000-0000-000000000000', D1, '20:00', 1, 'Maria Souza', '64999990001'), 'QUADRA_INEXISTENTE']
];
for (const [nome, sql, esperado] of casos) {
  assert.equal(await erro(sql), esperado, nome);
  console.log('  ok:', nome, '->', esperado);
}

// O público não lê nem escreve a tabela de reservas
const leitura = await erro('select 1 from public.reservas'); assert.ok(leitura === '42501' || (await db.query('select * from public.reservas')).rows.length === 0, 'anon não vê reservas');
assert.notEqual(await erro(`insert into public.reservas (codigo, quadra_id, inicio, fim, cliente_nome) values ('X', '${q1}', now() + interval '1 day', now() + interval '25 hours', 'Hacker')`), 'OK');
assert.notEqual(await erro(`update public.configuracoes set limite_ativas = 99`), 'OK_SEM_EFEITO');
assert.equal((await um(`select limite_ativas from public.configuracoes`)).limite_ativas, 1, 'anon não muda regras');
assert.equal(await erro(`select public._conflito('${q1}', now(), now() + interval '1 hour')`), '42501', 'função interna fechada');
const oc = (await db.query(`select * from public.ocupacao('${D1}')`)).rows;
assert.equal(oc.length, 1);
assert.deepEqual(Object.keys(oc[0]).sort(), ['fim', 'inicio', 'quadra_id', 'tipo']);
console.log('  ok: público não vê reservas, não altera regras e a ocupação não expõe ninguém');

// Link do cliente: ver, cancelar e marcar de novo
const minha = (await um(`select public.minha_reserva('${ok1.token}') as r`)).r;
assert.equal(minha.codigo, ok1.codigo);
const token = (await um(`select public.buscar_reserva('${ok1.codigo.toLowerCase().replace('-', '')}', '64984579527') as t`)).t;
assert.equal(token, ok1.token, 'busca por código + WhatsApp');
const cancelada = (await um(`select public.cancelar_minha_reserva('${ok1.token}') as r`)).r;
assert.equal(cancelada.status, 'cancelada');
assert.equal(await erro(`select public.cancelar_minha_reserva('${ok1.token}')`), 'RESERVA_INATIVA');
const ok2 = (await um(reservar(q1, D1, '19:00', 1, 'João Silva', '64984579527'))).r;
console.log('  ok: cliente cancelou pelo link e conseguiu marcar de novo:', ok2.codigo);

// ADM: feriado, quadra fora do site, turma fixa, bloqueio
await comoAdmin();
await db.exec(`
  insert into public.datas_especiais (data, tipo, motivo) values ('${D2}', 'fechado', 'Feriado de teste');
  update public.quadras set reserva_online = false where id = '${q3}';
  insert into public.horarios_fixos (quadra_id, dia_semana, hora, duracao_min, cliente_nome, cliente_whatsapp, valido_de)
    values ('${q2}', extract(dow from '${D3}'::date), '20:00', 60, 'Turma do Zé', '64999998888', '${hoje}');
  insert into public.bloqueios (quadra_id, inicio, fim, motivo)
    values (null, public._local('${D4}', 18*60), public._local('${D4}', 20*60), 'Torneio');
`);
assert.equal(await erro(`insert into public.horarios_fixos (quadra_id, dia_semana, hora, duracao_min, cliente_nome, valido_de)
  values ('${q2}', extract(dow from '${D3}'::date), '20:00', 60, 'Outra turma', '${hoje}')`), 'CONFLITO_FIXO', 'turmas fixas sobrepostas');
await comoAnon();
const casos2 = [
  ['feriado fechado', reservar(q1, D2, '19:00', 1, 'Maria Souza', '64999990001'), 'DIA_FECHADO'],
  ['quadra só no balcão', reservar(q3, D1, '20:00', 1, 'Maria Souza', '64999990001'), 'QUADRA_SEM_RESERVA_ONLINE'],
  ['horário da turma fixa', reservar(q2, D3, '20:00', 1, 'Maria Souza', '64999990001'), 'CONFLITO_FIXO'],
  ['bloqueio de todas as quadras', reservar(q1, D4, '19:00', 1, 'Maria Souza', '64999990001'), 'CONFLITO_BLOQUEIO']
];
for (const [nome, sql, esperado] of casos2) {
  assert.equal(await erro(sql), esperado, nome);
  console.log('  ok:', nome, '->', esperado);
}
assert.equal((await db.query(`select * from public.ocupacao('${D3}')`)).rows[0].tipo, 'fixo');

// Pular uma data da turma fixa libera o horário
await comoAdmin();
await db.exec(`update public.horarios_fixos set datas_puladas = array['${D3}'::date] where cliente_nome = 'Turma do Zé'`);
await comoAnon();
assert.equal(await erro(reservar(q2, D3, '20:00', 1, 'Maria Souza', '64999990001')), 'OK');
console.log('  ok: turma fixa pulou a data e o horário liberou');

// ADM também não consegue duplicar horário, mas pode marcar na quadra 3
await comoAdmin();
const ins = (q, data, hora, min, nome, whats, extra = '') => `insert into public.reservas (codigo, quadra_id, inicio, fim, cliente_nome, cliente_whatsapp, origem, status${extra ? ', ' + extra.split('=')[0] : ''})
  values ('ADM-' || substr(md5(random()::text), 1, 6), '${q}', public._local('${data}', (${hora}*60)::int), public._local('${data}', (${hora}*60)::int + ${min}), '${nome}', '${whats}', 'painel', 'confirmada'${extra ? ', ' + extra.split('=')[1] : ''})`;
assert.equal(await erro(ins(q1, D1, 19, 60, 'Balcão', '')), 'CONFLITO_RESERVA', 'ADM não duplica');
assert.equal(await erro(ins(q3, D1, 19, 60, 'Escolinha', '')), 'OK', 'ADM marca na quadra fora do site');
assert.equal(await erro(ins(q1, D2, 19, 60, 'Balcão', '')), 'DIA_FECHADO', 'ADM respeita feriado fechado');
assert.equal(await erro(ins(q1, D1, 19.5, 60, 'Balcão', '')), 'HORARIO_INEXISTENTE', 'ADM respeita a grade');
console.log('  ok: ADM não duplica, respeita feriado e grade, e usa a quadra fora do site');

// Faltas: 2 faltas suspendem a reserva online
await db.exec(ins(q1, D5, 17, 60, 'Faltoso', '64977776666'));
await db.exec(ins(q2, D5, 17, 60, 'Faltoso', '64977776666'));
await db.exec(`update public.reservas set status = 'falta' where cliente_whatsapp = '5564977776666'`);
await comoAnon();
assert.equal(await erro(reservar(q1, D5, '20:00', 1, 'Faltoso', '64977776666')), 'CLIENTE_BLOQUEADO');
console.log('  ok: 2 faltas suspendem a reserva pelo site');

// Antecedência mínima (ajustada para 2 dias)
await comoAdmin();
await db.exec(`update public.configuracoes set antecedencia_min = 2880`);
await comoAnon();
assert.equal(await erro(reservar(q1, D1, '21:00', 1, 'Pedro Lima', '64955554444')), 'ANTECEDENCIA');
console.log('  ok: antecedência mínima');

// Reativar uma reserva cancelada cujo horário foi ocupado: barrado
await comoAdmin();
await db.exec(`update public.configuracoes set antecedencia_min = 60`);
const r1 = await um(`select id from public.reservas where codigo = '${ok1.codigo}'`);
assert.equal(await erro(`update public.reservas set status = 'pendente' where id = '${r1.id}'`), 'CONFLITO_RESERVA');
// Remarcar para horário livre funciona
assert.equal(await erro(`update public.reservas set inicio = public._local('${D1}', 21*60), fim = public._local('${D1}', 22*60), status = 'confirmada' where id = '${r1.id}'`), 'OK');
const remarcada = await um(`select status, confirmado_em is not null as conf from public.reservas where id = '${r1.id}'`);
assert.equal(remarcada.status, 'confirmada');
assert.equal(remarcada.conf, true);
console.log('  ok: reativar em horário ocupado é barrado; remarcar para horário livre funciona');

console.log('\nTODOS OS TESTES DO BANCO PASSARAM');
