// Device-level settings. Register only for the public game after login.
const pushBox = document.getElementById('pushSettings');
const pushHint = document.getElementById('pushHint');
const pushToggle = document.getElementById('pushToggle');
const pushTest = document.getElementById('pushTest');
let pushRegistration, pushKey, pushEnabled=false, pushWorking=false;

async function deviceRpc(op, device={}) {
  const {data,error} = await client.rpc('heart_push_device', {op,device});
  if (error) throw error;
  return data;
}

function pushControls(enabled) {
  pushEnabled=enabled;
  pushToggle.hidden=false;
  pushToggle.disabled=false;
  pushToggle.textContent=enabled?'Выключить':'Включить уведомления';
  pushTest.hidden=!enabled;
  pushHint.textContent=enabled?'Уведомления включены на этом устройстве.':'Получай уведомления о сердечках и заданиях на этом устройстве.';
}

async function preparePush() {
  const session=generation;
  pushToggle.hidden=pushTest.hidden=true;
  const standalone=matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const ios=/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform==='MacIntel' && navigator.maxTouchPoints>1);
  if (isLocal || isDemo) {
    pushHint.innerHTML='Для уведомлений открой <a href="https://leshacosmos.github.io/heart-arcade/">публичную игру</a> на телефоне.';
    return;
  }
  if (ios && !standalone) {
    pushHint.textContent='Добавь игру на экран «Домой» через меню «Поделиться» и открой её с иконки.';
    return;
  }
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    pushHint.textContent='Этот браузер не поддерживает push-уведомления. На iPhone нужна iOS 16.4 или новее.';
    return;
  }
  if (Notification.permission==='denied') {
    pushHint.textContent='Разреши уведомления для игры в настройках устройства или браузера, затем открой игру снова.';
    return;
  }
  pushHint.textContent='Проверяю настройки устройства…';
  try {
    await navigator.serviceWorker.register('./push-worker.js');
    const registration=await navigator.serviceWorker.ready;
    const sub=await registration.pushManager.getSubscription();
    const status=await deviceRpc('status',sub?.toJSON());
    if (generation!==session)return;
    if (!status.key)throw Error('Missing public key');
    pushRegistration=registration;
    pushKey=Uint8Array.from(atob(status.key.replace(/-/g,'+').replace(/_/g,'/')), c=>c.charCodeAt(0));
    pushControls(status.enabled && Boolean(sub));
  } catch {
    if(generation!==session)return;
    pushHint.textContent='Не удалось проверить подключение.';
    pushToggle.hidden=false;pushToggle.disabled=false;pushToggle.textContent='Повторить';
    pushRegistration=null;
  }
}

async function disconnectPush() {
  if (!pushRegistration)return;
  const sub=await pushRegistration.pushManager.getSubscription();
  if (sub) {
    // Either removing the server address or revoking the browser endpoint stops delivery.
    const [server,browser]=await Promise.allSettled([
      deviceRpc('off',{endpoint:sub.endpoint}),sub.unsubscribe()
    ]);
    if(server.status==='rejected' && browser.status==='rejected')throw server.reason;
  }
}

pushToggle.onclick=async()=>{
  if(pushWorking)return;
  if(!pushRegistration){await preparePush();return}
  pushWorking=true;
  pushToggle.disabled=true;
  try {
    if(pushEnabled){
      await disconnectPush();pushControls(false);
    }else{
      const permission=await Notification.requestPermission();
      if(permission!=='granted'){await preparePush();return}
      const sub=await pushRegistration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:pushKey});
      await deviceRpc('on',sub.toJSON());
      pushControls(true);
    }
  }catch{pushHint.textContent='Не удалось изменить настройку. Проверь подключение и разрешение на уведомления.'}
  finally{pushWorking=false;pushToggle.disabled=false}
};
pushTest.onclick=async()=>{
  if(pushWorking)return;
  pushTest.disabled=true;pushWorking=true;
  try {
    const sub=await pushRegistration.pushManager.getSubscription();
    if(!sub){await preparePush();return}
    await deviceRpc('test',{endpoint:sub.endpoint});
    pushHint.textContent='Проверочное уведомление отправлено в очередь.';
  }catch{pushHint.textContent='Не удалось отправить проверку. Попробуй ещё раз.'}
  finally{pushTest.disabled=false;pushWorking=false}
};
navigator.serviceWorker?.addEventListener('message',event=>{
  if(event.data?.type!=='heart-open')return;
  const page=event.data.page==='quests'?'quests':'home';
  if(!activeUser){location.hash=page;return}
  state.page=page;render();void sync();
});
