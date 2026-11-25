begin;
create or replace function public.heart_admin_action(request_id uuid, command text, args jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare previous heart_game.requests%rowtype;
begin
  if not exists (select 1 from heart_game.members where user_id=auth.uid() and role='admin') then
    raise exception 'Это действие доступно только Асе' using errcode='42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(68143279);
  select * into previous from heart_game.requests where id=request_id;
  if found then
    if previous.actor=auth.uid() and previous.command=command and previous.args=args then return; end if;
    raise exception 'Эта операция уже выполнена';
  end if;
  case command
    when 'deleteQuest' then
      delete from heart_game.quests where id=(args->>'quest')::uuid;
    when 'createReward' then
      insert into heart_game.rewards(id,name,price)
        select coalesce(max(id),2)+1,trim(args->>'name'),(args->>'price')::integer from heart_game.rewards;
    else raise exception 'Неизвестное действие';
  end case;
  insert into heart_game.requests values(request_id,auth.uid(),command,args);
end $$;
revoke all on function public.heart_admin_action(uuid,text,jsonb) from public, anon;
grant execute on function public.heart_admin_action(uuid,text,jsonb) to authenticated;
commit;
