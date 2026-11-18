-- ============================================================
-- Arena Esporte: banco do agendamento (Supabase)
-- ------------------------------------------------------------
-- Rode tudo de uma vez em: Supabase > SQL Editor > New query.
-- Pode rodar de novo sem perder dados (idempotente).
--
-- Depois:
-- 1. Authentication > Sign In / Providers: desligue "Allow new users to sign up".
-- 2. Authentication > Users > Add user: crie o login da arena (e-mail + senha, Auto Confirm).
-- 3. Rode, trocando o e-mail:
--      insert into public.admins (user_id)
--      select id from auth.users where email = 'email-da-arena@exemplo.com'
--      on conflict do nothing;
-- 4. Cole a Project URL e a chave anon em js/config.js.
--
-- As regras de negócio moram aqui (as mesmas de js/regras.js):
-- o site só cria reserva pela função criar_reserva(), que confere
-- data, horário, quadra, conflitos, limite por cliente e faltas.
-- O público nunca lê a tabela de reservas (nomes e telefones).
-- ============================================================

create schema if not exists extensions;
create extension if not exists btree_gist with schema extensions;

-- ---------- Quem pode mexer no painel ----------
create table if not exists public.admins (
  user_id   uuid primary key references auth.users (id) on delete cascade,
  criado_em timestamptz not null default now()
);

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

-- ---------- Configurações e regras (uma linha só, id = 1) ----------
create table if not exists public.configuracoes (
  id                    smallint primary key default 1 check (id = 1),
  whatsapp              text not null default '5564984579527',
  mensagem_whatsapp     text not null default 'Olá! Vim pelo site da Arena Esporte.',
  instagram_url         text not null default 'https://www.instagram.com/arenaesportesaoluis/',
  maps_url              text not null default '',
  endereco              text not null default '',
  aviso_ativo           boolean not null default false,
  aviso_texto           text not null default '',
  aviso_link            text not null default '',
  -- regras do agendamento
  bloco_min             integer not null default 60 check (bloco_min in (30, 45, 60, 90, 120)),
  max_blocos            integer not null default 2  check (max_blocos between 1 and 4),
  antecedencia_min      integer not null default 60 check (antecedencia_min between 0 and 2880),
  janela_dias           integer not null default 30 check (janela_dias between 1 and 180),
  limite_ativas         integer not null default 1  check (limite_ativas between 0 and 10),
  prazo_cancelamento_h  integer not null default 3  check (prazo_cancelamento_h between 0 and 72),
  faltas_bloqueio       integer not null default 2  check (faltas_bloqueio between 0 and 10),
  -- preço (vazio = "valor combinado com a arena")
  preco_hora            numeric(10, 2) check (preco_hora is null or preco_hora >= 0),
  preco_nobre           numeric(10, 2) check (preco_nobre is null or preco_nobre >= 0),
  nobre_inicio          time,
  nobre_fds             boolean not null default false,
  modalidades           text[] not null default array['Futevôlei', 'Vôlei de areia'],
  -- Pix (opcional: o padrão é pagar na arena)
  pix_ativo             boolean not null default false,
  pix_chave             text not null default '',
  pix_nome              text not null default '',
  pix_cidade            text not null default 'SAO LUIS DE MONTES BELOS',
  atualizado_em         timestamptz not null default now()
);
insert into public.configuracoes (id) values (1) on conflict (id) do nothing;

-- ---------- Funcionamento por dia da semana (0 = domingo ... 6 = sábado) ----------
create table if not exists public.funcionamento (
  dia     smallint primary key check (dia between 0 and 6),
  aberto  boolean not null default true,
  abre    time not null default '17:00',
  fecha   time not null default '23:00',          -- 00:00 = meia-noite
  constraint funcionamento_horas check (fecha > abre or fecha = '00:00')
);
insert into public.funcionamento (dia) select generate_series(0, 6) on conflict (dia) do nothing;

-- ---------- Feriados e datas especiais ----------
create table if not exists public.datas_especiais (
  data    date primary key,
  tipo    text not null check (tipo in ('fechado', 'horario')),
  abre    time,
  fecha   time,
  motivo  text not null default '',
  constraint datas_especiais_horas check (
    tipo = 'fechado' or (abre is not null and fecha is not null and (fecha > abre or fecha = '00:00'))
  )
);

