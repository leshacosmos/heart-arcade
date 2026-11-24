begin;
create table heart_game.quests (
  id uuid primary key,
  title text not null check (length(trim(title)) between 1 and 100),
  reward integer not null check (reward between 1 and 9999),
  illustration text not null check (illustration in (
    '01-breakfast','02-flowers','03-tidy','04-groceries','05-walk',
    '06-meet','07-note','08-care','09-movie','10-date')),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create function public.heart_snapshot_with_quests() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare game jsonb;
begin
  game := public.heart_snapshot();
  return game || jsonb_build_object('quests',coalesce(
    (select jsonb_agg(to_jsonb(q) order by q.created_at desc,q.id) from heart_game.quests q),'[]'::jsonb));
end $$;

create function public.heart_quest_action(request_id uuid, command text, args jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  previous heart_game.requests%rowtype;
  quest heart_game.quests%rowtype;
begin
  if not exists (select 1 from heart_game.members where user_id=auth.uid() and role='admin') then
    raise exception 'Заданиями управляет Ася' using errcode='42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(68143279);
  select * into previous from heart_game.requests where id=request_id;
  if found then
    if previous.actor=auth.uid() and previous.command=command and previous.args=args then return; end if;
    raise exception 'Эта операция уже выполнена';
  end if;
  case command
    when 'createQuest' then
      insert into heart_game.quests(id,title,reward,illustration)
      values(request_id,trim(args->>'title'),(args->>'reward')::integer,args->>'illustration');
    when 'finishQuest' then
      update heart_game.quests set completed_at=now()
      where id=(args->>'quest')::uuid and completed_at is null returning * into quest;
      if not found then raise exception 'Задание уже закрыто или недоступно'; end if;
      insert into heart_game.events(id,title,delta) values(request_id,quest.title,quest.reward);
    else raise exception 'Неизвестное действие';
  end case;
  insert into heart_game.requests values(request_id,auth.uid(),command,args);
end $$;

revoke all on function public.heart_snapshot_with_quests(),public.heart_quest_action(uuid,text,jsonb) from public,anon;
grant execute on function public.heart_snapshot_with_quests(),public.heart_quest_action(uuid,text,jsonb) to authenticated;
commit;
