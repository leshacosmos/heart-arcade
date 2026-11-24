begin;
alter table heart_game.quests
  add column hint text check(length(trim(hint)) between 1 and 100),
  add column revealed_at timestamptz,
  add column submitted_at timestamptz,
  add column note text check(length(note)<=240);

create table heart_game.wishes (
  id uuid primary key, name text not null check(length(trim(name)) between 1 and 80),
  created_at timestamptz not null default now()
);
create table heart_game.quick_hearts (
  id uuid primary key, title text not null check(length(trim(title)) between 1 and 100),
  delta integer not null check(delta between 1 and 9999),
  unique(title,delta)
);

create function public.heart_play_snapshot() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare game jsonb:=public.heart_snapshot(); admin boolean:=(game->>'role')='admin';
begin
  return game || jsonb_build_object(
    'quests',coalesce((select jsonb_agg(case when not admin and q.hint is not null and q.revealed_at is null
      then to_jsonb(q)||jsonb_build_object('title',q.hint,'illustration',null) else to_jsonb(q) end
      order by q.created_at desc,q.id) from heart_game.quests q),'[]'::jsonb),
    'wishes',coalesce((select jsonb_agg(to_jsonb(w) order by w.created_at,w.id) from heart_game.wishes w),'[]'::jsonb),
    'quick',case when admin then coalesce((select jsonb_agg(to_jsonb(p) order by p.title,p.id) from heart_game.quick_hearts p),'[]'::jsonb) else '[]'::jsonb end);
end $$;

-- Previously installed clients only have artwork for the original three reward IDs.
create or replace function public.heart_snapshot_with_quests() returns jsonb
language sql stable security definer set search_path='' as $$
  select (g-'wishes'-'quick') || jsonb_build_object('rewards',
    (select jsonb_agg(r order by (r->>'id')::int) from jsonb_array_elements(g->'rewards') r where (r->>'id')::int between 0 and 2))
  from public.heart_play_snapshot() g;
$$;

create or replace function public.heart_quest_action(request_id uuid, command text, args jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare
  member_role text; previous heart_game.requests%rowtype; q heart_game.quests%rowtype;
  wish_name text; clue text:=trim(args->>'hint'); player_action boolean:=command in ('revealQuest','submitQuest','wish');
begin
  select role into member_role from heart_game.members where user_id=auth.uid();
  if member_role is distinct from (case when player_action then 'player' else 'admin' end)
    then raise exception 'Действие недоступно в этом кабинете' using errcode='42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(68143279);
  select * into previous from heart_game.requests where id=request_id;
  if found then
    if previous.actor=auth.uid() and previous.command=command and previous.args=args then return; end if;
    raise exception 'Эта операция уже выполнена';
  end if;
  case command
    when 'createQuest' then
      insert into heart_game.quests(id,title,reward,illustration,hint)
      values(request_id,trim(args->>'title'),(args->>'reward')::int,args->>'illustration',clue);
    when 'revealQuest' then
      update heart_game.quests set revealed_at=now() where id=(args->>'quest')::uuid and
        hint is not null and revealed_at is null and completed_at is null;
      if not found then raise exception 'Миссия уже раскрыта или недоступна'; end if;
    when 'submitQuest' then
      update heart_game.quests set submitted_at=now(),note=nullif(trim(args->>'note'),'')
      where id=(args->>'quest')::uuid and submitted_at is null and completed_at is null
        and (hint is null or revealed_at is not null);
      if not found then raise exception 'Проверь статус задания'; end if;
    when 'finishQuest' then
      update heart_game.quests set completed_at=now() where id=(args->>'quest')::uuid
        and submitted_at is not null and completed_at is null returning * into q;
      if not found then raise exception 'Подтвердить можно только задание, которое Леша отправил на проверку'; end if;
      insert into heart_game.events(id,title,delta) values(request_id,q.title,q.reward);
    when 'wish' then
      insert into heart_game.wishes(id,name) values(request_id,trim(args->>'name'));
    when 'publishWish' then
      delete from heart_game.wishes where id=(args->>'wish')::uuid returning name into wish_name;
      if not found then raise exception 'Желание уже добавлено в магазин'; end if;
      insert into heart_game.rewards(id,name,price)
        select coalesce(max(id),2)+1,wish_name,(args->>'price')::int from heart_game.rewards;
    when 'saveQuick' then
      insert into heart_game.quick_hearts values(request_id,trim(args->>'title'),(args->>'delta')::int)
        on conflict(title,delta) do nothing;
    else raise exception 'Неизвестное действие';
  end case;
  insert into heart_game.requests values(request_id,auth.uid(),command,args);
end $$;
revoke all on function public.heart_play_snapshot() from public,anon;
grant execute on function public.heart_play_snapshot() to authenticated;

-- Only the cloud deployment attaches this trigger (004_web_push.sql).
create or replace function heart_game.queue_game_push() returns trigger
language plpgsql security definer set search_path='' as $$
declare heading text; body text; page text:='quests'; target_role text;
begin
  case new.command
    when 'adjust' then
      if (new.args->>'delta')::int<=0 then return new; end if;
      heading:='Баланс пополнен'; page:='home'; body:='+'||(new.args->>'delta')||' ♥ · '||(new.args->>'title');
    when 'createQuest' then
      heading:=case when new.args->>'hint' is null then 'Новое задание' else 'Секретная миссия' end;
      body:=coalesce(new.args->>'hint',new.args->>'title')||' · '||(new.args->>'reward')||' ♥';
    when 'submitQuest' then
      target_role:='admin'; heading:='Леша выполнил задание';
      select title||' · Подтверди выполнение' into strict body from heart_game.quests where id=(new.args->>'quest')::uuid;
    when 'finishQuest' then
      heading:='Задание выполнено';
      select title||' · +'||reward||' ♥' into strict body from heart_game.quests where id=(new.args->>'quest')::uuid;
    else return new;
  end case;
  insert into heart_game.push_jobs(endpoint,payload) select d.endpoint,
    jsonb_build_object('title',heading,'body',body,'page',page,'tag',new.id)
    from heart_game.push_devices d join heart_game.members m on m.user_id=d.owner
    where target_role is null or m.role=target_role;
  if found then perform heart_game.dispatch_push(); end if;
  return new;
end $$;
commit;