-- ---------- Quadras ----------
create table if not exists public.quadras (
  id              uuid primary key default gen_random_uuid(),
  nome            text not null,
  descricao       text not null default '',
  ordem           integer not null default 0,
  ativa           boolean not null default true,   -- false = fora de uso (manutenção)
  reserva_online  boolean not null default true,   -- false = só o ADM marca (ex.: aula, escolinha)
  criado_em       timestamptz not null default now()
);
insert into public.quadras (nome, ordem)
select v.nome, v.ordem from (values ('Quadra 1', 1), ('Quadra 2', 2), ('Quadra 3', 3)) as v (nome, ordem)
where not exists (select 1 from public.quadras);

-- ---------- Bloqueios (manutenção, torneio, evento). Sem quadra = todas ----------
create table if not exists public.bloqueios (
  id         uuid primary key default gen_random_uuid(),
  quadra_id  uuid references public.quadras (id) on delete cascade,
  inicio     timestamptz not null,
  fim        timestamptz not null,
  motivo     text not null default '',
  criado_em  timestamptz not null default now(),
  constraint bloqueios_periodo check (fim > inicio)
);
create index if not exists bloqueios_periodo_idx on public.bloqueios (inicio, fim);

-- ---------- Horários fixos (turma que joga toda semana) ----------
create table if not exists public.horarios_fixos (
  id                uuid primary key default gen_random_uuid(),
  quadra_id         uuid not null references public.quadras (id) on delete cascade,
  dia_semana        smallint not null check (dia_semana between 0 and 6),
  hora              time not null,
  duracao_min       integer not null default 60 check (duracao_min between 30 and 480),
  cliente_nome      text not null,
  cliente_whatsapp  text not null default '',
  valor             numeric(10, 2) check (valor is null or valor >= 0),
  observacoes       text not null default '',
  valido_de         date not null default current_date,
  valido_ate        date,
  datas_puladas     date[] not null default '{}',
  ativo             boolean not null default true,
  criado_em         timestamptz not null default now(),
  constraint fixos_validade check (valido_ate is null or valido_ate >= valido_de)
);

-- ---------- Reservas ----------
create table if not exists public.reservas (
  id                   uuid primary key default gen_random_uuid(),
  codigo               text not null unique,
  token                uuid not null unique default gen_random_uuid(),   -- link privado do cliente
  quadra_id            uuid not null references public.quadras (id) on delete restrict,
  inicio               timestamptz not null,
  fim                  timestamptz not null,
  cliente_nome         text not null,
  cliente_whatsapp     text not null default '',
  jogadores            smallint check (jogadores is null or jogadores between 1 and 40),
  modalidade           text not null default '',
  observacoes          text not null default '',
  status               text not null default 'pendente'
                       check (status in ('pendente', 'confirmada', 'concluida', 'cancelada', 'falta')),
  origem               text not null default 'site' check (origem in ('site', 'painel')),
  valor                numeric(10, 2) check (valor is null or valor >= 0),
  pago                 boolean not null default false,
  motivo_cancelamento  text not null default '',
  cancelado_por        text check (cancelado_por in ('cliente', 'arena')),
  criado_em            timestamptz not null default now(),
  confirmado_em        timestamptz,
  cancelado_em         timestamptz,
  atualizado_em        timestamptz not null default now(),
  constraint reservas_periodo check (fim > inicio),
  -- Regra de ouro: a mesma quadra nunca tem duas reservas ativas no mesmo horário
  constraint reservas_sem_conflito exclude using gist (
    quadra_id with =, tstzrange(inicio, fim, '[)') with &&
  ) where (status in ('pendente', 'confirmada'))
);
create index if not exists reservas_inicio_idx on public.reservas (inicio);
create index if not exists reservas_whatsapp_idx on public.reservas (cliente_whatsapp);
create index if not exists reservas_status_idx on public.reservas (status);

-- ---------- WhatsApp suspenso (só o ADM marca para essa pessoa) ----------
create table if not exists public.clientes_bloqueados (
  whatsapp   text primary key,
  nome       text not null default '',
  motivo     text not null default '',
  criado_em  timestamptz not null default now()
);

-- ============================================================
-- Funções de apoio (internas; o público não chama)
-- ============================================================
create or replace function public._erro(p_codigo text, p_mensagem text)
returns void language plpgsql as $$
begin
  raise exception using message = p_mensagem, hint = p_codigo, errcode = 'P0001';
end;
$$;

