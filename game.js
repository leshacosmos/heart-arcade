// The offline preview shares a single IndexedDB record between this browser's tabs.
const demoRewards = [
  {id: 0, name: 'Кино на мой вкус', price: 10},
  {id: 1, name: 'Завтрак в постель', price: 25},
  {id: 2, name: 'Свидание-сюрприз', price: 50}
];
const demoSeed = {rewards: demoRewards, coupons: [], requests: {}, events: [
  {title: 'Встретил после работы', delta: 5, time: 'Пример'},
  {title: 'Опоздал и не предупредил', delta: -2, time: 'Пример'},
  {title: 'Приготовил ужин', delta: 15, time: 'Пример'}
]};
let demoDatabase;
function openDemo(){
  if(!demoDatabase) demoDatabase = new Promise((resolve,reject)=>{
    const req=indexedDB.open('heart-arcade-preview',1);
    req.onupgradeneeded=()=>req.result.createObjectStore('game');
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error);
  });
  return demoDatabase;
}
async function demoTransaction(change){
  const db=await openDemo();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction('game',change?'readwrite':'readonly');
    const store=tx.objectStore('game');
    const read=store.get('wallet');
    let game;
    read.onsuccess=()=>{
      game=read.result || structuredClone(demoSeed);
      if(!change)return;
      try{change(game);store.put(game,'wallet')}
      catch(error){tx.abort();reject(error)}
    };
    tx.oncomplete=()=>resolve(game);
    tx.onabort=()=>reject(tx.error || new Error('Не удалось сохранить действие'));
  });
}
function applyDemo(game,command,args,id,role){
  if(game.requests[id])return;
  const item=game.rewards.find(r=>r.id===args.reward);
  const event={id,date:new Date().toISOString()};
  if(command==='createQuest' || command==='finishQuest'){
    if(role!=='admin')throw Error('Заданиями управляет Ася');
    game.quests ||= [];
    if(command==='createQuest'){
      if(!questArt.has(args.illustration) || !args.title.trim() || args.title.length>100 || !Number.isInteger(args.reward) || args.reward<1 || args.reward>9999)throw Error('Проверь данные задания');
      game.quests.unshift({id,title:args.title.trim(),reward:args.reward,illustration:args.illustration,created_at:event.date,completed_at:null});
    }else{
      const quest=game.quests.find(q=>q.id===args.quest);
      if(!quest || quest.completed_at)throw Error('Задание уже закрыто или недоступно');
      quest.completed_at=event.date;
      game.events.unshift({...event,title:quest.title,delta:quest.reward});
    }
  }else if(command==='adjust'){
    if(role!=='admin')throw Error('Начисления доступны в пульте жены');
    game.events.unshift({...event,title:args.title,delta:args.delta});
  }else if(command==='buy'){
    if(role!=='player' || item.price!==args.price || item.name!==args.name)throw Error('Обнови магазин');
    if(game.events.reduce((s,e)=>s+e.delta,0)<item.price)throw Error('Не хватает сердечек');
    game.events.unshift({...event,title:item.name,delta:-item.price});
    game.coupons.unshift({id,name:item.name,used:false});
  }else if(command==='use'){
    const coupon=game.coupons.find(c=>c.id===args.coupon);
    if(!coupon || coupon.used)throw Error('Купон уже использован или недоступен');
    coupon.used=true;
  }else if(command==='edit'){
    if(role!=='admin')throw Error('Магазином управляет жена');
    item.name=args.name;
    item.price=args.price;
  }
  game.requests[id]=true;
}
const isDemo=window.heartConfig?.url==='' && window.heartConfig?.publishableKey==='';
const isLocal=window.heartLocal===true;
async function localApi(path,body){
  const options=body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)};
  const response=await fetch('api/'+path,{...options,cache:'no-store'});
  const data=await response.json();
  if(!response.ok)throw Object.assign(Error(data.message),{status:response.status});
  return data;
}
let client;
async function snapshot(){
  if(isLocal)return localApi('state');
  if(isDemo)return demoTransaction();
  const {data,error}=await client.rpc('heart_snapshot_with_quests');
  if(error)throw error;
  return data;
}
async function writeAction(command,args,id,role){
  if(isLocal)return localApi('action',{command,args,id});
  if(isDemo)return demoTransaction(g=>applyDemo(g,command,args,id,role));
  const {error}=await client.rpc(['createQuest','finishQuest'].includes(command)?'heart_quest_action':'heart_action',{request_id:id,command,args});
  if(error)throw error;
}
