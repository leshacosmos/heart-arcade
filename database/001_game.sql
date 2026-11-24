-- Apply once to a dedicated Supabase project.
begin;
create schema heart_game;
revoke all on schema heart_game from public, anon, authenticated;

create table heart_game.members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text unique not null check (role in ('player','admin'))
);
create table heart_game.rewards (
  id integer primary key,
  name text not null check (length(trim(name)) between 1 and 80),
  price integer not null check (price between 1 and 9999)
);
insert into heart_game.rewards values
  (0,'Кино на мой вкус',10),(1,'Завтрак в постель',25),(2,'Свидание-сюрприз',50);
create table heart_game.events (
  id uuid primary key,
  seq bigint generated always as identity unique,
  title text not null,
  delta integer not null,
  created_at timestamptz not null default now()
);
create table heart_game.coupons (
  id uuid primary key references heart_game.events,
  name text not null,
  used boolean not null default false
);
create table heart_game.requests (
  id uuid primary key,
  actor uuid not null,
  command text not null,
  args jsonb not null
);

create function public.heart_snapshot() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare member_role text;
begin
  select role into member_role from heart_game.members where user_id=auth.uid();
  if member_role is null then raise exception 'Нет доступа к игре' using errcode='42501'; end if;
  return jsonb_build_object(
    'role',member_role,
    'rewards',(select jsonb_agg(to_jsonb(r) order by id) from heart_game.rewards r),
    'events',coalesce((select jsonb_agg(jsonb_build_object('id',id,'title',title,'delta',delta,'date',created_at) order by seq desc) from heart_game.events),'[]'::jsonb),
    'coupons',coalesce((select jsonb_agg(to_jsonb(c) order by e.seq desc) from heart_game.coupons c join heart_game.events e using(id)),'[]'::jsonb)
  );
end $$;

create function public.heart_action(request_id uuid, command text, args jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  member_role text;
  previous heart_game.requests%rowtype;
  item heart_game.rewards%rowtype;
  amount integer;
  title text;
begin
  select role into member_role from heart_game.members where user_id=auth.uid();
  if member_role is null then raise exception 'Нет доступа к игре' using errcode='42501'; end if;
  -- This project has a single shared wallet. Serialize all writes to it.
  perform pg_catalog.pg_advisory_xact_lock(68143279);
  select * into previous from heart_game.requests where id=request_id;
  if found then
    if previous.actor=auth.uid() and previous.command=command and previous.args=args then return; end if;
    raise exception 'Эта операция уже выполнена';
  end if;
  case command
    when 'adjust' then
      if member_role <> 'admin' then raise exception 'Начисление доступно только в пульте жены'; end if;
      amount := (args->>'delta')::integer;
      title := trim(args->>'title');
      if amount is null or amount=0 or abs(amount)>9999 or coalesce(length(title),0) not between 1 and 100 then
        raise exception 'Проверь сумму и повод';
      end if;
      insert into heart_game.events(id,title,delta) values(request_id,title,amount);
    when 'buy' then
      if member_role <> 'player' then raise exception 'Покупки доступны в кабинете игрока'; end if;
      select * into strict item from heart_game.rewards where id=(args->>'reward')::integer;
      if item.price is distinct from (args->>'price')::integer or item.name is distinct from args->>'name' then raise exception 'Награда изменилась. Открой магазин заново'; end if;
      if (select coalesce(sum(delta),0) from heart_game.events)<item.price then raise exception 'Не хватает сердечек'; end if;
      insert into heart_game.events(id,title,delta) values(request_id,item.name,-item.price);
      insert into heart_game.coupons(id,name) values(request_id,item.name);
    when 'use' then
      update heart_game.coupons set used=true where id=(args->>'coupon')::uuid and not used;
      if not found then raise exception 'Купон уже использован или недоступен'; end if;
    when 'edit' then
      if member_role <> 'admin' then raise exception 'Магазином управляет жена'; end if;
      update heart_game.rewards set name=trim(args->>'name'),price=(args->>'price')::integer where id=(args->>'reward')::integer;
      if not found then raise exception 'Награда недоступна'; end if;
    else raise exception 'Неизвестное действие';
  end case;
  insert into heart_game.requests values(request_id,auth.uid(),command,args);
end $$;
revoke all on function public.heart_snapshot(),public.heart_action(uuid,text,jsonb) from public,anon;
grant execute on function public.heart_snapshot(),public.heart_action(uuid,text,jsonb) to authenticated;
commit;