create or replace function public._min(p time)
returns integer language sql immutable as $$
  select (extract(hour from p) * 60 + extract(minute from p))::integer;
$$;

-- Data + minuto do dia no horário de Brasília -> instante
create or replace function public._local(p_data date, p_min integer)
returns timestamptz language sql stable as $$
  select (p_data + make_interval(mins => p_min)) at time zone 'America/Sao_Paulo';
$$;

create or replace function public._normalizar_whats(p text)
returns text language plpgsql immutable as $$
declare
  n text := regexp_replace(coalesce(p, ''), '\D', '', 'g');
begin
  if length(n) = 11 and left(n, 1) = '0' then n := substr(n, 2); end if;
  if length(n) = 12 and left(n, 1) = '0' then n := substr(n, 2); end if;
  if length(n) in (10, 11) then n := '55' || n; end if;
  return n;
end;
$$;

create or replace function public._whats_valido(p text)
returns boolean language sql immutable as $$
  select case
    when n ~ '^55[0-9]{2}(9[0-9]{8}|[2-5][0-9]{7})$' then substr(n, 3, 2)::integer = any (array[
      11, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 24, 27, 28, 31, 32, 33, 34, 35, 37, 38,
      41, 42, 43, 44, 45, 46, 47, 48, 49, 51, 53, 54, 55, 61, 62, 63, 64, 65, 66, 67, 68, 69,
      71, 73, 74, 75, 77, 79, 81, 82, 83, 84, 85, 86, 87, 88, 89, 91, 92, 93, 94, 95, 96, 97, 98, 99])
    else false end
  from (select public._normalizar_whats(p) as n) x;
$$;

-- Horário de um dia: feriado/data especial vale mais que o dia da semana
create or replace function public._horario_do_dia(
  p_data date, out aberto boolean, out abre_min integer, out fecha_min integer, out motivo text)
language plpgsql stable as $$
declare
  e public.datas_especiais;
  f public.funcionamento;
begin
  select * into e from public.datas_especiais where data = p_data;
  if found then
    if e.tipo = 'fechado' then
      aberto := false;
      motivo := coalesce(nullif(e.motivo, ''), 'Fechado nesta data');
      return;
    end if;
    abre_min := public._min(e.abre);
    fecha_min := public._min(e.fecha);
    motivo := e.motivo;
  else
    select * into f from public.funcionamento where dia = extract(dow from p_data);
    if not found or not f.aberto then
      aberto := false;
      motivo := 'Fechado neste dia da semana';
      return;
    end if;
    abre_min := public._min(f.abre);
    fecha_min := public._min(f.fecha);
    motivo := '';
  end if;
  if fecha_min = 0 then fecha_min := 1440; end if;
  aberto := fecha_min > abre_min;
  if not aberto then motivo := 'Horário desta data está sem configuração'; end if;
end;
$$;

-- O que ocupa a quadra nesse intervalo? 'reserva', 'fixo', 'bloqueio' ou null
create or replace function public._conflito(p_quadra uuid, p_ini timestamptz, p_fim timestamptz, p_ignorar uuid default null)
returns text language plpgsql stable as $$
declare
  d date;
begin
  if exists (
    select 1 from public.reservas r
    where r.quadra_id = p_quadra and r.status in ('pendente', 'confirmada')
      and (p_ignorar is null or r.id <> p_ignorar)
      and r.inicio < p_fim and p_ini < r.fim
  ) then return 'reserva'; end if;

  for d in
    select g::date from generate_series(
      (p_ini at time zone 'America/Sao_Paulo')::date,
      ((p_fim - interval '1 second') at time zone 'America/Sao_Paulo')::date,
      interval '1 day') g
  loop
    if exists (
      select 1 from public.horarios_fixos f
      where f.ativo and f.quadra_id = p_quadra and f.dia_semana = extract(dow from d)
        and f.valido_de <= d and (f.valido_ate is null or f.valido_ate >= d)
        and not (d = any (f.datas_puladas))
        and public._local(d, public._min(f.hora)) < p_fim
        and p_ini < public._local(d, public._min(f.hora)) + make_interval(mins => f.duracao_min)
    ) then return 'fixo'; end if;
  end loop;

  if exists (
    select 1 from public.bloqueios b
    where (b.quadra_id is null or b.quadra_id = p_quadra) and b.inicio < p_fim and p_ini < b.fim
  ) then return 'bloqueio'; end if;
  return null;
end;
$$;

