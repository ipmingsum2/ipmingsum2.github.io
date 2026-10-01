import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
const code=await readFile(new URL('../../js/chat-audio.js',import.meta.url),'utf8');
test('audio controls display metadata, seek, mute and pause other clips',async()=>{
 const dom=new JSDOM('<!doctype html>',{url:'https://chat.example',runScripts:'outside-only'}),w=dom.window;
 w.HTMLMediaElement.prototype.pause=function(){this.wasPaused=true;};w.eval(code);
 for(let i=0;i<2;i++){const el=w.document.createElement('chat-audio');el.setAttribute('src','https://example.com/clip'+i+'.mp3');el.setAttribute('filename','clip.mp3');el.setAttribute('bytes','36382');w.document.body.append(el);}
 const [a,b]=w.document.querySelectorAll('chat-audio');assert.equal(a.querySelector('.audio-filename').textContent,'clip.mp3');assert.equal(a.querySelector('.audio-meta').textContent,'35.53 KB');
 Object.defineProperty(a.player,'duration',{value:10});a.player.currentTime=2;a.player.dispatchEvent(new w.Event('loadedmetadata'));assert.equal(a.querySelector('.audio-time').textContent,'0:02 / 0:10');
 const seek=a.querySelector('.audio-seek');seek.value='50';seek.dispatchEvent(new w.Event('input'));assert.equal(a.player.currentTime,5);
 a.querySelector('.audio-mute').click();assert.equal(a.player.muted,true);assert.equal(a.querySelector('.audio-mute').getAttribute('aria-label'),'Unmute audio');
 a.player.dispatchEvent(new w.Event('play'));assert.equal(b.player.wasPaused,true);
 w.document.body.append(a);await Promise.resolve();assert.equal(a.player.wasPaused,undefined,'moving a playing player during refresh must not pause it');
 a.remove();await Promise.resolve();assert.equal(a.player.wasPaused,true);w.close();
});
test('audio does not accept executable or insecure external sources',()=>{const dom=new JSDOM('<!doctype html>',{url:'https://chat.example',runScripts:'outside-only'}),w=dom.window;w.eval(code);for(const src of ['javascript:alert(1)','http://example.com/audio.mp3']){const el=w.document.createElement('chat-audio');el.setAttribute('src',src);w.document.body.append(el);assert.equal(el.querySelector('audio'),null);}w.close();});
