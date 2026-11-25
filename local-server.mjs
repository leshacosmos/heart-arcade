import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {mkdir,readFile} from 'node:fs/promises';
import {createHash,randomBytes,randomUUID,scrypt,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
import {PGlite} from '@electric-sql/pglite';

const directory=path.dirname(fileURLToPath(import.meta.url));
const port=Number(process.env.HEART_PORT||4178);
const origin='http://127.0.0.1:'+port;
const dataPath=process.env.HEART_DATA_DIR || path.join(directory,'.local-data');
const hashPassword=promisify(scrypt);
const hashToken=value=>createHash('sha256').update(value).digest('hex');
const fail=(status,message)=>Object.assign(new Error(message),{status});
const files=new Set(['index.html','quests.js','push-route.js','push.js','push-worker.js','game.js','cabinet.js','manifest.webmanifest','avatar-wife.png','avatar-player.png','icon-192.png','icon-512.png']);
await mkdir(dataPath,{recursive:true,mode:0o700});
// Acquire the listener before opening the database so two app instances cannot use it.
const server=http.createServer();
await new Promise((ok,no)=>{server.once('error',no);server.listen(port,'127.0.0.1',ok)});
const db=new PGlite(dataPath);
if(!(await db.query("select to_regclass('heart_game.members') as members")).rows[0].members){
  const migration=await readFile(path.join(directory,'database/001_game.sql'),'utf8');
  await db.transaction(async tx=>{
    await tx.exec(`create role anon;create role authenticated;
      create schema auth;create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('app.heart_user',true),'')::uuid $$;
      create table auth.passwords(user_id uuid primary key references auth.users,salt text not null,digest text not null);
      create table auth.sessions(token_hash text primary key,user_id uuid not null references auth.users,expires timestamptz not null);`);
    await tx.exec(migration.replace(/^begin;$/m,'').replace(/^commit;$/m,''));
  });
}
if(!(await db.query("select to_regclass('heart_game.quests') as quests")).rows[0].quests){
  await db.exec(await readFile(path.join(directory,'database/003_quests.sql'),'utf8'));
}
if(!(await db.query("select to_regclass('heart_game.wishes') as wishes")).rows[0].wishes){
  await db.exec(await readFile(path.join(directory,'database/005_pair_play.sql'),'utf8'));
}
if(!(await db.query("select to_regprocedure('public.heart_admin_action(uuid,text,jsonb)') as fn")).rows[0].fn){
  await db.exec(await readFile(path.join(directory,'database/007_admin_actions.sql'),'utf8'));
}
const attempts=new Map();
async function account(body,setup){
  const {role,password}=body;
  if(!['player','admin'].includes(role)||typeof password!=='string'||!password.length||password.length>256)throw fail(400,'Проверь профиль и пароль');
  const recent=(attempts.get(role)||[]).filter(t=>t>Date.now()-60000);
  if(recent.length>=10)throw fail(429,'Попробуй ещё раз через минуту');
  recent.push(Date.now());attempts.set(role,recent);
  if(setup && password.length<8)throw fail(400,'Выбери пароль от 8 символов');
  const member=(await db.query('select user_id,salt,digest from heart_game.members join auth.passwords using(user_id) where role=$1',[role])).rows[0];
  let uid;
  if(setup){
    if(member)throw fail(409,'У кабинета уже есть пароль');
    uid=randomUUID();
    const salt=randomBytes(16).toString('hex'),digest=(await hashPassword(password,salt,64)).toString('hex');
    await db.transaction(async tx=>{
      await tx.query('insert into auth.users values($1)',[uid]);
      await tx.query('insert into heart_game.members values($1,$2)',[uid,role]);
      await tx.query('insert into auth.passwords values($1,$2,$3)',[uid,salt,digest]);
    });
  }else{
    if(!member || !timingSafeEqual(await hashPassword(password,member.salt,64),Buffer.from(member.digest,'hex')))
      throw fail(401,'Проверь пароль');
    uid=member.user_id;
  }
  attempts.delete(role);
  const token=randomBytes(32).toString('hex');
  await db.query("insert into auth.sessions values($1,$2,now()+interval '30 days')",[hashToken(token),uid]);
  return token;
}
const send=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(value))};
async function readJson(req){
  let bytes=0;const chunks=[];
  for await(const chunk of req){bytes+=chunk.length;if(bytes>4096)throw fail(413,'Запрос слишком длинный');chunks.push(chunk)}
  try{return JSON.parse(Buffer.concat(chunks).toString())}catch{throw fail(400,'Проверь данные запроса')}
}
server.on('request',async(req,res)=>{
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('X-Frame-Options','DENY');
  try{
    if(req.headers.host!=='127.0.0.1:'+port)throw fail(403,'Недоступный адрес');
    const route=new URL(req.url,origin).pathname;
    if(req.method==='GET' && route==='/config.js'){
      res.writeHead(200,{'Content-Type':'application/javascript'});res.end('window.heartLocal=true;');return;
    }
    if(req.method==='GET' && !route.startsWith('/api/')){
      const file=route==='/'?'index.html':route.slice(1);
      if(!files.has(file) && !/^assets\/quest-cards\/(?:01-breakfast|02-flowers|03-tidy|04-groceries|05-walk|06-meet|07-note|08-care|09-movie|10-date)\.jpg$/.test(file))throw fail(404,'Страница не найдена');
      const ext=path.extname(file),mime={'.html':'text/html; charset=utf-8','.js':'application/javascript','.png':'image/png','.jpg':'image/jpeg','.webmanifest':'application/manifest+json'};
      res.writeHead(200,{'Content-Type':mime[ext]});res.end(await readFile(path.join(directory,file)));return;
    }
    if(req.method==='POST' && req.headers.origin!==origin)throw fail(403,'Открой игру по локальному адресу');
    const cookie=req.headers.cookie?.match(/(?:^|; *)heart_session=([a-f0-9]{64})(?:;|$)/)?.[1]||'';
    const tokenHash=hashToken(cookie);
    const uid=(await db.query('select user_id from auth.sessions where token_hash=$1 and expires>now()',[tokenHash])).rows[0]?.user_id;
    if(req.method==='GET' && route==='/api/session'){
      const profiles=(await db.query('select role from heart_game.members')).rows.map(r=>r.role);
      return send(res,200,{user:uid||null,profiles});
    }
    if(req.method==='POST' && ['/api/setup','/api/login'].includes(route)){
      const token=await account(await readJson(req),route==='/api/setup');
      res.setHeader('Set-Cookie','heart_session='+token+'; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000');
      return send(res,200,{ok:true});
    }
    if(!uid)throw fail(401,'Войди в кабинет');
    if(req.method==='POST' && route==='/api/logout'){
      await db.query('delete from auth.sessions where token_hash=$1',[tokenHash]);
      res.setHeader('Set-Cookie','heart_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');return send(res,200,{ok:true});
    }
    const write=req.method==='POST' && route==='/api/action';
    if(!write && !(req.method==='GET' && route==='/api/state'))throw fail(404,'Страница не найдена');
    const body=write?await readJson(req):null;
    const value=await db.transaction(async tx=>{
      await tx.query("select set_config('app.heart_user',$1,true)",[uid]);await tx.exec('set local role authenticated');
      if(!write)return (await tx.query('select public.heart_play_snapshot() as game')).rows[0].game;
      const rpc=['createReward','deleteQuest'].includes(body.command)?'heart_admin_action':
        ['adjust','buy','use','edit'].includes(body.command)?'heart_action':'heart_quest_action';
      await tx.query(`select public.${rpc}($1,$2,$3)`,[body.id,body.command,body.args]);return {ok:true};
    });
    send(res,200,value);
  }catch(error){send(res,error.status||400,{message:error.status||error.code==='P0001'?error.message:'Не удалось выполнить действие. Проверь данные.'})}
});
console.log('Игра открыта на '+origin);
