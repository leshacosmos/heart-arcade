-- Run after 006 as migration owner. All devices, events and queued sends roll back.
begin;
do $$
declare
  a uuid:=(select user_id from heart_game.members where role='admin');
  p uuid:=(select user_id from heart_game.members where role='player');
  wish uuid:=gen_random_uuid(); published uuid:=gen_random_uuid(); credit uuid:=gen_random_uuid();
  purchase uuid:=gen_random_uuid(); other_credit uuid:=gen_random_uuid(); reveal uuid:=gen_random_uuid();
  job uuid; q uuid; item integer; tag text; rec record;
  saved text:='Проверочное желание'; addr_a text:='test-admin-'||wish; addr_p text:='test-player-'||wish;
begin
  perform pg_advisory_xact_lock(68143279);
  insert into heart_game.push_devices(endpoint,owner,keys) values(addr_a,a,'{}'),(addr_p,p,'{}');
  insert into heart_game.events(id,title,delta) select gen_random_uuid(),'Test balance',-coalesce(sum(delta),0) from heart_game.events;
  -- Keep the isolated balance test independent of other existing wishes and prices.
  update heart_game.wish_rewards set already_affordable=true;
  perform set_config('request.jwt.claim.sub',p::text,true);
  perform public.heart_quest_action(wish,'wish',jsonb_build_object('name',saved));
  perform set_config('request.jwt.claim.sub',a::text,true);
  perform public.heart_quest_action(published,'publishWish',jsonb_build_object('wish',wish,'price',8));
  perform public.heart_quest_action(published,'publishWish',jsonb_build_object('wish',wish,'price',8));
  select reward_id into strict item from heart_game.wish_rewards where wish_id=wish;
  perform public.heart_action(credit,'adjust','{"title":"Test","delta":8}');
  perform set_config('request.jwt.claim.sub',p::text,true);
  perform public.heart_action(purchase,'buy',jsonb_build_object('name',saved,'price',8,'reward',item));
  perform set_config('request.jwt.claim.sub',a::text,true);
  perform public.heart_action(other_credit,'adjust','{"title":"Test again","delta":8}');
  for rec in select * from (values
    (wish,addr_a,'wish-'||wish),(published,addr_p,'reward-'||item),(purchase,addr_a,'coupon-'||purchase)
  ) as expected(id,addr,anchor) loop
    select count(*) into strict item from heart_game.push_jobs where payload->>'tag'=rec.id::text and endpoint in (addr_a,addr_p);
    if item<>1 or not exists(select 1 from heart_game.push_jobs where endpoint=rec.addr and payload->>'tag'=rec.id::text and payload->>'anchor'=rec.anchor)
      then raise exception 'Incorrect destination or duplicate for %',rec.id; end if;
  end loop;
  if (select count(*) from heart_game.push_jobs where endpoint=addr_p and payload->>'tag'=credit::text)<>1 or
    not exists(select 1 from heart_game.push_jobs where endpoint=addr_p and payload->>'tag'=credit::text and payload->>'body' like '%Теперь хватает%') or
    exists(select 1 from heart_game.push_jobs where payload->>'tag'=other_credit::text and payload->>'body' like '%Теперь хватает%')
    then raise exception 'Incorrect affordability notification'; end if;
  for i in 1..3 loop
    perform set_config('request.jwt.claim.sub',a::text,true);
    if i>1 then perform public.heart_mission_push(addr_a,i=2); end if;
    q:=gen_random_uuid(); reveal:=gen_random_uuid();
    perform public.heart_quest_action(q,'createQuest','{"title":"Test secret","hint":"Test clue","reward":2,"illustration":"07-note"}');
    perform set_config('request.jwt.claim.sub',p::text,true);
    perform public.heart_quest_action(reveal,'revealQuest',jsonb_build_object('quest',q));
    if exists(select 1 from heart_game.push_jobs where endpoint=addr_a and payload->>'tag'=reveal::text)<>(i=2)
      or exists(select 1 from heart_game.push_jobs where endpoint=addr_p and payload->>'tag'=reveal::text)
      then raise exception 'Incorrect per-device reveal setting';end if;
  end loop;
end $$;
rollback;
select 'Пять сценариев проверены' as result;
