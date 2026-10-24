// Visibility belongs to navigation, never to polling or asynchronous document responses.
const narrow = matchMedia('(max-width: 760px)');
const ids = { conversation:'office-conversation', reports:'office-reports', documents:'village-library', memo:'office-memo', todos:'office-todos' };
let right = 'reports', mobile = 'conversation';
const panel = name => document.getElementById(ids[name]);
function sync() {
  const active = document.activeElement;
  for (const name of Object.keys(ids)) {
    const visible = narrow.matches ? name === mobile : name === 'conversation' || name === right;
    panel(name).hidden = !visible;
    panel(name).setAttribute('aria-hidden', String(!visible));
    document.getElementById(`open-${name}`).setAttribute('aria-pressed', String(visible));
  }
  document.querySelector('.office-panels').hidden = narrow.matches ? mobile === 'conversation' : !right;
  document.querySelector('.office-workspace').classList.toggle('chat-wide', !right);
  if (active?.closest('[hidden]')) document.getElementById(`open-${narrow.matches ? mobile : right || 'conversation'}`).focus({preventScroll:true});
  document.dispatchEvent(new Event('office-panel-change'));
}
export function selectOfficePanel(name) {
  if (!ids[name]) return;
  mobile = name;
  right = name === 'conversation' ? null : name;
  sync();
  const target = name === 'conversation' ? document.getElementById('request') : panel(name);
  target.focus({preventScroll:true});
}
export function closeOfficeLibrary() {
  selectOfficePanel('conversation');
}
export function initOfficePanels() {
  for (const name of Object.keys(ids)) {
    panel(name).tabIndex = -1;
    document.getElementById(`open-${name}`).setAttribute('aria-controls', ids[name]);
  }
  for (const name of ['memo','todos']) document.getElementById(`open-${name}`).addEventListener('click',()=>selectOfficePanel(name));
  document.querySelectorAll('[data-close-panel]').forEach(button => button.addEventListener('click', () => selectOfficePanel('conversation')));
  narrow.addEventListener('change',sync);
  sync();
}
