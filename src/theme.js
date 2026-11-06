import {applyDisplay} from './display-preferences.js';
export function initTheme(){applyDisplay();window.addEventListener('storage',e=>{if(e.key==='village-display'){applyDisplay();window.dispatchEvent(new Event('display-change'));}});}
