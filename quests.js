const questArt = new Map([
  ['01-breakfast','Завтрак'], ['02-flowers','Цветы'], ['03-tidy','Уборка'],
  ['04-groceries','За продуктами'], ['05-walk','Прогулка'], ['06-meet','Встретить с работы'],
  ['07-note','Записка'], ['08-care','Чашка чая'], ['09-movie','Киновечер'], ['10-date','Свидание']
]);

function newQuestDraft(){
  return {title:'',reward:'5',secret:false,hint:'',illustration:'01-breakfast'};
}
let questDraft=newQuestDraft();

function questForm(){
  const options=Array.from(questArt,([key,label])=>`
    <label class="quest-option"><input type="radio" name="illustration" value="${key}" ${questDraft.illustration===key?'checked':''} required>
      <span><img src="assets/quest-cards/${key}.jpg" width="128" height="128" alt=""><b>${label}</b></span></label>`).join('');
  return `<form class="panel quest-form" id="questForm">
    <h2>Новое задание</h2>
    <label for="questTitle">Что сделать?</label>
    <input class="field" id="questTitle" name="title" maxlength="100" required placeholder="Например, приготовить завтрак" value="${safe(questDraft.title)}">
    <label for="questReward">Награда в сердечках</label>
    <input class="field" id="questReward" name="reward" type="number" inputmode="numeric" min="1" max="9999" step="1" required value="${safe(questDraft.reward)}">
    <label class="secret-toggle"><input type="checkbox" name="secret" ${questDraft.secret?'checked':''}> Секретная миссия</label>
    <div id="clueField" ${questDraft.secret?'':'hidden'}><label for="questHint">Подсказка до раскрытия</label>
      <input class="field" id="questHint" name="hint" maxlength="100" ${questDraft.secret?'required':''} value="${safe(questDraft.hint)}" placeholder="Например, освободи вечер пятницы"></div>
    <fieldset><legend>Иллюстрация</legend><div class="quest-picker">${options}</div></fieldset>
    <button class="btn primary">Создать задание</button></form>`;
}

function questCard(q){
  const player=state.role==='player',sealed=player && q.hint && !q.revealed_at;
  const image=!sealed && questArt.has(q.illustration)
    ? `<img src="assets/quest-cards/${q.illustration}.jpg" alt="" width="64" height="64">`
    : '<span class="mystery-art" aria-hidden="true">?</span>';
  const id=safe(q.id);
  let action='';
  if(!q.completed_at){
    if(q.submitted_at){
      action=player?'<span class="sub">На подтверждении у Аси</span>':`<button class="btn primary" data-finish="${id}">Подтвердить</button>`;
    }else if(sealed){
      action=`<button class="btn" data-reveal="${id}">Раскрыть миссию</button>`;
    }else if(player){
      action=`<form class="quest-report" data-submit-quest="${id}">
        <label for="note-${id}">Комментарий для Аси <span class="sub">(по желанию)</span></label>
        <input id="note-${id}" class="field" name="note" maxlength="240">
        <button class="btn primary">Я сделал</button></form>`;
    }
  }
  if(!player)action+=`<button type="button" class="link quest-delete" data-delete-quest="${id}" aria-label="Удалить задание «${safe(q.title)}»">Удалить задание</button>`;
  return `<article class="quest-card" tabindex="-1" id="quest-${id}">${image}<div>${q.hint?'<span class="sub">Секретная миссия</span>':''}
    <h3>${safe(sealed?q.hint:q.title)}</h3><span class="price">+${q.reward} ♥</span>
    ${!player && q.hint && !q.revealed_at?`<p class="sub">Подсказка · ${safe(q.hint)}</p>`:''}
    ${q.note?`<p class="quest-note">Леша: ${safe(q.note)}</p>`:''}
    ${action?`<div class="quest-action">${action}</div>`:''}</div></article>`;
}

function questsView(){
  const active=state.quests.filter(q=>!q.completed_at && !q.submitted_at);
  const review=state.quests.filter(q=>!q.completed_at && q.submitted_at);
  const done=state.quests.filter(q=>q.completed_at);
  return '<h1 class="page">Задания</h1>'+
    (review.length?'<section><h2>На подтверждении</h2>'+review.map(questCard).join('')+'</section>':'')+
    (state.role==='admin'?questForm():'')+
    '<section><h2>Активные задания</h2>'+(active.map(questCard).join('') || '<p class="empty">Пока нет активных заданий.</p>')+'</section>'+
    (done.length?'<section><h2>Выполненные задания</h2>'+done.map(questCard).join('')+'</section>':'');
}

function wishSection(){
  const player=state.role==='player';
  const form=player?`<form class="panel" id="wishForm"><label for="wishName">Моё желание</label>
    <input class="field" id="wishName" name="name" maxlength="80" required placeholder="Например, книга-сюрприз от Аси">
    <button class="btn primary">Загадать желание</button></form>`:'';
  const pending=state.wishes.map(w=>player
    ? `<div class="row"><div class="rowtext"><strong>${safe(w.name)}</strong><p class="sub">Ася назначит цену</p></div></div>`
    : `<form class="panel wish-price" data-wish="${safe(w.id)}"><h3>${safe(w.name)}</h3>
      <label for="wish-${safe(w.id)}">Цена в сердечках</label><input id="wish-${safe(w.id)}" class="field" type="number" inputmode="numeric" name="price" min="1" max="9999" required>
      <button class="btn primary">Добавить в магазин</button></form>`).join('');
  if(!player && !pending)return '';
  return `<section class="wishes"><h2>${player?'Загадать желание':'Желания Леши'}</h2>${form}${pending}</section>`;
}
function quickButtons(){
  if(!state.quick.length)return '';
  return '<section><div class="head"><h2>Быстрые сердечки</h2></div><div class="opts">'+state.quick.map(p=>
    `<button class="btn" data-quick="${safe(p.id)}">${safe(p.title)} · +${p.delta} ♥</button>`).join('')+'</div></section>';
}
