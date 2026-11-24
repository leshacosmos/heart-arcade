const questArt = new Map([
  ['01-breakfast','Завтрак'], ['02-flowers','Цветы'], ['03-tidy','Уборка'],
  ['04-groceries','За продуктами'], ['05-walk','Прогулка'], ['06-meet','Встретить с работы'],
  ['07-note','Записка'], ['08-care','Чашка чая'], ['09-movie','Киновечер'], ['10-date','Свидание']
]);

function newQuestDraft(){
  return {title:'',reward:'5',illustration:'01-breakfast'};
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
    <fieldset><legend>Иллюстрация</legend><div class="quest-picker">${options}</div></fieldset>
    <button class="btn primary">Создать задание</button></form>`;
}

function questCard(q){
  const image=questArt.has(q.illustration)?`<img src="assets/quest-cards/${q.illustration}.jpg" alt="" width="80" height="80">`:'';
  const finish=state.role==='admin' && !q.completed_at?`<button class="btn" data-finish="${safe(q.id)}">Завершить</button>`:'';
  return `<article class="quest-card">${image}<div><h3>${safe(q.title)}</h3><span class="price">+${q.reward} ♥</span></div>${finish}</article>`;
}

function questsView(){
  const active=state.quests.filter(q=>!q.completed_at),done=state.quests.filter(q=>q.completed_at);
  return '<h1 class="page">Задания</h1>'+(state.role==='admin'?questForm():'')+
    '<section><h2>Активные задания</h2>'+(active.map(questCard).join('') || '<p class="empty">Пока нет активных заданий.</p>')+'</section>'+
    (done.length?'<section><h2>Выполненные задания</h2>'+done.map(questCard).join('')+'</section>':'');
}
