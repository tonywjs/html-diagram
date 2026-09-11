/* Aside repl: 각 모델 poster.html 브라우저 검증(품질 스니펫·드래그·스크린샷). FOLDERS를 바꿔 실행 */
const FOLDERS=__FOLDERS__; const BASE='http://127.0.0.1:8790/';
const SNIP=__SNIP__;
const out={}; await fs.mkdir('./artifacts',{recursive:true});
for(const f of FOLDERS){
  const r={};
  try{
    await openTab(BASE+f+'/poster.html'); await sleep(1200);
    r.quality=JSON.parse(await page.evaluate(SNIP));
    r.render=await page.evaluate(()=>{ const edges=[...document.querySelectorAll('.fig-edge')]; return {edges:edges.length, hidden:edges.filter(e=>e._warned).length, labels:[...document.querySelectorAll('.fig-elabel')].filter(l=>l.style.display!=='none').length, nodes:document.querySelectorAll('.fig-node').length, canvases:document.querySelectorAll('.fig-canvas').length, title:document.title, fig:!!window.FigEditor, height:document.documentElement.scrollHeight}; });
    // drag test: first node that is an edge endpoint
    await page.evaluate(()=>FigEditor.setEdit(true)); await sleep(200);
    const target=await page.evaluate(()=>{ const e=[...document.querySelectorAll('.fig-edge')].find(e=>e._geom&&document.getElementById(e.dataset.from)); return e?{node:e.dataset.from, edge:e.id||null, idx:[...document.querySelectorAll('.fig-edge')].indexOf(e)}:null; });
    if(target){
      const before=await page.evaluate(i=>{ const e=document.querySelectorAll('.fig-edge')[i]; return {p0:e._geom.p0, left:document.getElementById(e.dataset.from).offsetLeft}; },target.idx);
      const bb=await page.locator('#'+target.node).boundingBox().catch(()=>null);
      if(bb){ await page.mouse.move(bb.x+bb.width/2,bb.y+bb.height/2); await page.mouse.down(); for(let i=1;i<=8;i++) await page.mouse.move(bb.x+bb.width/2+i*5,bb.y+bb.height/2+i*4); await page.mouse.up(); await sleep(250); }
      const after=await page.evaluate(i=>{ const e=document.querySelectorAll('.fig-edge')[i]; return {p0:e._geom.p0, left:document.getElementById(e.dataset.from).offsetLeft}; },target.idx);
      r.drag={node:target.node, moved:after.left!==before.left, edgeFollowed:JSON.stringify(after.p0)!==JSON.stringify(before.p0)};
      await page.keyboard.press('Meta+z'); await sleep(250);
    } else r.drag={node:null};
    await page.evaluate(()=>FigEditor.setEdit(false)); await sleep(200);
    const H=r.render.height; const shots=[];
    for(let y=0;y<H;y+=850){ await page.evaluate(v=>window.scrollTo(0,v),y); await sleep(250); const p='./artifacts/'+f+'-'+y+'.png'; await page.screenshot({path:p}); shots.push(p); if(shots.length>=5) break; }
    r.shots=shots;
  }catch(e){ r.error=String(e).slice(0,300); }
  out[f]=r;
}
out.pwd=pwd; console.log('VERIFY '+JSON.stringify(out));