create or replace function public._valor(p_data date, p_ini integer, p_blocos integer)
returns numeric language plpgsql stable as $$
declare
  c public.configuracoes;
  total numeric := 0;
  b integer;
  nobre boolean;
begin
  select * into c from public.configuracoes where id = 1;
  if c.preco_hora is null then return null; end if;
  for i in 0 .. p_blocos - 1 loop
    b := p_ini + i * c.bloco_min;
    nobre := (c.nobre_fds and extract(dow from p_data) in (0, 6))
          or (c.nobre_inicio is not null and b >= public._min(c.nobre_inicio));
    total := total + (case when nobre then coalesce(c.preco_nobre, c.preco_hora) else c.preco_hora end) * c.bloco_min / 60.0;
  end loop;
  return round(total, 2);
end;
$$;

-- ============================================================
-- Validação de toda reserva (site ou painel)
-- ============================================================
create or replace function public.reservas_validar()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  c public.configuracoes;
  h record;
  v_data date;
  v_ini integer;
  v_dur integer;
  v_conf text;
  muda boolean;
begin
  new.cliente_whatsapp := public._normalizar_whats(new.cliente_whatsapp);
  new.cliente_nome := regexp_replace(trim(coalesce(new.cliente_nome, '')), '\s+', ' ', 'g');
  new.atualizado_em := now();

  if tg_op = 'UPDATE' then
    new.codigo := old.codigo;
    new.token := old.token;
    new.criado_em := old.criado_em;
    new.origem := old.origem;
    if new.status is distinct from old.status then
      if new.status = 'confirmada' then new.confirmado_em := coalesce(new.confirmado_em, now()); end if;
      if new.status = 'cancelada' then
        new.cancelado_em := coalesce(new.cancelado_em, now());
        new.cancelado_por := coalesce(new.cancelado_por, 'arena');
      end if;
    end if;
    muda := (new.inicio, new.fim, new.quadra_id) is distinct from (old.inicio, old.fim, old.quadra_id)
         or (new.status in ('pendente', 'confirmada') and old.status not in ('pendente', 'confirmada'));
  else
    muda := true;
    if new.status = 'confirmada' then new.confirmado_em := coalesce(new.confirmado_em, now()); end if;
  end if;

  if not muda or new.status not in ('pendente', 'confirmada') then
    return new;
  end if;

  if length(new.cliente_nome) < 2 then
    perform public._erro('NOME_INVALIDO', 'Escreva o nome do cliente.');
  end if;
  if new.cliente_whatsapp <> '' and not public._whats_valido(new.cliente_whatsapp) then
    perform public._erro('WHATSAPP_INVALIDO', 'Confira o WhatsApp: DDD + número.');
  end if;
  if new.fim <= now() then
    perform public._erro('HORARIO_PASSADO', 'Esse horário já passou.');
  end if;
  if not exists (select 1 from public.quadras q where q.id = new.quadra_id and q.ativa) then
    perform public._erro('QUADRA_INATIVA', 'Essa quadra está fora de uso.');
  end if;

  select * into c from public.configuracoes where id = 1;
  v_data := (new.inicio at time zone 'America/Sao_Paulo')::date;
  v_ini := public._min((new.inicio at time zone 'America/Sao_Paulo')::time);
  v_dur := (extract(epoch from (new.fim - new.inicio)) / 60)::integer;
  select * into h from public._horario_do_dia(v_data);

  if not h.aberto then
    perform public._erro('DIA_FECHADO', 'A arena não abre nesse dia: ' || lower(h.motivo) || '.');
  end if;
  if v_ini < h.abre_min or v_ini >= h.fecha_min or (v_ini - h.abre_min) % c.bloco_min <> 0 then
    perform public._erro('HORARIO_INEXISTENTE', 'Esse horário não existe na agenda da arena.');
  end if;
  if v_dur % c.bloco_min <> 0 then
    perform public._erro('DURACAO_INVALIDA', 'A duração precisa fechar em horários inteiros da agenda.');
  end if;
  if v_ini + v_dur > h.fecha_min then
    perform public._erro('FORA_DO_HORARIO', 'Esse horário passa do funcionamento da arena nesse dia.');
  end if;

  v_conf := public._conflito(new.quadra_id, new.inicio, new.fim, new.id);
  if v_conf = 'reserva' then
    perform public._erro('CONFLITO_RESERVA', 'Já existe reserva nessa quadra nesse horário.');
  elsif v_conf = 'fixo' then
    perform public._erro('CONFLITO_FIXO', 'Esse horário é de uma turma fixa nessa quadra.');
  elsif v_conf = 'bloqueio' then
    perform public._erro('CONFLITO_BLOQUEIO', 'Essa quadra está bloqueada nesse horário.');
  end if;
  return new;
