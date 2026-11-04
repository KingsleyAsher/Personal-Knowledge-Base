import {test} from 'node:test';import assert from 'node:assert/strict';import path from 'node:path';import {desktopDataPath} from '../main/storage-path.js';
test('direct EXE uses the same persistent profile as the real-library launcher',()=>{
 const home=path.resolve('synthetic-user');assert.equal(desktopDataPath({packaged:true,home,appDir:'app'}),path.join(home,'.dsh','knowledge-desktop-client'));
 assert.equal(desktopDataPath({override:'isolated-test',packaged:true,home,appDir:'app'}),path.resolve('isolated-test'));
 assert.equal(desktopDataPath({packaged:false,home,appDir:'app'}),path.resolve('app','.runtime'));
});
