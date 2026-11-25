let busy=false, activeUser='', revision='', generation=0, readNumber=0;
let portraitUrl='', portraitPending=false;
function portraitFile(){return state.role==='admin'?'avatar-wife.png':'avatar-player.png'}
function profileAvatar(){return portraitUrl || portraitFile()}
function clearPortrait(){
  if(portraitUrl)URL.revokeObjectURL(portraitUrl);
  portraitUrl='';portraitPending=false;
  el('avatar').removeAttribute('src');
}
async function loadPortrait(){
  if(!client || !activeUser || portraitPending || portraitUrl)return;
  const session=generation;
  portraitPending=true;
  try{
    const {data,error}=await client.storage.from('heart-portraits').download(portraitFile());
    if(error)throw error;
    if(session!==generation)return;
    portraitUrl=URL.createObjectURL(data);
    el('avatar').src=portraitUrl;
    const profile=document.querySelector('.profile img');
    if(profile)profile.src=portraitUrl;
  }catch{
    // Keep the initials available and retry on the next sync.
  }finally{if(session===generation)portraitPending=false}
}
function notice(message=''){
  el('notice').textContent=message;
  el('notice').hidden=!message;
}
let rewardDraft={name:'',price:''};
function rewardEditor(){
  const create=`<form class="panel" id="newReward"><h2>Новая награда</h2>
    <label for="newRewardName">Название награды</label><input id="newRewardName" class="field" name="name" maxlength="80" required value="${safe(rewardDraft.name)}">
    <label for="newRewardPrice">Цена в сердечках</label><input id="newRewardPrice" class="field" name="price" type="number" inputmode="numeric" min="1" max="9999" step="1" required value="${safe(rewardDraft.price)}">
    <button class="btn primary">Добавить награду</button></form>`;
  return '<div class="edit-grid">'+create+rewards.map(r=>`<form class="panel edit" data-item="${r.id}">
    <label for="name-${r.id}">Название награды</label><input class="field" id="name-${r.id}" name="name" required maxlength="80" value="${safe(r.name)}">
    <label for="price-${r.id}">Цена в сердечках</label><input class="field" id="price-${r.id}" name="price" type="number" min="1" max="9999" step="1" required value="${r.price}">
    <button class="btn primary">Сохранить</button></form>`).join('')+'</div>';
}
async function refresh(force=false){
  if(!activeUser)return;
  const n=++readNumber, current=generation;
  const data=await snapshot();
  if(current!==generation || n!==readNumber)return;
  const version=JSON.stringify([data.wishes,data.quick,data.quests,data.events,data.coupons,data.rewards,data.role]);
  if(!force && version===revision){void loadPortrait();return}
  revision=version;
  rewards=data.rewards.map(r=>({...r,paper:(styles[r.id] || styles[2])[0],sprite:(styles[r.id] || styles[2])[1]}));
  state.wishes=data.wishes || [];state.quick=data.quick || [];
  state.events=data.events;
  state.quests=data.quests || [];
  state.coupons=data.coupons;
  if(!isDemo)state.role=data.role;
  el('avatar').src=profileAvatar();
  el('role').value=state.role;
  el('account').hidden=false;
  el('role').hidden=el('demoLabel').hidden=!isDemo;
  el('logout').hidden=isDemo;
  render();
  void loadPortrait();
}
function loginScreen(){
  pushBox.hidden=true;pushRegistration=null;pushEnabled=false;
  rewardDraft={name:'',price:''};
  activeUser='';generation++;revision='';pending=null;clearPortrait();
  if(el('dialog').open)el('dialog').close();
  state.page='home';state.quests=[];questDraft=newQuestDraft();state.events=[];state.coupons=[];
  el('account').hidden=true;el('nav').replaceChildren();
  el('view').innerHTML=`<form id="login" class="panel login"><h1>Вход в игру</h1>
    <label for="email">Почта</label><input class="field" id="email" type="email" autocomplete="username" required>
    <label for="password">Пароль</label><input class="field" id="password" type="password" autocomplete="current-password" required>
    <button class="btn primary">Войти</button></form>`;
}
let configuredProfiles=[];
function localLoginScreen(){
  loginScreen();
  el('view').innerHTML=`<form class="panel login" id="localLogin"><h1>Ваши кабинеты</h1>
   <div class="profile-picker">${[['player','Леша','avatar-player.png'],['admin','Ася','avatar-wife.png']].map(([value,label,src])=>
     `<label><input type="radio" name="profile" value="${value}" ${value==='player'?'checked':''}><span><img src="${src}" alt="" width="64" height="64">${label}</span></label>`).join('')}</div>
   <label for="password" id="passwordLabel"></label><input id="password" class="field" type="password" maxlength="256" required>
   <label for="repeat" id="repeatLabel">Повтори пароль</label><input id="repeat" class="field" type="password" autocomplete="new-password">
   <button id="enterLocal" class="btn primary"></button></form>`;
  updateLocalForm();
}
function updateLocalForm(){
  const setup=!configuredProfiles.includes(el('localLogin').elements.profile.value);
  el('password').value='';el('repeat').value='';
  el('passwordLabel').textContent=setup?'Придумай пароль от 8 символов':'Пароль';
  el('password').minLength=setup?8:1;el('password').autocomplete=setup?'new-password':'current-password';
  el('repeatLabel').hidden=el('repeat').hidden=!setup;el('repeat').required=setup;
  el('enterLocal').textContent=setup?'Создать кабинет':'Войти';
}
document.addEventListener('change',e=>{if(e.target.name==='profile'){notice();updateLocalForm()}});
async function localStart(){
  const session=await localApi('session');
  configuredProfiles=session.profiles;
  if(session.user)await enter(session.user);else localLoginScreen();
}
async function enter(user){
  generation++;clearPortrait();activeUser=user;
  const route=pushRoute(...location.hash.slice(1).split('/'));
  state.page=route.page;pushAnchor=route.anchor;
  if(location.hash==='#home' || route.page!=='home')window.history.replaceState(null,'',location.pathname+location.search);
  try{await refresh(true);notice();void preparePush()}
  catch(error){if(isLocal)localLoginScreen();else loginScreen();notice(error.message||'Не удалось открыть кабинет')}
}
async function commit(command,args,success){
  if(busy)return;
  busy=true;
  notice();
  const storageKey='heart-pending:'+activeUser+':'+state.role+':'+command;
  try{
    // Keep the key across refreshes when the server response was lost.
    const signature=JSON.stringify(args);
    let intent=JSON.parse(sessionStorage.getItem(storageKey)||'null');
    if(intent?.signature!==signature){
      intent={id:crypto.randomUUID(),signature};
      sessionStorage.setItem(storageKey,JSON.stringify(intent));
    }
    await writeAction(command,args,intent.id,state.role);
    if(command==='createReward')rewardDraft={name:'',price:''};
    if(command==='createQuest')questDraft=newQuestDraft();
    await refresh(true);
    sessionStorage.removeItem(storageKey);
    toast(success);
  }catch(error){notice(error.message||'Не удалось связаться с игрой. Повтори действие.')}
  finally{busy=false}
}
el('confirm').onclick=()=>{
  const action=pending;
  pending=null;
  el('dialog').close();
  if(action)action();
};
el('role').onchange=()=>{
  if(!isDemo || busy){el('role').value=state.role;return}
  rewardDraft={name:'',price:''};questDraft=newQuestDraft();state.role=el('role').value;state.page='home';
  el('avatar').src=profileAvatar();
  notice();render();
};
el('logout').onclick=async()=>{
  if(busy)return;
  if(isLocal){
    try{await localApi('logout',{});await localStart();notice()}catch(e){notice(e.message)}
    return;
  }
  if(pushWorking)return;
  try{await disconnectPush()}catch{notice('Не удалось отключить уведомления перед выходом. Повтори попытку.');return}
  const {error}=await client.auth.signOut({scope:'local'});
  if(error){notice(error.message);return}
  loginScreen();notice();
};
document.addEventListener('click',e=>{
  const button=e.target.closest('button');
  if(!button || busy || !activeUser)return;
  if(button.dataset.page){pushAnchor='';state.page=button.dataset.page;notice();render();return}
  if(button.hasAttribute('data-delta')){
    el('customDelta').value=button.dataset.delta;
    el('customDelta').dispatchEvent(new Event('input',{bubbles:true}));return;
  }
  if(button.hasAttribute('data-reward')){
    const r=rewards[Number(button.dataset.reward)],left=balance()-r.price;
    if(left<0){modal(r.name,`Не хватает ${-left} ♥. Сейчас на счету ${balance()} ♥.`);return}
    modal(r.name,`Списать ${r.price} ♥? На счету останется ${left} ♥.`,'Забрать купон',
      ()=>commit('buy',{reward:r.id,price:r.price,name:r.name},'Купон в коллекции'));
  }
  if(button.dataset.quick){
    const p=state.quick.find(p=>p.id===button.dataset.quick);
    if(p)void commit('adjust',{title:p.title,delta:p.delta},`Начислено +${p.delta} ♥`);
    return;
  }
  if(button.dataset.deleteQuest && state.role==='admin'){
    const q=state.quests.find(q=>q.id===button.dataset.deleteQuest);
    if(q){
      const message='Задание исчезнет из обоих кабинетов.'+(q.completed_at?' Заработанные сердечки останутся у Леши.':'');
      modal('Удалить «'+q.title+'»?',message,'Удалить',()=>commit('deleteQuest',{quest:q.id},'Задание удалено'));
      el('close').focus();
    }
    return;
  }
  if(button.dataset.reveal){
    void commit('revealQuest',{quest:button.dataset.reveal},'Миссия раскрыта');
    return;
  }
  if(button.dataset.finish){
    const q=state.quests.find(q=>q.id===button.dataset.finish);
    if(q)modal(q.title,`Подтвердить выполнение и начислить Леше ${q.reward} ♥?`,'Подтвердить',()=>commit('finishQuest',{quest:q.id},'Задание выполнено'));
    return;
  }
  if(button.dataset.use){
    const c=state.coupons.find(c=>c.id===button.dataset.use);
    modal(c.name,'Отметить купон использованным?','Использовать',()=>commit('use',{coupon:c.id},'Купон использован'));
  }
});
document.addEventListener('input',e=>{
  if(e.target.form?.id==='newReward'){rewardDraft[e.target.name]=e.target.value;return}
  if(e.target.form?.id==='questForm'){
    if(e.target.name==='secret'){
      questDraft.secret=e.target.checked;
      el('clueField').hidden=!questDraft.secret;el('questHint').required=questDraft.secret;
    }else questDraft[e.target.name]=e.target.value;
    return;
  }
  if(e.target.id!=='customDelta')return;
  state.delta=e.target.valueAsNumber;
  const valid=e.target.validity.valid && state.delta!==0;
  document.querySelectorAll('[data-delta]').forEach(x=>x.setAttribute('aria-pressed',Number(x.dataset.delta)===state.delta));
  el('saveQuick').disabled=!valid || state.delta<1;
  el('apply').disabled=!valid;el('apply').textContent=valid?deltaText():'Укажи количество';
});
document.addEventListener('submit',async e=>{
  e.preventDefault();
  if(busy)return;
  const form=e.target;
  if(form.id==='localLogin'){
    const role=form.elements.profile.value, password=el('password').value;
    const setup=!configuredProfiles.includes(role);
    if(setup && password!==el('repeat').value){notice('Пароли различаются');return}
    busy=true;
    try{await localApi(setup?'setup':'login',{role,password});await localStart()}
    catch(error){notice(error.message)}
    finally{busy=false}
  }else if(form.id==='login'){
    busy=true;
    try{
      const {data,error}=await client.auth.signInWithPassword({email:el('email').value.trim(),password:el('password').value});
      if(error)throw error;
      await enter(data.user.id);
    }catch{notice('Не удалось войти. Проверь почту, пароль и подключение.')}
    finally{busy=false}
  }else if(form.id==='questForm'){
    const title=form.elements.title.value.trim(),reward=form.elements.reward.valueAsNumber,illustration=form.elements.illustration.value;
    if(!title || !Number.isInteger(reward) || reward<1 || reward>9999 || !questArt.has(illustration)){notice('Проверь название, награду и иллюстрацию');return}
    const hint=form.elements.secret.checked?form.elements.hint.value.trim():null;
    if(hint===''){notice('Добавь подсказку для Леши');return}
    await commit('createQuest',{title,reward,illustration,hint},'Задание создано');
  }else if(form.dataset.submitQuest){
    await commit('submitQuest',{quest:form.dataset.submitQuest,note:form.elements.note.value.trim()},'Отправлено Асе на подтверждение');
  }else if(form.id==='wishForm'){
    const name=form.elements.name.value.trim();
    if(!name){notice('Введи название желания');return}
    await commit('wish',{name},'Желание отправлено Асе');
  }else if(form.dataset.wish){
    await commit('publishWish',{wish:form.dataset.wish,price:form.elements.price.valueAsNumber},'Желание в магазине');
  }else if(form.id==='adjust'){
    const title=el('reason').value.trim(),delta=el('customDelta').valueAsNumber;
    if(!title || !Number.isInteger(delta) || !delta || Math.abs(delta)>9999){notice('Укажи количество и повод');return}
    if(e.submitter?.value==='saveQuick'){
      if(delta>0)await commit('saveQuick',{title,delta},'Быстрый повод сохранён');
      return;
    }
    await commit('adjust',{title,delta},delta>0?'Сердечки начислены':'Сердечки списаны');
  }else if(form.id==='newReward'){
    const name=form.elements.name.value.trim(),price=form.elements.price.valueAsNumber;
    if(!name || !Number.isInteger(price) || price<1 || price>9999){notice('Проверь название и цену');return}
    await commit('createReward',{name,price},'Награда в магазине');
  }else if(form.classList.contains('edit')){
    const name=form.elements.name.value.trim(),price=form.elements.price.valueAsNumber;
    if(!name){notice('Введи название награды');return}
    await commit('edit',{reward:Number(form.dataset.item),name,price},'Награда сохранена');
  }
});
async function start(){
  if(isLocal){await localStart();return}
  if(isDemo){
    el('previewMode').hidden=false;
    await enter('preview');
  }else{
    if(!window.heartConfig?.url || !window.heartConfig?.publishableKey)throw Error('Для входа нужен адрес проекта и публичный ключ Supabase.');
    await new Promise((resolve,reject)=>{
      const s=document.createElement('script');s.src='vendor/supabase.js';
      s.onload=resolve;s.onerror=()=>reject(Error('Не удалось загрузить модуль входа'));document.head.append(s);
    });
    client=supabase.createClient(window.heartConfig.url,window.heartConfig.publishableKey);
    const {data,error}=await client.auth.getSession();
    if(error)throw error;
    if(data.session)await enter(data.session.user.id);else loginScreen();
    client.auth.onAuthStateChange((event,session)=>{
      if(event==='SIGNED_OUT')loginScreen();
      if(event==='SIGNED_IN' && activeUser && session.user.id!==activeUser)loginScreen();
    });
  }
}
async function sync(){
  if(!activeUser || busy || document.hidden || document.activeElement?.closest('form') || el('dialog').open)return;
  try{await refresh()}catch(error){if(isLocal && error.status===401){await localStart();return}notice('Не удалось обновить кабинет. Проверь подключение.')}
}
window.addEventListener('focus',sync);
document.addEventListener('visibilitychange',sync);
setInterval(sync,8000);
start().catch(e=>notice(e.message||'Не удалось открыть игру'));