end;
$$;

drop trigger if exists reservas_validar on public.reservas;
create trigger reservas_validar before insert or update on public.reservas
  for each row execute function public.reservas_validar();

-- Turmas fixas não podem se sobrepor na mesma quadra
create or replace function public.fixos_validar()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.cliente_whatsapp := public._normalizar_whats(new.cliente_whatsapp);
  new.datas_puladas := coalesce(new.datas_puladas, '{}');
  if new.ativo and exists (
    select 1 from public.horarios_fixos f
    where f.id <> new.id and f.ativo and f.quadra_id = new.quadra_id and f.dia_semana = new.dia_semana
      and f.valido_de <= coalesce(new.valido_ate, 'infinity'::date)
      and new.valido_de <= coalesce(f.valido_ate, 'infinity'::date)
      and public._min(f.hora) < public._min(new.hora) + new.duracao_min
      and public._min(new.hora) < public._min(f.hora) + f.duracao_min
  ) then
    perform public._erro('CONFLITO_FIXO', 'Já existe uma turma fixa nessa quadra, nesse dia e horário.');
  end if;
  return new;
end;
$$;

drop trigger if exists fixos_validar on public.horarios_fixos;
create trigger fixos_validar before insert or update on public.horarios_fixos
  for each row execute function public.fixos_validar();

create or replace function public.tocar_atualizado_em()
returns trigger language plpgsql as $$
begin
  new.atualizado_em = now();
  return new;
end;
$$;
drop trigger if exists configuracoes_atualizado on public.configuracoes;
create trigger configuracoes_atualizado before update on public.configuracoes
  for each row execute function public.tocar_atualizado_em();

-- ============================================================
-- Funções públicas (o site chama pelo supabase.rpc)
-- ============================================================

-- Horários ocupados de um dia, sem nome nem telefone de ninguém
create or replace function public.ocupacao(p_data date)
returns table (quadra_id uuid, inicio timestamptz, fim timestamptz, tipo text)
language sql stable security definer set search_path = public as $$
  with dia as (select public._local(p_data, 0) as ini, public._local(p_data, 1440) as fim)
  select r.quadra_id, r.inicio, r.fim, 'reserva'::text
    from public.reservas r, dia
   where r.status in ('pendente', 'confirmada') and r.inicio < dia.fim and r.fim > dia.ini
  union all
  select f.quadra_id,
         public._local(p_data, public._min(f.hora)),
         public._local(p_data, public._min(f.hora)) + make_interval(mins => f.duracao_min),
         'fixo'::text
    from public.horarios_fixos f
   where f.ativo and f.dia_semana = extract(dow from p_data)
     and f.valido_de <= p_data and (f.valido_ate is null or f.valido_ate >= p_data)
     and not (p_data = any (f.datas_puladas))
  union all
  select b.quadra_id, b.inicio, b.fim, 'bloqueio'::text
    from public.bloqueios b, dia
   where b.inicio < dia.fim and b.fim > dia.ini;
$$;

create or replace function public.criar_reserva(
  p_quadra uuid,
  p_data text,
  p_hora text,
  p_blocos integer,
  p_nome text,
  p_whatsapp text,
  p_jogadores integer default null,
  p_modalidade text default '',
  p_observacoes text default ''
)
returns json language plpgsql security definer set search_path = public as $$
declare
  c public.configuracoes;
  q public.quadras;
  h record;
  v_nome text := regexp_replace(trim(coalesce(p_nome, '')), '\s+', ' ', 'g');
  v_whats text := public._normalizar_whats(p_whatsapp);
  v_data date;
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_ini integer;
  v_dur integer;
  v_inicio timestamptz;
  v_fim timestamptz;
  v_conf text;
  v_codigo text;
  v_alfabeto text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_res public.reservas;
  v_antecedencia text;
