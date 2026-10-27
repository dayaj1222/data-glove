// Scenario checks for lib/blockWorld.js: run with  node tools/check_block_world.mjs  (from frontend/)
import { BlockWorld } from '../src/lib/blockWorld.js';
const run=(w,secs)=>{ for(let i=0;i<secs*60;i++) w.step(1/60); };
const r=(v)=>+v.toFixed(2);
// 1 drop on table
let w=new BlockWorld(); let a=w.addBlock(0,3,0,1,1); run(w,2); console.log('1 table  y=',r(a.body.position.y),'expect 0.5');
// 2 stack centred
let b=w.addBlock(0.05,4,0,1,1); run(w,2); console.log('2 stack  y=',r(b.body.position.y),'expect 1.5, upright',r(w.uprightness(b)));
// 3 tower of 7
w=new BlockWorld(); const t=[]; for(let i=0;i<7;i++){ t.push(w.addBlock(0.04*(i%3-1),0.6+i*1.2,0,1,1)); run(w,0.4);} run(w,3);
console.log('3 tower  ys=',t.map(k=>r(k.body.position.y)).join(','),' all upright',t.every(k=>w.uprightness(k)>0.98), ' height',r(w.towerHeight(-9)));
// 4 big overhang drops off
w=new BlockWorld(); a=w.addBlock(0,0.5,0,1,1); run(w,1); b=w.addBlock(0.9,3,0,1,1); run(w,3); console.log('4 overhang y=',r(b.body.position.y),'x=',r(b.body.position.x),'expect on table (y~0.5) or lying');
// 5 solid: held block driven sideways into a standing block must push it, not pass through
w=new BlockWorld(); const wall=w.addBlock(2,0.5,0,1,1); const h=w.addBlock(-1,0.5,0,1,1); run(w,1);
let maxY=0; for(let i=0;i<240;i++){ w.hold(h,4,0.5,0,1/60); w.step(1/60); maxY=Math.max(maxY,h.body.position.y); }
console.log('   held max y while pushing', r(maxY));
console.log('5 solid  held x=',r(h.body.position.x),' wall x=',r(wall.body.position.x),' overlap?', Math.abs(h.body.position.x-wall.body.position.x)<0.95 && Math.abs(h.body.position.z-wall.body.position.z)<0.95 ? 'YES (bad)':'no');
// 6 held block cannot sink through the table
w=new BlockWorld(); const h6=w.addBlock(0,2,0,1,1); for(let i=0;i<120;i++){ w.hold(h6,0,-3,0,1/60); w.step(1/60);} console.log('6 table  held y=',r(h6.body.position.y),'expect >=0.5');
// 7 pulling out the bottom block drops the ones above
w=new BlockWorld(); const s=[w.addBlock(0,0.5,0,1,1),w.addBlock(0,1.6,0,1,1),w.addBlock(0,2.7,0,1,1)]; run(w,3);
console.log('7 exposed bottom?',w.exposed(s[0]),'top?',w.exposed(s[2]),' ys',s.map(k=>r(k.body.position.y)).join(','));
w.removeBlock(s[0]); run(w,3); console.log('7 after removing bottom ys',s.slice(1).map(k=>r(k.body.position.y)).join(','),'expect 0.5,1.5');

// 8: held block carried over the top of a standing block (y target high) passes over, lands when released
w=new BlockWorld(); const base=w.addBlock(0,0.5,0,1,1); const c=w.addBlock(-3,0.5,0,1,1); run(w,1);
for(let i=0;i<120;i++){ w.hold(c,0,3.5,0,1/60); w.step(1/60);} w.release(c); run(w,3);
console.log('8 carry over  c y=',r(c.body.position.y),'x=',r(c.body.position.x),'expect rest on top 1.5');
// 9: tower of 5 built by hold/release, then nudged by a held block sliding along it must not pass through
w=new BlockWorld(); const tt=[]; for(let i=0;i<5;i++){ tt.push(w.addBlock(0,0.5+i*1.0,0,1,1)); } run(w,3);
const hh=w.addBlock(-3,0.5,0,1,1); run(w,0.5); for(let i=0;i<200;i++){ w.hold(hh,1,0.5,0,1/60); w.step(1/60);} 
console.log('9 solid vs tower: held x=',r(hh.body.position.x),'expect <=0 (stopped at the tower),  tower upright',tt.every(k=>w.uprightness(k)>0.98));
