begin;
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

create table heart_game.push_settings (
  singleton boolean primary key default true check(singleton),
  vapid jsonb not null, gateway_key text not null, function_url text not null
);
create table heart_game.push_devices (
  endpoint text primary key, owner uuid not null references heart_game.members(user_id) on delete cascade,
  keys jsonb not null
);
create table heart_game.push_jobs (
  id uuid primary key default gen_random_uuid(),
  endpoint text not null references heart_game.push_devices on delete cascade,
  payload jsonb not null, created_at timestamptz not null default now(),
  next_attempt timestamptz not null default now(), lease_until timestamptz, attempts int not null default 0
);

create function public.heart_push_init(candidate jsonb, gateway_key text, function_url text) returns void
language sql security definer set search_path='' as $$
  insert into heart_game.push_settings values(true,candidate,gateway_key,function_url)
  on conflict(singleton) do update set gateway_key=excluded.gateway_key,function_url=excluded.function_url;
$$;

create function public.heart_push_device(op text, device jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare url text := device->>'endpoint'; uid uuid:=auth.uid(); k jsonb:=device->'keys';
begin
  if not exists(select 1 from heart_game.members where user_id=uid) then raise insufficient_privilege; end if;
  case op
    when 'status' then
      return jsonb_build_object('key',(select vapid->>'publicKey' from heart_game.push_settings),
        'enabled',exists(select 1 from heart_game.push_devices where endpoint=url and owner=uid));
    when 'off' then delete from heart_game.push_devices where endpoint=url and owner=uid;
    when 'on' then
      if not coalesce(length(url)<=2048 and url ~ '^https://(fcm\.googleapis\.com|([a-z0-9-]+\.)*push\.apple\.com|([a-z0-9-]+\.)*push\.services\.mozilla\.com|([a-z0-9-]+\.)*notify\.windows\.com)/[A-Za-z0-9_~./:%?&=+-]+$'
         and (k->>'p256dh') ~ '^[A-Za-z0-9_-]{87}$' and (k->>'auth') ~ '^[A-Za-z0-9_-]{22}$',false)
      then raise exception 'Браузер вернул неподдерживаемую подписку'; end if;
      insert into heart_game.push_devices values(url,uid,jsonb_build_object('p256dh',k->>'p256dh','auth',k->>'auth'))
      on conflict(endpoint) do update set keys=excluded.keys where heart_game.push_devices.owner=uid;
      if not found then raise exception 'Подписка принадлежит другому кабинету'; end if;
    when 'test' then
      if not exists(select 1 from heart_game.push_devices where endpoint=url and owner=uid) then raise insufficient_privilege; end if;
      insert into heart_game.push_jobs(endpoint,payload) values(url,jsonb_build_object('title','Уведомления работают','body','Это проверка связи с игрой.','page','home','tag',gen_random_uuid()));
      perform heart_game.dispatch_push();
    else raise exception 'Неизвестное действие';
  end case;
  return '{}'::jsonb;
end $$;

create function heart_game.dispatch_push() returns void
language plpgsql security definer set search_path='' as $$
declare s heart_game.push_settings%rowtype; j record;
begin
  select * into s from heart_game.push_settings;
  if not found then return; end if;
  delete from heart_game.push_jobs where created_at < now()-interval '1 day';
  for j in select id,attempts from heart_game.push_jobs where next_attempt<=now()
    order by next_attempt limit 20 for update skip locked loop
    update heart_game.push_jobs set attempts=attempts+1,
      next_attempt=now()+make_interval(mins=>least(30,1<<least(5,j.attempts))) where id=j.id;
    perform net.http_post(url:=s.function_url, headers:=jsonb_build_object('Authorization','Bearer '||s.gateway_key,'Content-Type','application/json'),
      body:=jsonb_build_object('job',j.id),timeout_milliseconds:=25000);
  end loop;
exception when others then
  raise warning 'Push dispatch deferred until retry';
end $$;

create function public.heart_push_claim(job uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare j heart_game.push_jobs%rowtype;
begin
  update heart_game.push_jobs set lease_until=now()+interval '45 seconds'
  where id=job and (lease_until is null or lease_until < now()) returning * into j;
  if not found then return null; end if;
  return (select jsonb_build_object('subscription',jsonb_build_object('endpoint',d.endpoint,'keys',d.keys),
    'payload',j.payload,'vapid',s.vapid) from heart_game.push_devices d cross join heart_game.push_settings s where d.endpoint=j.endpoint);
end $$;

create function public.heart_push_ack(job uuid, expired boolean) returns void
language plpgsql security definer set search_path='' as $$
begin
  if expired then
    delete from heart_game.push_devices where endpoint=(select endpoint from heart_game.push_jobs where id=job);
  else delete from heart_game.push_jobs where id=job; end if;
end $$;

create function heart_game.queue_game_push() returns trigger
language plpgsql security definer set search_path='' as $$
declare heading text; body text; page text:='quests';
begin
  case new.command
    when 'adjust' then
      if (new.args->>'delta')::int<=0 then return new; end if;
      heading:='Баланс пополнен'; page:='home';
      body:='+'||(new.args->>'delta')||' ♥ · '||(new.args->>'title');
    when 'createQuest' then
      heading:='Новое задание';
      body:=(new.args->>'title')||' · '||(new.args->>'reward')||' ♥';
    when 'finishQuest' then
      heading:='Задание выполнено';
      select title||' · +'||reward||' ♥' into strict body from heart_game.quests where id=(new.args->>'quest')::uuid;
    else return new;
  end case;
  insert into heart_game.push_jobs(endpoint,payload) select endpoint,
    jsonb_build_object('title',heading,'body',body,'page',page,'tag',new.id) from heart_game.push_devices;
  if found then perform heart_game.dispatch_push(); end if;
  return new;
end $$;
create trigger heart_game_notifications after insert on heart_game.requests
for each row execute function heart_game.queue_game_push();

revoke all on function public.heart_push_init(jsonb,text,text),public.heart_push_claim(uuid),public.heart_push_ack(uuid,boolean),public.heart_push_device(text,jsonb) from public,anon,authenticated;
grant execute on function public.heart_push_device(text,jsonb) to authenticated;
grant execute on function public.heart_push_init(jsonb,text,text),public.heart_push_claim(uuid),public.heart_push_ack(uuid,boolean) to service_role;
select cron.schedule('heart-push-retry','* * * * *','select heart_game.dispatch_push()');
commit;
