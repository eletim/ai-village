export const fonts={standard:'system-ui, sans-serif',gothic:'"Yu Gothic", "Hiragino Kaku Gothic ProN", sans-serif',serif:'"Yu Mincho", "Hiragino Mincho ProN", serif',mono:'ui-monospace, "BIZ UDGothic", monospace'};
export function normalizeDisplay(value={}){return {font:Object.hasOwn(fonts,value?.font)?value.font:'standard',viewer:value?.viewer==='plain'?'plain':'markdown'};}
export function displayPreferences(){try{return normalizeDisplay(JSON.parse(globalThis.localStorage?.getItem('village-display')||'{}'));}catch{return normalizeDisplay();}}
export function applyDisplay(){if(typeof document!=='undefined')document.documentElement.style.setProperty('--reply-font',fonts[displayPreferences().font]);}
export function saveDisplay(value){const settings=normalizeDisplay(value);localStorage.setItem('village-display',JSON.stringify(settings));applyDisplay();window.dispatchEvent(new Event('display-change'));}
applyDisplay();
