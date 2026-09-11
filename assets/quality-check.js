/* html-diagram 품질 검사. 브라우저에서 실행하면 JSON 문자열을 돌려준다(pass:true면 통과).
   - minFont: 캔버스 안 텍스트의 최소 글자 크기(설계 폭 기준 로컬 px. 창 크기·축소 배율과 무관)
   - fill: 격자 점유율. 캔버스를 CELL px 칸으로 나눠 노드나 화살표가 지나는 칸의 비율(%)
   - scale: 현재 창에서의 축소 배율(참고용, 판정에 쓰지 않음)
   실행: Aside repl → page.evaluate(<이 파일 내용 문자열>) / 내장 Browser → javascript_tool / 브라우저 콘솔에 붙여넣기 */
(function(){
  const FLOOR=12, FILL=75, CELL=40;   // 글자 하한 px · 격자 점유율 하한 % · 격자 칸 px
  const out={pass:true,canvases:[],offenders:[]};
  document.querySelectorAll('.fig-canvas').forEach((cv,i)=>{
    const W=cv.offsetWidth,H=cv.offsetHeight,cols=Math.ceil(W/CELL),rows=Math.ceil(H/CELL),hit=new Uint8Array(cols*rows);
    const mark=(x,y)=>{const cx=Math.floor(x/CELL),cy=Math.floor(y/CELL); if(cx>=0&&cy>=0&&cx<cols&&cy<rows) hit[cy*cols+cx]=1;};
    cv.querySelectorAll('.fig-node').forEach(n=>{
      const x0=Math.floor(n.offsetLeft/CELL),y0=Math.floor(n.offsetTop/CELL),x1=Math.floor((n.offsetLeft+n.offsetWidth-1)/CELL),y1=Math.floor((n.offsetTop+n.offsetHeight-1)/CELL);
      for(let y=y0;y<=y1;y++) for(let x=x0;x<=x1;x++) mark(x*CELL,y*CELL);
    });
    cv.querySelectorAll('.fig-edge').forEach(e=>{ const g=e._geom; if(!g) return;
      for(let t=0;t<=1;t+=0.05){ const u=1-t; mark(u*u*g.p0.x+2*u*t*g.ctrl.x+t*t*g.p1.x, u*u*g.p0.y+2*u*t*g.ctrl.y+t*t*g.p1.y); } });
    const fill=Math.round(hit.reduce((a,b)=>a+b,0)/hit.length*100);
    let minFont=Infinity; const w=document.createTreeWalker(cv,NodeFilter.SHOW_TEXT,null);
    while(w.nextNode()){ const t=w.currentNode; if(!t.textContent.trim()) continue;
      const el=t.parentElement; if(!el||el.closest('[data-fig-ui]')) continue;
      const fs=parseFloat(getComputedStyle(el).fontSize);   // 설계 폭 기준 로컬 px (창 크기·축소 배율과 무관)
      minFont=Math.min(minFont,fs); if(fs<FLOOR) out.offenders.push('#'+(i+1)+' '+fs+'px: '+t.textContent.trim().slice(0,20)); }
    const c={canvas:i+1,size:W+'x'+H,fill,minFont,scale:Math.round((cv._scale||1)*100)/100,ok:fill>=FILL&&minFont>=FLOOR};
    out.pass=out.pass&&c.ok; out.canvases.push(c);
  });
  out.offenders=out.offenders.slice(0,8); return JSON.stringify(out);
})()
