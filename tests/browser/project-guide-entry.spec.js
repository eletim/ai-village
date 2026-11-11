import {test,expect} from '@playwright/test';
test('retired office routes are absent',async({request})=>{for(const path of ['/office','/office/','/office.html'])expect((await request.get(path)).status()).toBe(404);});