begin
  select * into c from public.configuracoes where id = 1;

  if length(v_nome) < 3 or length(v_nome) > 80 or v_nome !~ '[A-Za-zÀ-ÿ]{2}' then
    perform public._erro('NOME_INVALIDO', 'Escreva seu nome (pelo menos 3 letras).');
  end if;
  if not public._whats_valido(v_whats) then
    perform public._erro('WHATSAPP_INVALIDO', 'Confira o WhatsApp: DDD + número, como (64) 98457-9527.');
  end if;

  if coalesce(p_data, '') !~ '^\d{4}-\d{2}-\d{2}$' then
    perform public._erro('DATA_INVALIDA', 'Essa data não existe.');
  end if;
  begin
    v_data := p_data::date;
  exception when others then
    perform public._erro('DATA_INVALIDA', 'Essa data não existe.');
  end;
  if coalesce(p_hora, '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
    perform public._erro('HORARIO_INEXISTENTE', 'Esse horário não existe na agenda da arena.');
  end if;
  v_ini := split_part(p_hora, ':', 1)::integer * 60 + split_part(p_hora, ':', 2)::integer;
  if p_blocos is null or p_blocos < 1 or p_blocos > c.max_blocos then
    perform public._erro('DURACAO_INVALIDA', 'Dá para reservar de 1 a ' || c.max_blocos || ' horário(s) seguidos.');
  end if;
  v_dur := c.bloco_min * p_blocos;

  if v_data < v_hoje then
    perform public._erro('DATA_PASSADA', 'Essa data já passou. Escolha hoje ou um dia mais pra frente.');
  end if;
  if v_data > v_hoje + c.janela_dias then
    perform public._erro('FORA_DA_JANELA', 'A agenda online abre só para os próximos ' || c.janela_dias || ' dias.');
  end if;

  select * into h from public._horario_do_dia(v_data);
  if not h.aberto then
    perform public._erro('DIA_FECHADO', 'A arena não abre nesse dia: ' || lower(h.motivo) || '.');
  end if;
  if v_ini < h.abre_min or v_ini >= h.fecha_min or (v_ini - h.abre_min) % c.bloco_min <> 0 then
    perform public._erro('HORARIO_INEXISTENTE', 'Esse horário não existe na agenda da arena.');
  end if;
  if v_ini + v_dur > h.fecha_min then
    perform public._erro('FORA_DO_HORARIO', 'Esse horário passa do funcionamento da arena nesse dia.');
  end if;

  v_inicio := public._local(v_data, v_ini);
  v_fim := public._local(v_data, v_ini + v_dur);
  if v_inicio <= now() then
    perform public._erro('HORARIO_PASSADO', 'Esse horário já começou ou já passou.');
  end if;
  if v_inicio < now() + make_interval(mins => c.antecedencia_min) then
    v_antecedencia := case when c.antecedencia_min % 60 = 0
      then (c.antecedencia_min / 60) || case when c.antecedencia_min = 60 then ' hora' else ' horas' end
      else c.antecedencia_min || ' minutos' end;
    perform public._erro('ANTECEDENCIA', 'Pelo site, a reserva precisa de pelo menos ' || v_antecedencia
      || ' de antecedência. Para agora, chama a gente no WhatsApp.');
  end if;

  select * into q from public.quadras where id = p_quadra;
  if not found then
    perform public._erro('QUADRA_INEXISTENTE', 'Escolha uma quadra.');
  end if;
  if not q.ativa then
    perform public._erro('QUADRA_INATIVA', 'Essa quadra está fora de uso no momento.');
  end if;
  if not q.reserva_online then
    perform public._erro('QUADRA_SEM_RESERVA_ONLINE', 'Essa quadra não é alugada pelo site. Fale com a arena no WhatsApp.');
  end if;

  -- Uma reserva por vez para o mesmo WhatsApp (evita duas abas furando o limite)
  perform pg_advisory_xact_lock(hashtext('arena-esporte:' || v_whats));

  v_conf := public._conflito(q.id, v_inicio, v_fim, null);
  if v_conf = 'reserva' then
    perform public._erro('CONFLITO_RESERVA', 'Alguém acabou de pegar esse horário nessa quadra. Escolha outro.');
  elsif v_conf = 'fixo' then
    perform public._erro('CONFLITO_FIXO', 'Esse horário é de uma turma fixa nessa quadra.');
  elsif v_conf = 'bloqueio' then
    perform public._erro('CONFLITO_BLOQUEIO', 'Essa quadra está bloqueada nesse horário.');
  end if;

  if exists (select 1 from public.clientes_bloqueados where whatsapp = v_whats)
     or (c.faltas_bloqueio > 0 and (
       select count(*) from public.reservas
        where cliente_whatsapp = v_whats and status = 'falta' and inicio >= now() - interval '180 days'
     ) >= c.faltas_bloqueio) then
    perform public._erro('CLIENTE_BLOQUEADO', 'A reserva pelo site está suspensa para este WhatsApp. Fale com a arena.');
  end if;

  if c.limite_ativas > 0 and (
    select count(*) from public.reservas
     where cliente_whatsapp = v_whats and status in ('pendente', 'confirmada') and fim > now()
  ) >= c.limite_ativas then
    perform public._erro('LIMITE_CLIENTE', 'Você já tem ' || c.limite_ativas
      || ' reserva(s) marcada(s). Depois que jogar (ou se cancelar), pode marcar outra.');
  end if;

  -- Freio contra robô: muitas reservas pelo site em pouco tempo
  if (select count(*) from public.reservas where origem = 'site' and criado_em > now() - interval '10 minutes') >= 30
     or (select count(*) from public.reservas where cliente_whatsapp = v_whats and cancelado_por = 'cliente'
           and cancelado_em > now() - interval '24 hours') >= 4 then
    perform public._erro('MUITAS_TENTATIVAS', 'Muitas reservas em pouco tempo. Espere um pouco e tente de novo.');
  end if;

  loop
    v_codigo := 'AE-';
    for i in 1 .. 4 loop
      v_codigo := v_codigo || substr(v_alfabeto, 1 + floor(random() * length(v_alfabeto))::integer, 1);
    end loop;
    exit when not exists (select 1 from public.reservas where codigo = v_codigo);
  end loop;

  begin
    insert into public.reservas (codigo, quadra_id, inicio, fim, cliente_nome, cliente_whatsapp, jogadores,
                                 modalidade, observacoes, status, origem, valor)
    values (v_codigo, q.id, v_inicio, v_fim, v_nome, v_whats,
            case when p_jogadores between 1 and 40 then p_jogadores else null end,
            left(coalesce(p_modalidade, ''), 40), left(coalesce(p_observacoes, ''), 300),
            'pendente', 'site', public._valor(v_data, v_ini, p_blocos))
    returning * into v_res;
  exception when exclusion_violation then
    perform public._erro('CONFLITO_RESERVA', 'Alguém acabou de pegar esse horário nessa quadra. Escolha outro.');
  end;

  return json_build_object(
    'codigo', v_res.codigo, 'token', v_res.token, 'status', v_res.status,
    'inicio', v_res.inicio, 'fim', v_res.fim, 'valor', v_res.valor,
    'quadra', q.nome, 'quadra_id', q.id
  );
end;
$$;

-- O cliente acompanha a própria reserva pelo link privado (token)
create or replace function public.minha_reserva(p_token uuid)
returns json language sql stable security definer set search_path = public as $$
  select json_build_object(
    'codigo', r.codigo, 'status', r.status, 'inicio', r.inicio, 'fim', r.fim,
    'quadra', q.nome, 'quadra_id', r.quadra_id, 'cliente_nome', r.cliente_nome,
    'cliente_whatsapp', r.cliente_whatsapp, 'modalidade', r.modalidade, 'jogadores', r.jogadores,
    'valor', r.valor, 'pago', r.pago, 'motivo_cancelamento', r.motivo_cancelamento,
    'cancelado_por', r.cancelado_por, 'criado_em', r.criado_em
  )
  from public.reservas r join public.quadras q on q.id = r.quadra_id
  where r.token = p_token;
$$;

create or replace function public.cancelar_minha_reserva(p_token uuid)
returns json language plpgsql security definer set search_path = public as $$
declare
  c public.configuracoes;
  r public.reservas;
begin
  select * into c from public.configuracoes where id = 1;
  select * into r from public.reservas where token = p_token for update;
  if not found then
    perform public._erro('RESERVA_NAO_ENCONTRADA', 'Reserva não encontrada.');
  end if;
  if r.status not in ('pendente', 'confirmada') then
    perform public._erro('RESERVA_INATIVA', 'Essa reserva não está mais ativa.');
  end if;
  if r.inicio <= now() then
    perform public._erro('HORARIO_PASSADO', 'O horário já começou.');
  end if;
  if r.status = 'confirmada' and now() > r.inicio - make_interval(hours => c.prazo_cancelamento_h) then
    perform public._erro('PRAZO_CANCELAMENTO', 'O cancelamento pelo site vai até ' || c.prazo_cancelamento_h
      || 'h antes do jogo. Agora, só pelo WhatsApp.');
  end if;
  update public.reservas
     set status = 'cancelada', cancelado_por = 'cliente', cancelado_em = now(),
         motivo_cancelamento = 'Cancelada pelo cliente no site'
   where id = r.id;
  return public.minha_reserva(p_token);
end;
$$;

-- Perdeu o link? Código + WhatsApp devolvem o token
create or replace function public.buscar_reserva(p_codigo text, p_whatsapp text)
returns uuid language sql stable security definer set search_path = public as $$
  select token from public.reservas
   where regexp_replace(upper(codigo), '[^A-Z0-9]', '', 'g') = regexp_replace(upper(coalesce(p_codigo, '')), '[^A-Z0-9]', '', 'g')
     and cliente_whatsapp = public._normalizar_whats(p_whatsapp)
   limit 1;
$$;

-- ============================================================
-- Permissões
-- ============================================================
revoke all on function public._erro(text, text) from public;
revoke all on function public._min(time) from public;
revoke all on function public._local(date, integer) from public;
revoke all on function public._normalizar_whats(text) from public;
revoke all on function public._whats_valido(text) from public;
revoke all on function public._horario_do_dia(date) from public;
revoke all on function public._conflito(uuid, timestamptz, timestamptz, uuid) from public;
revoke all on function public._valor(date, integer, integer) from public;
grant execute on function public._erro(text, text) to authenticated;
grant execute on function public._min(time) to authenticated;
grant execute on function public._local(date, integer) to authenticated;
grant execute on function public._normalizar_whats(text) to authenticated;
grant execute on function public._whats_valido(text) to authenticated;
grant execute on function public._horario_do_dia(date) to authenticated;
grant execute on function public._conflito(uuid, timestamptz, timestamptz, uuid) to authenticated;
grant execute on function public._valor(date, integer, integer) to authenticated;

grant execute on function public.ocupacao(date) to anon, authenticated;
grant execute on function public.criar_reserva(uuid, text, text, integer, text, text, integer, text, text) to anon, authenticated;
grant execute on function public.minha_reserva(uuid) to anon, authenticated;
grant execute on function public.cancelar_minha_reserva(uuid) to anon, authenticated;
grant execute on function public.buscar_reserva(text, text) to anon, authenticated;
grant execute on function public.is_admin() to anon, authenticated;

grant usage on schema public to anon, authenticated;
grant select on public.configuracoes, public.funcionamento, public.datas_especiais, public.quadras, public.bloqueios to anon;
grant select, insert, update, delete on all tables in schema public to authenticated;

-- ============================================================
-- Segurança (RLS)
-- ============================================================
alter table public.admins              enable row level security;
alter table public.configuracoes       enable row level security;
alter table public.funcionamento       enable row level security;
alter table public.datas_especiais     enable row level security;
alter table public.quadras             enable row level security;
alter table public.bloqueios           enable row level security;
alter table public.horarios_fixos      enable row level security;
alter table public.reservas            enable row level security;
alter table public.clientes_bloqueados enable row level security;

drop policy if exists "admin ve a propria linha" on public.admins;
create policy "admin ve a propria linha" on public.admins
  for select to authenticated using (user_id = auth.uid());

-- Leitura pública: o que o site precisa para montar a agenda
do $$
declare t text;
begin
  foreach t in array array['configuracoes', 'funcionamento', 'datas_especiais', 'quadras', 'bloqueios'] loop
    execute format('drop policy if exists "%s: leitura" on public.%I', t, t);
    execute format('create policy "%s: leitura" on public.%I for select using (true)', t, t);
  end loop;
  foreach t in array array['configuracoes', 'funcionamento', 'datas_especiais', 'quadras', 'bloqueios',
                           'horarios_fixos', 'reservas', 'clientes_bloqueados'] loop
    execute format('drop policy if exists "%s: admin" on public.%I', t, t);
    execute format('create policy "%s: admin" on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())', t, t);
  end loop;
end;
$$;

-- ============================================================
-- Tempo real: o painel recebe a reserva nova na hora
-- ============================================================
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime'
                     and schemaname = 'public' and tablename = 'reservas') then
    execute 'alter publication supabase_realtime add table public.reservas';
  end if;
end;
$$;
