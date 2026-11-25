import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

const db=new PGlite();
try {
  await db.exec(`create role anon; create role authenticated;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('app.test_uid',true),'')::uuid $$;`);
  for(const name of ['001_game','003_quests','005_pair_play','007_admin_actions']){
    await db.exec(await readFile(new URL('../database/'+name+'.sql',import.meta.url),'utf8'));
  }
  const admin=randomUUID(),player=randomUUID();
  await db.query('insert into auth.users values($1),($2)',[admin,player]);
  await db.query("insert into heart_game.members values($1,'admin'),($2,'player')",[admin,player]);
  const who=id=>db.query("select set_config('app.test_uid',$1,false)",[id]);
  const act=(fn,cmd,args,id=randomUUID())=>db.query('select public.'+fn+'($1,$2,$3)',[id,cmd,args]);
  const adminAction=(...args)=>act('heart_admin_action',...args);
  const questAction=(...args)=>act('heart_quest_action',...args);
  const snapshot=async()=>(await db.query('select public.heart_play_snapshot() as game')).rows[0].game;
  await db.exec('set role authenticated');
  await who(admin);
  const reward={name:'Прогулка',price:7},key=randomUUID();
  await adminAction('createReward',reward,key);
  await adminAction('createReward',reward,key);
  await assert.rejects(adminAction('createReward',{...reward,price:8},key));
  await adminAction('createReward',{name:'Каток',price:8});
  const quest=randomUUID(),other=randomUUID(),task={title:'Чай',reward:10,illustration:'08-care'};
  await questAction('createQuest',task,quest);
  await questAction('createQuest',task,other);
  await who(player);
  let game=await snapshot();
  assert.equal(game.rewards.length,5);
  assert.equal(game.rewards[3].name,reward.name);
  await assert.rejects(adminAction('createReward',reward));
  await assert.rejects(adminAction('deleteQuest',{quest}));
  await questAction('submitQuest',{quest});
  await who(admin);
  await questAction('finishQuest',{quest});
  await adminAction('deleteQuest',{quest});
  assert.deepEqual((await snapshot()).quests.map(q=>q.id),[other]);
  await adminAction('deleteQuest',{quest:other});
  await who(player);
  game=await snapshot();
  assert.equal(game.quests.length,0);
  assert.equal(game.events[0].delta,10);
  await assert.rejects(questAction('submitQuest',{quest:other}));
  await act('heart_action','buy',{reward:3,...reward});
  game=await snapshot();
  assert.equal(game.coupons[0].name,reward.name);
  assert.equal(game.events.reduce((sum,e)=>sum+e.delta,0),3);
  console.log('PASS: fourth and fifth rewards, replay, role checks, purchase and coupon, quest deletion and balance');
} finally { await db.close(); }
