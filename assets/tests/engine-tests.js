/* fig-editor 엔진 회귀 테스트 (Aside repl 스크립트). run.sh가 픽스처를 조립해 http://127.0.0.1:8765 에 띄운 뒤 실행한다.
   각 테스트는 실제 브라우저 조작(클릭·드래그·키 입력)으로 동작을 검증한다. 콘솔 오류는 Aside repl이 캡처하지 못하므로
   내장 Browser 패널의 read_console_messages로 따로 확인한다. Aside의 boundingBox는 페이지 px보다 약간 축소돼 보고되므로
   드래그 검증은 픽셀 정확도가 아니라 '이동했는가·화살표가 따라왔는가'로 판정한다. */
const BASE='http://127.0.0.1:8765/';
const R={}; function ok(name,cond,info){ R[name]={pass:!!cond,info:String(info).slice(0,300)}; }
// ---- T1/T2: template as-is ----
await openTab(BASE+'template-copy.html'); await sleep(500);
const t1=await page.evaluate(()=>document.title); ok('T1_title_not_placeholder', !t1.includes('<!--'), t1);
const id1=await page.evaluate(()=>document.body.dataset.figDoc); await page.reload(); await sleep(500);
const id2=await page.evaluate(()=>document.body.dataset.figDoc); ok('T2_figdoc_stable_unsaved', id1===id2, id1+' vs '+id2);
// ---- demo page ----
await openTab(BASE+'demo-built.html');
await page.reload(); await sleep(800);
const c=await page.evaluate(()=>FigEditor.clean()); ok('T3_clean_has_no_script', !/<script/i.test(c), 'bytes='+c.length);
await page.evaluate(()=>{ window.showSaveFilePicker=undefined; URL.createObjectURL=()=>'blob:stub'; HTMLAnchorElement.prototype.click=function(){}; FigEditor.setEdit(true); });
await page.evaluate(()=>FigEditor.save(false)); await sleep(200);
await page.evaluate(()=>{ document.getElementById('n-hospital').style.left='20px'; FigEditor.commit(); });
await page.evaluate(()=>FigEditor.save(false)); await sleep(200);
await page.evaluate(()=>{ document.getElementById('n-hospital').style.left='40px'; FigEditor.commit(); });
await page.evaluate(()=>FigEditor.save(false)); await sleep(200);
const h=await page.evaluate(()=>{ const s=FigEditor.serialize(); const m=s.match(/id="fig-history">([\s\S]*?)<\/script>/); const arr=m?JSON.parse(m[1]):[]; return {total:s.length,n:arr.length,sizes:arr.map(a=>a.html.length),nested:arr.map(a=>/fig-history|fig-editor\.js/.test(a.html))}; });
ok('T4_history_not_nested', h.n===2 && !h.nested.some(Boolean) && Math.abs(h.sizes[0]-h.sizes[1])<2000, JSON.stringify(h));
await page.evaluate(()=>{ FigEditor.select(document.getElementById('n-hub')); });
await page.evaluate(()=>FigEditor.save(false)); await sleep(200);
const s5=await page.evaluate(()=>({sel:FigEditor.selection().length,editing:FigEditor.isEditing()})); ok('T5_save_keeps_selection', s5.sel===1&&s5.editing, JSON.stringify(s5));
await page.evaluate(()=>FigEditor.clearSelection());
const lb=page.locator('.fig-elabel',{hasText:'학습(가중치)만 전송'}); await lb.click(); await sleep(150);
const el6=await page.evaluate(()=>{ const l=[...document.querySelectorAll('.fig-elabel')].find(x=>x.textContent.includes('학습')); const r=l.getBoundingClientRect(); const el=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2); return (el.className&&el.className.baseVal!==undefined)?el.className.baseVal:el.className; });
ok('T6_label_center_not_covered', typeof el6==='string'&&el6.includes('fig-elabel'), el6);
await lb.dblclick(); await sleep(150); await page.keyboard.type('수정된 라벨'); await sleep(80);
const pt=await page.evaluate(()=>{ const cv=document.querySelector('.fig-canvas'); const r=cv.getBoundingClientRect(); const s=cv._scale||1; return {x:r.left+1150*s,y:r.top+20*s}; });
await page.mouse.click(pt.x,pt.y); await sleep(200);
const l7=await page.evaluate(()=>document.getElementById('e-p').dataset.label); ok('T7_label_edit_saved_on_canvas_click', l7.includes('수정된 라벨'), l7);
await page.evaluate(()=>{ FigEditor.clearSelection(); FigEditor.select(document.getElementById('e-u')); });
await page.keyboard.press('Meta+d'); await sleep(200);
const ids=await page.evaluate(()=>[...document.querySelectorAll('.fig-edge')].map(e=>e.id)); ok('T8_dup_edge_unique_ids', new Set(ids).size===ids.length, ids.join(','));
// ---- missing ref warns once (콘솔 훅은 로드 후 설치: 초기 경고 여부는 _warned, 재렌더 시 재경고 없음) ----
await openTab(BASE+'test-edges.html'); await page.reload(); await sleep(700);
const w10=await page.evaluate(()=>{ const e=document.getElementById('e-missing'); const initial=e._warned===true; e._warned=false; const got=[]; const o=console.warn; console.warn=function(){ got.push(Array.from(arguments).join(' ')); return o.apply(console,arguments); }; FigEditor.renderAll(); FigEditor.renderAll(); console.warn=o; return {initial,count:got.filter(x=>x.includes('nope')).length}; });
ok('T10_missing_ref_warns_once', w10.initial&&w10.count===1, JSON.stringify(w10));
// ---- right-click must not drag (last: context menu) ----
await page.evaluate(()=>FigEditor.setEdit(true)); await sleep(100);
const nb=await page.locator('#a').boundingBox(); const b9=await page.evaluate(()=>document.getElementById('a').offsetLeft);
await page.mouse.move(nb.x+nb.width/2,nb.y+nb.height/2); await page.mouse.down({button:'right'});
for(let i=1;i<=6;i++) await page.mouse.move(nb.x+nb.width/2+i*10,nb.y+nb.height/2);
await page.mouse.up({button:'right'}); await sleep(150); await page.keyboard.press('Escape');
const a9=await page.evaluate(()=>document.getElementById('a').offsetLeft); ok('T9_right_click_no_drag', b9===a9, b9+'->'+a9);
// ---- T12~T15: 배포용 정적 내보내기(편집기 제거) ----
await openTab(BASE+'demo-built.html'); await page.reload(); await sleep(800);
const ex=await page.evaluate(()=>{ if(!window.FigEditor||typeof FigEditor.exportStatic!=='function') return null; const h=FigEditor.exportStatic(); return {h, edges:document.querySelectorAll('.fig-edge').length, labels:[...document.querySelectorAll('.fig-elabel')].filter(l=>l.style.display!=='none').map(l=>l.textContent)}; });
ok('T12_exportStatic_exists', !!ex, ex?'ok':'FigEditor.exportStatic 없음');
if(ex){
  const h=ex.h;
  const noEngine=!h.includes('fig-editor.js: 편집 가능한')&&!h.includes('id="fig-editor-css"')&&!h.includes('fig-history')&&!h.includes('data-fig-doc')&&!h.includes('figPill')&&!h.includes('figDock');
  const svgG=(h.match(/<g[\s>]/g)||[]).length, dataUi=(h.match(/data-fig-ui/g)||[]).length, edgeDivs=(h.match(/class="fig-edge"/g)||[]).length;
  ok('T13_export_clean_and_baked', noEngine&&h.includes('class="fig-edges"')&&svgG>=ex.edges&&dataUi===0&&ex.labels.every(t=>h.includes(t))&&edgeDivs===ex.edges, JSON.stringify({noEngine,svgG,edges:ex.edges,dataUi,edgeDivs}));
  await openTab('about:blank'); await page.evaluate(html=>{ document.open(); document.write(html); document.close(); }, h); await sleep(800);
  const st=await page.evaluate(()=>({ staticViewer:!!(window.FigEditor&&window.FigEditor.static), pill:!!document.getElementById('figPill'), paths:document.querySelectorAll('.fig-edges path.fe-main[d]').length, labels:document.querySelectorAll('.fig-elabel').length, nodeAbs:getComputedStyle(document.querySelector('.fig-node')).position, hub:document.getElementById('n-hub').offsetLeft, scaled:!!document.querySelector('.fig-scale') }));
  ok('T14_static_renders_without_editor', st.paths>=4&&!st.pill&&st.nodeAbs==='absolute'&&st.hub===481&&st.staticViewer&&st.scaled, JSON.stringify(st));
}
await openTab(BASE+'demo-built.html'); await page.reload(); await sleep(800);
const dl=await page.evaluate(async()=>{ window.showSaveFilePicker=undefined; let blob=null; URL.createObjectURL=b=>{ blob=b; return 'blob:stub'; }; HTMLAnchorElement.prototype.click=function(){}; const btn=document.getElementById('figExportM'); if(!btn) return {btn:false}; btn.click(); await new Promise(r=>setTimeout(r,400)); const txt=blob?await blob.text():''; return {btn:true,len:txt.length,clean:!txt.includes('fig-editor.js: 편집 가능한')&&txt.includes('class="fig-edges"')}; });
ok('T15_export_menu_downloads_static', dl.btn&&dl.clean&&dl.len>1000, JSON.stringify(dl));
// ---- T16: 배포본 내보내기 때 높이 미지정 노드의 실제 높이를 인라인으로 굳힌다 ----
await openTab(BASE+'test-edges.html'); await page.reload(); await sleep(700);
const fz=await page.evaluate(()=>{ const h=FigEditor.exportStatic(); const live=document.getElementById('f'); const m=h.match(/id="f"[^>]*style="([^"]*)"/); return {liveH:live.offsetHeight, hadInline:!!live.style.height, style:m?m[1]:null}; });
ok('T16_export_freezes_auto_height', !fz.hadInline&&fz.style&&new RegExp('height:\\s*'+fz.liveH+'px').test(fz.style), JSON.stringify(fz));
// ---- T17: 아티팩트 런타임(claude.use('artifact'))이 있으면 ⌘S가 파일 대신 새 버전을 발행한다 ----
await openTab(BASE+'demo-built.html'); await page.reload(); await sleep(800);
const ar=await page.evaluate(async()=>{ window.__pub=null; window.__picker=0; window.showSaveFilePicker=function(){ window.__picker++; throw new Error('picker should not be used'); }; window.claude={use:function(name){ return Promise.resolve(name==='artifact'?{publish:function(html){ window.__pub=html; return Promise.resolve(); }}:null); }}; FigEditor.setEdit(true); document.getElementById('n-hospital').style.left='30px'; FigEditor.commit(); await FigEditor.save(false); await new Promise(r=>setTimeout(r,300)); const h=window.__pub||''; return {published:!!window.__pub, picker:window.__picker, doctype:h.startsWith('<!DOCTYPE html>'), engine:h.includes('fig-editor.js: 편집 가능한'), moved:/id="n-hospital"[^>]*left:\s*30px/.test(h), clean:!/<body[^>]*fig-editing/.test(h)&&!h.includes('class="fig-dock"')&&!h.includes('class="fig-pill"')}; });
ok('T17_artifact_publish_on_save', ar.published&&ar.picker===0&&ar.doctype&&ar.engine&&ar.moved&&ar.clean, JSON.stringify(ar));
const passed=Object.values(R).filter(r=>r.pass).length; console.log('RESULT', passed+'/'+Object.keys(R).length, JSON.stringify(R,null,1));
