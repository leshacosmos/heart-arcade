begin;
select pg_advisory_xact_lock(68143279);
alter table heart_game.push_devices add column mission_reveals boolean not null default false;
create table heart_game.wish_rewards (
  reward_id integer primary key references heart_game.rewards(id) on delete cascade,
  wish_id uuid unique,
  already_affordable boolean not null
);
-- Before this migration, all rewards after the three starter items came from wishes.
insert into heart_game.wish_rewards(reward_id,already_affordable)
select id,price<=(select coalesce(sum(delta),0) from heart_game.events) from heart_game.rewards where id>2;

create function public.heart_mission_push(endpoint_url text, enabled boolean default null) returns boolean
language plpgsql security definer set search_path='' as $$
declare setting boolean;
begin
  if not exists(select 1 from heart_game.members where user_id=auth.uid() and role='admin') then raise insufficient_privilege; end if;
  if enabled is null then
    select mission_reveals into setting from heart_game.push_devices where endpoint=endpoint_url and owner=auth.uid();
  else
    update heart_game.push_devices set mission_reveals=enabled where endpoint=endpoint_url and owner=auth.uid() returning mission_reveals into setting;
  end if;
  if not found then raise exception 'Сначала включи уведомления на этом устройстве'; end if;
  return setting;
end $$;
revoke all on function public.heart_mission_push(text,boolean) from public,anon;
grant execute on function public.heart_mission_push(text,boolean) to authenticated;

create or replace function public.heart_quest_action(request_id uuid, command text, args jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare
  member_role text; previous heart_game.requests%rowtype; q heart_game.quests%rowtype;
  new_reward integer; wish_name text; clue text:=trim(args->>'hint'); player_action boolean:=command in ('revealQuest','submitQuest','wish');
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
        select coalesce(max(id),2)+1,wish_name,(args->>'price')::int from heart_game.rewards returning id into new_reward;
      insert into heart_game.wish_rewards(reward_id,wish_id,already_affordable)
      values(new_reward,(args->>'wish')::uuid,(select coalesce(sum(delta),0) from heart_game.events)>=(args->>'price')::int);
    when 'saveQuick' then
      insert into heart_game.quick_hearts values(request_id,trim(args->>'title'),(args->>'delta')::int)
        on conflict(title,delta) do nothing;
    else raise exception 'Неизвестное действие';
  end case;
  insert into heart_game.requests values(request_id,auth.uid(),command,args);
end $$;
create or replace function heart_game.queue_game_push() returns trigger
language plpgsql security definer set search_path='' as $$
declare
  heading text; body text; page text:='quests'; target_role text; anchor text;
  added int; balance_now bigint; unlocked_count int; unlocked_name text; reward heart_game.rewards%rowtype;
begin
  case new.command
    when 'wish' then
      target_role:='admin'; page:='shop'; anchor:='wish-'||new.id; heading:='У Леши новое желание';
      body:=trim(new.args->>'name')||' · Назначь цену';
    when 'publishWish' then
      select r.* into strict reward from heart_game.wish_rewards w join heart_game.rewards r on r.id=w.reward_id
        where w.wish_id=(new.args->>'wish')::uuid;
      target_role:='player'; page:='shop'; anchor:='reward-'||reward.id;
      heading:='Твоё желание в магазине'; body:=reward.name||' · '||reward.price||' ♥';
    when 'buy' then
      target_role:='admin'; page:='coupons'; anchor:='coupon-'||new.id; heading:='Леша купил награду';
      select name||' · Купон у Леши' into strict body from heart_game.coupons where id=new.id;
    when 'revealQuest' then
      target_role:='admin'; anchor:='quest-'||(new.args->>'quest'); heading:='Леша раскрыл миссию';
      select title into strict body from heart_game.quests where id=(new.args->>'quest')::uuid;
    when 'adjust' then
      added:=(new.args->>'delta')::int;
      if added<=0 then return new; end if;
      heading:='Баланс пополнен'; page:='home'; body:='+'||added||' ♥ · '||(new.args->>'title');
    when 'createQuest' then
      heading:=case when new.args->>'hint' is null then 'Новое задание' else 'Секретная миссия' end;
      body:=coalesce(new.args->>'hint',new.args->>'title')||' · '||(new.args->>'reward')||' ♥';
    when 'submitQuest' then
      target_role:='admin'; heading:='Леша выполнил задание';
      select title||' · Подтверди выполнение' into strict body from heart_game.quests where id=(new.args->>'quest')::uuid;
    when 'finishQuest' then
      heading:='Задание выполнено';
      select title||' · +'||q.reward||' ♥',q.reward into strict body,added from heart_game.quests q where id=(new.args->>'quest')::uuid;
    else return new;
  end case;
  if added>0 then
    select sum(delta) into balance_now from heart_game.events;
    with unlocked as (
      update heart_game.wish_rewards w set already_affordable=true from heart_game.rewards r
      where r.id=w.reward_id and not w.already_affordable and r.price>balance_now-added and r.price<=balance_now
      returning w.reward_id
    ) select count(*),(array_agg(r.name order by r.price,r.id))[1] into unlocked_count,unlocked_name
      from unlocked u join heart_game.rewards r on r.id=u.reward_id;
  end if;
  insert into heart_game.push_jobs(endpoint,payload)
  select d.endpoint,jsonb_strip_nulls(jsonb_build_object('title',heading,'page',page,'anchor',anchor,'tag',new.id,'body',
    case when m.role='player' and unlocked_count>0 then body||'. Теперь хватает на «'||unlocked_name||'»'||
      case when unlocked_count>1 then ' и ещё '||(unlocked_count-1) else '' end||'!' else body end))
  from heart_game.push_devices d join heart_game.members m on m.user_id=d.owner
  where (target_role is null or m.role=target_role) and (new.command<>'revealQuest' or d.mission_reveals);
  if found then perform heart_game.dispatch_push(); end if;
  return new;
end $$;
commit;
