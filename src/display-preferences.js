export const fonts={standard:'system-ui, sans-serif',gothic:'"Yu Gothic", "Hiragino Kaku Gothic ProN", sans-serif',serif:'"Yu Mincho", "Hiragino Mincho ProN", serif',mono:'ui-monospace, "BIZ UDGothic", monospace'};
export function normalizeDisplay(value={}){return {iconMode:value?.iconMode==='roles'?'roles':'dots',theme:['dark','light','sepia'].includes(value?.theme)?value.theme:'dark',font:Object.hasOwn(fonts,value?.font)?value.font:'standard',viewer:value?.viewer==='plain'?'plain':'markdown'};}
export function displayPreferences(){try{return normalizeDisplay(JSON.parse(globalThis.localStorage?.getItem('village-display')||'{}'));}catch{return normalizeDisplay();}}
export function applyDisplay(){if(typeof document!=='undefined'){const p=displayPreferences();document.documentElement.style.setProperty('--reply-font',fonts[p.font]);document.documentElement.dataset.theme=p.theme;}}
export function saveDisplay(value){const settings=normalizeDisplay(value);localStorage.setItem('village-display',JSON.stringify(settings));applyDisplay();window.dispatchEvent(new Event('display-change'));}
applyDisplay();
