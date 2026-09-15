/* ================================================================
   fig-editor.js: 편집 가능한 HTML 도식 공용 엔진
   Copyright (c) 2026 Jeon SukHwan (tonywjs). MIT License. https://github.com/tonywjs/html-diagram
   이 주석은 엔진이 인라인된 모든 산출물에 함께 실린다(MIT의 저작권 표시 조건).
   규약: .fig-canvas[data-size="WxH"] > .fig-node(절대배치) + .fig-edge(데이터)
   - 보기 모드가 기본. 모든 편집은 편집 모드(⌘E)에서만 동작한다.
   - 저장: 같은 파일 덮어쓰기(File System Access API) + 히스토리 + 자동저장.
   ================================================================ */
(function(){
'use strict';
var body=document.body;

/* ---------------- 유틸 ---------------- */
function $(s,r){ return (r||document).querySelector(s); }
function $$(s,r){ return Array.prototype.slice.call((r||document).querySelectorAll(s)); }
function genId(p){ return (p||'fig')+'-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,7); }
function clamp(v,a,b){ return Math.max(a,Math.min(b,v)); }
function escapeHtml(s){ return (s||'').replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];}); }
function escForScript(s){ return s.replace(/</g,'\\u003c'); }
function rgbToHex(c){ var m=(c||'').match(/\d+(\.\d+)?/g); if(!m||m.length<3) return '#000000';
  return '#'+[m[0],m[1],m[2]].map(function(n){ return clamp(Math.round(+n),0,255).toString(16).padStart(2,'0'); }).join(''); }
function toast(t){ var el=$('#figToast'); if(!el) return; el.textContent=t; el.classList.add('show');
  clearTimeout(el._t); el._t=setTimeout(function(){ el.classList.remove('show'); },2400); }
var SVGNS='http://www.w3.org/2000/svg';

/* ---------------- 상태 ---------------- */
var editing=false, fileHandle=null;
var selection=[];                 // .fig-node 요소 또는 .fig-edge 데이터 div
var texting=null;                 // contenteditable 활성 요소
var undoStack=[], redoStack=[], UNDO_MAX=50;
var histArr=[], autosaveTimer=null, commitTimer=null;
var insertSeq=0;
var labelEditing=null;          // 편집 중인 화살표 라벨(.fig-elabel)
var bodyScripts=[];             // 본문 script 요소(엔진 등). 스냅샷에서 제외하고 복원 시 되살린다
var ftReflectRef=null;          // 텍스트 툴바 상태 반영 함수(패널 마운트 시 설정)

/* ================================================================
   캔버스 초기화 / 스케일
   ================================================================ */
function canvases(){ return $$('.fig-canvas'); }
function sizeOf(cv){
  var m=(cv.dataset.size||'').match(/^\s*(\d+)\s*[x×]\s*(\d+)\s*$/i);
  if(m) return {w:+m[1],h:+m[2]};
  return {w:cv.offsetWidth||1200,h:cv.offsetHeight||700};
}
function scaleOf(cv){ return cv._scale||1; }
/* 실효 축척: 화면 실측 폭 ÷ 레이아웃 폭. 덱 슬라이드 등 조상 transform까지 포함 */
function effScale(cv){
  var w=cv.getBoundingClientRect().width;
  return (w&&cv.offsetWidth)?(w/cv.offsetWidth):(cv._scale||1);
}
function initCanvases(){
  canvases().forEach(function(cv){
    var s=sizeOf(cv);
    cv.style.width=s.w+'px'; cv.style.height=s.h+'px';
    if(!cv.parentElement.classList.contains('fig-scale')){
      var w=document.createElement('div'); w.className='fig-scale';
      cv.parentNode.insertBefore(w,cv); w.appendChild(cv);
    }
    var baked=$('.fig-edges',cv);
    if(baked&&!baked.hasAttribute('data-fig-ui')){ baked.remove(); baked=null; }   /* 배포본에 구워진 SVG는 버리고 새로 그린다 */
    $$('.fig-elabel:not([data-fig-ui])',cv).forEach(function(l){ l.remove(); });
    if(!baked){
      var svg=document.createElementNS(SVGNS,'svg');
      svg.setAttribute('class','fig-edges'); svg.setAttribute('data-fig-ui','');
      svg.setAttribute('viewBox','0 0 '+s.w+' '+s.h);
      svg.setAttribute('width',s.w); svg.setAttribute('height',s.h);
      cv.insertBefore(svg,cv.firstChild);
    }
    // 스냅 가이드 2종
    if(!$('.fig-guide.v',cv)){
      ['v','h'].forEach(function(k){
        var g=document.createElement('div'); g.className='fig-guide '+k; g.setAttribute('data-fig-ui','');
        g.style.display='none'; cv.appendChild(g);
      });
    }
    // data-points 축약 → from/to 정규화
    $$('.fig-edge',cv).forEach(function(e){
      if(e.dataset.points && (!e.dataset.from || !e.dataset.to)){
        var pts=e.dataset.points.trim().split(/\s+/);
        if(pts.length>=2){ if(!e.dataset.from) e.dataset.from=pts[0]; if(!e.dataset.to) e.dataset.to=pts[pts.length-1]; }
        delete e.dataset.points;
      }
    });
  });
  fitAll();
}
function fitAll(){
  canvases().forEach(function(cv){
    var s=sizeOf(cv), wrap=cv.parentElement;
    var avail=wrap.clientWidth||s.w;
    var sc=Math.min(1, avail/s.w);
    cv._scale=sc;
    cv.style.transform=(sc<1)?('scale('+sc+')'):'';
    wrap.style.height=(s.h*sc)+'px';
  });
}
window.addEventListener('resize', function(){ fitAll(); });

/* 캔버스 좌표 변환 */
function toCanvas(cv,clientX,clientY){
  var r=cv.getBoundingClientRect(), sc=effScale(cv);
  return {x:(clientX-r.left)/sc, y:(clientY-r.top)/sc};
}

/* ================================================================
   엣지(화살표) 파싱 · 렌더
   ================================================================ */
function isPointVal(v){ return /^-?[\d.]+\s*,\s*-?[\d.]+$/.test(v||''); }
function parsePoint(v){ var a=v.split(','); return {x:parseFloat(a[0]),y:parseFloat(a[1])}; }
function nodeRect(cv,id){
  var n; try{ n=cv.querySelector('#'+CSS.escape(id)); }catch(e){ n=null; }
  if(!n||!n.classList.contains('fig-node')) return null;
  return {x:n.offsetLeft,y:n.offsetTop,w:n.offsetWidth,h:n.offsetHeight,el:n};
}
function rectCenter(r){ return {x:r.x+r.w/2,y:r.y+r.h/2}; }
/* auto 앵커: 중심→상대 방향과 사각형 경계의 교점 */
function boundaryPoint(r,toward){
  var c=rectCenter(r), dx=toward.x-c.x, dy=toward.y-c.y;
  if(!dx&&!dy) return c;
  var tx=Infinity,ty=Infinity;
  if(dx) tx=(r.w/2)/Math.abs(dx);
  if(dy) ty=(r.h/2)/Math.abs(dy);
  var t=Math.min(tx,ty);
  return {x:c.x+dx*t, y:c.y+dy*t};
}
/* 시각적 박스: 투명 래퍼면 실제 보이는 단일 자식으로 내려간다 */
function nodeVisual(el){
  var cur=el,hop=0;
  while(hop<2){
    var cs=getComputedStyle(cur);
    var noBg=(cs.backgroundColor==='rgba(0, 0, 0, 0)'||cs.backgroundColor==='transparent');
    var noBorder=(parseFloat(cs.borderTopWidth)||0)===0;
    if(!(noBg&&noBorder)) break;
    var kids=Array.prototype.filter.call(cur.children,function(k){ return k.nodeType===1&&!k.hasAttribute('data-fig-ui'); });
    if(kids.length!==1) break;
    cur=kids[0]; hop++;
  }
  return cur;
}
/* 원형(라운드 ≥ 절반) 노드 판정 */
function isRoundNode(el){
  var v=nodeVisual(el), cs=getComputedStyle(v);
  var br=cs.borderTopLeftRadius||'';
  var m=Math.min(v.offsetWidth||1,v.offsetHeight||1);
  var px=(br.indexOf('%')>=0)?(parseFloat(br)/100*m):(parseFloat(br)||0);
  return px>=m*0.49;
}
/* 타원 경계: 중심→상대 방향 광선과 타원의 교점 */
function ellipsePoint(r,toward){
  var c=rectCenter(r), dx=toward.x-c.x, dy=toward.y-c.y;
  if(!dx&&!dy) return c;
  var rx=r.w/2||1, ry=r.h/2||1;
  var t=1/Math.sqrt((dx*dx)/(rx*rx)+(dy*dy)/(ry*ry));
  return {x:c.x+dx*t, y:c.y+dy*t};
}
function sidePoint(r,side){
  if(side==='top')return{x:r.x+r.w/2,y:r.y};
  if(side==='bottom')return{x:r.x+r.w/2,y:r.y+r.h};
  if(side==='left')return{x:r.x,y:r.y+r.h/2};
  if(side==='right')return{x:r.x+r.w,y:r.y+r.h/2};
  return rectCenter(r);
}
function fracAnchor(r,anchor){
  /* "fx,fy" (0~1 비율) 고정 앵커. 노드를 옮겨도 상대 위치를 따라간다 */
  var m=/^\s*([\d.]+)\s*,\s*([\d.]+)\s*$/.exec(anchor||'');
  if(!m) return null;
  return {x:r.x+clamp(parseFloat(m[1]),0,1)*r.w, y:r.y+clamp(parseFloat(m[2]),0,1)*r.h};
}
function resolveEnd(cv,val,anchor,towardPt){
  if(isPointVal(val)) return parsePoint(val);
  var r=nodeRect(cv,val); if(!r) return null;
  var fp=fracAnchor(r,anchor); if(fp) return fp;
  if(anchor&&anchor!=='auto') return sidePoint(r,anchor);
  if(r.el&&isRoundNode(r.el)) return ellipsePoint(r,towardPt||rectCenter(r));
  return boundaryPoint(r,towardPt||rectCenter(r));
}
function edgeGeom(cv,e){
  var fv=e.dataset.from,tv=e.dataset.to;
  if(!fv||!tv) return null;
  // 1차: 임시 중심으로 상호 참조 해소
  var fT=isPointVal(fv)?parsePoint(fv):(nodeRect(cv,fv)?rectCenter(nodeRect(cv,fv)):null);
  var tT=isPointVal(tv)?parsePoint(tv):(nodeRect(cv,tv)?rectCenter(nodeRect(cv,tv)):null);
  if(!fT||!tT) return null;
  var p0=resolveEnd(cv,fv,e.dataset.anchorFrom,tT);
  var p1=resolveEnd(cv,tv,e.dataset.anchorTo,fT);
  if(!p0||!p1) return null;
  var mx=(p0.x+p1.x)/2,my=(p0.y+p1.y)/2;
  var dx=p1.x-p0.x,dy=p1.y-p0.y,len=Math.sqrt(dx*dx+dy*dy)||1;
  var curve=parseFloat(e.dataset.curve||'0');
  var nx=-dy/len,ny=dx/len;
  var ctrl={x:mx+nx*curve*len*0.5, y:my+ny*curve*len*0.5};
  return {p0:p0,p1:p1,ctrl:ctrl,len:len};
}
function qPoint(g,t){ var u=1-t;
  return {x:u*u*g.p0.x+2*u*t*g.ctrl.x+t*t*g.p1.x, y:u*u*g.p0.y+2*u*t*g.ctrl.y+t*t*g.p1.y}; }
function qTangent(g,t){ var u=1-t;
  return {x:2*u*(g.ctrl.x-g.p0.x)+2*t*(g.p1.x-g.ctrl.x), y:2*u*(g.ctrl.y-g.p0.y)+2*t*(g.p1.y-g.ctrl.y)}; }
function shorten(pt,toward,dist){
  var dx=toward.x-pt.x,dy=toward.y-pt.y,l=Math.sqrt(dx*dx+dy*dy)||1;
  return {x:pt.x+dx/l*dist, y:pt.y+dy/l*dist};
}
function arrowHead(tip,dirFrom,size){
  var dx=tip.x-dirFrom.x,dy=tip.y-dirFrom.y,l=Math.sqrt(dx*dx+dy*dy)||1;
  var ux=dx/l,uy=dy/l, px=-uy,py=ux;
  var bx=tip.x-ux*size, by=tip.y-uy*size, wid=size*0.55;
  return 'M'+tip.x+','+tip.y+' L'+(bx+px*wid)+','+(by+py*wid)+' L'+(bx-px*wid)+','+(by-py*wid)+' Z';
}
function edgeStyleDash(st,w){
  if(st==='dashed') return (w*3)+' '+(w*2.4);
  if(st==='dotted') return '0.1 '+(w*2.2);
  return '';
}
function renderEdge(cv,e){
  var svg=$('.fig-edges',cv); if(!svg) return;
  var g=e._g;
  if(!g||g.ownerSVGElement!==svg){
    g=document.createElementNS(SVGNS,'g');
    var hit=document.createElementNS(SVGNS,'path'); hit.setAttribute('class','fe-hit');
    hit.setAttribute('fill','none'); hit.setAttribute('stroke','rgba(0,0,0,0)');
    var main=document.createElementNS(SVGNS,'path'); main.setAttribute('class','fe-main'); main.setAttribute('fill','none');
    var ah1=document.createElementNS(SVGNS,'path'); ah1.setAttribute('class','fe-a1');
    var ah2=document.createElementNS(SVGNS,'path'); ah2.setAttribute('class','fe-a2');
    g.appendChild(main); g.appendChild(ah1); g.appendChild(ah2); g.appendChild(hit);
    svg.appendChild(g);
    e._g=g; g._edge=e;
    hit.style.strokeLinecap='round';
    hit.addEventListener('pointerdown',function(ev){
      if(!editing||ev.button) return; ev.stopPropagation();
      select(e, ev.shiftKey); startEdgeDrag(cv,e,ev);
    });
  }
  var geom=edgeGeom(cv,e);
  var main=g.children[0],a1=g.children[1],a2=g.children[2],hit=g.children[3];
  if(!geom){
    g.style.display='none'; if(e._label) e._label.style.display='none';
    if(!e._warned){ e._warned=true;   /* 한 번만 경고(드래그마다 반복 출력 방지) */
      console.warn('[fig-editor] 화살표 끝점을 찾을 수 없습니다: data-from="'+(e.dataset.from||'')+'" data-to="'+(e.dataset.to||'')+'"'); }
    return;
  }
  e._warned=false;
  g.style.display='';
  g.classList.toggle('fig-flow', /^(on|1|true|yes)$/i.test(e.dataset.flow||''));
  var w=parseFloat(e.dataset.width||'2');
  var color=e.dataset.color||'#64748b';
  var arrow=e.dataset.arrow||'end';
  var op=e.dataset.opacity?String(clamp(parseFloat(e.dataset.opacity),0.05,1)):'1';
  var hs=Math.max(9,w*3.2);
  var pS=geom.p0,pE=geom.p1;
  if(arrow==='end'||arrow==='both') pE=shorten(geom.p1,geom.ctrl,hs*0.72);
  if(arrow==='both') pS=shorten(geom.p0,geom.ctrl,hs*0.72);
  var d='M'+pS.x+','+pS.y+' Q'+geom.ctrl.x+','+geom.ctrl.y+' '+pE.x+','+pE.y;
  main.setAttribute('d',d);
  main.setAttribute('stroke',color); main.setAttribute('stroke-width',w);
  main.setAttribute('stroke-linecap',(e.dataset.style==='dotted')?'round':'butt');
  var dash=edgeStyleDash(e.dataset.style,w);
  if(dash) main.setAttribute('stroke-dasharray',dash); else main.removeAttribute('stroke-dasharray');
  g.setAttribute('opacity',op);
  a1.setAttribute('fill',color); a2.setAttribute('fill',color);
  a1.setAttribute('d',(arrow==='end'||arrow==='both')?arrowHead(geom.p1,geom.ctrl,hs):'');
  a2.setAttribute('d',(arrow==='both')?arrowHead(geom.p0,geom.ctrl,hs):'');
  hit.setAttribute('d','M'+geom.p0.x+','+geom.p0.y+' Q'+geom.ctrl.x+','+geom.ctrl.y+' '+geom.p1.x+','+geom.p1.y);
  hit.setAttribute('stroke-width',Math.max(16,w+12));
  // 선택 표시
  main.setAttribute('stroke-opacity','1');
  if(selection.indexOf(e)>=0){ main.setAttribute('filter','drop-shadow(0 0 2.5px rgba(37,99,235,.9))'); }
  else main.removeAttribute('filter');
  // 라벨
  var txt=e.dataset.label||'';
  var lb=e._label;
  if(txt){
    if(!lb||lb.parentElement!==cv){
      lb=document.createElement('div'); lb.className='fig-elabel'; lb.setAttribute('data-fig-ui','');
      cv.appendChild(lb); e._label=lb; lb._edge=e;
      lb.addEventListener('pointerdown',function(ev){
        if(!editing||ev.button||lb===labelEditing) return;   /* 편집 중인 라벨은 캐럿 이동만 */
        ev.stopPropagation(); select(e,ev.shiftKey);
      });
    }
    var mp=qPoint(geom,0.5);
    if(lb!==labelEditing) lb.textContent=txt;   /* 편집 중이면 입력 내용을 덮지 않는다 */
    lb.style.left=mp.x+'px'; lb.style.top=mp.y+'px';
    lb.style.color=color; lb.style.opacity=op; lb.style.display='';
  } else if(lb){ lb.style.display='none'; }
  e._geom=geom;
}
function renderEdges(cv){ $$('.fig-edge',cv).forEach(function(e){ renderEdge(cv,e); }); }
function renderAll(){ canvases().forEach(renderEdges); }
var rafPend=false;
function renderSoon(cv){
  if(rafPend) return; rafPend=true;
  requestAnimationFrame(function(){ rafPend=false; cv?renderEdges(cv):renderAll(); refreshHandles(); });
}

/* ================================================================
   편집 모드
   ================================================================ */
function setEdit(on){
  if(editing===on) return;
  editing=on;
  body.classList.toggle('fig-editing',on);
  fitAll();   /* 도크 공간 확보(padding) 변화 반영 */
  if(on){
    if(!undoStack.length) undoStack.push(cleanBodyHTML());
    toast('편집 모드. 드래그 이동 · 더블클릭 글자 수정 · ⌘S 저장');
  } else {
    finishLabelEdit(); stopTextEdit(); clearSelection();
  }
  updatePanel();
}

/* ================================================================
   선택
   ================================================================ */
function isNode(el){ return el&&el.nodeType===1&&el.classList.contains('fig-node'); }
function isEdge(el){ return el&&el.nodeType===1&&el.classList.contains('fig-edge'); }
function canvasOf(el){ return el.closest?el.closest('.fig-canvas'):null; }
function select(el,additive){
  if(!additive) clearSelection(false);
  var i=selection.indexOf(el);
  if(additive&&i>=0){ selection.splice(i,1); }
  else if(i<0) selection.push(el);
  applySelClass();
  updatePanel(); refreshHandles();
}
function clearSelection(update){
  selection=[];
  $$('.fig-node.fig-selected').forEach(function(n){ n.classList.remove('fig-selected'); });
  removeHandles();
  if(update!==false){ updatePanel(); renderAll(); }
}
function applySelClass(){
  $$('.fig-node.fig-selected').forEach(function(n){ n.classList.remove('fig-selected'); });
  selection.forEach(function(el){ if(isNode(el)) el.classList.add('fig-selected'); });
  renderAll();
}
function selNodes(){ return selection.filter(isNode); }
function selEdges(){ return selection.filter(isEdge); }

/* ================================================================
   핸들 (리사이즈 · 엣지 끝점/곡률)
   ================================================================ */
function removeHandles(){ $$('.fig-h,.fig-ep').forEach(function(h){ h.remove(); }); }
function refreshHandles(){
  removeHandles();
  if(!editing) return;
  var nodes=selNodes(), edges=selEdges();
  if(nodes.length===1&&!edges.length) nodeHandles(nodes[0]);
  if(edges.length===1&&!nodes.length) edgeHandles(edges[0]);
}
function nodeHandles(n){
  var cv=canvasOf(n); if(!cv) return;
  ['nw','n','ne','e','se','s','sw','w'].forEach(function(dir){
    var h=document.createElement('div'); h.className='fig-h '+dir; h.setAttribute('data-fig-ui','');
    cv.appendChild(h); positionHandle(h,n,dir);
    h.addEventListener('pointerdown',function(ev){ if(ev.button) return; startResize(n,dir,ev); });
  });
}
function positionHandle(h,n,dir){
  var x=n.offsetLeft,y=n.offsetTop,w=n.offsetWidth,hh=n.offsetHeight;
  var cx={n:x+w/2,s:x+w/2,w:x-1,e:x+w+1,nw:x-1,sw:x-1,ne:x+w+1,se:x+w+1}[dir];
  var cy={w:y+hh/2,e:y+hh/2,n:y-1,s:y+hh+1,nw:y-1,ne:y-1,sw:y+hh+1,se:y+hh+1}[dir];
  h.style.left=(cx-4.5)+'px'; h.style.top=(cy-4.5)+'px';
}
function edgeHandles(e){
  var cv=canvasOf(e); if(!cv||!e._geom) return;
  var mk=function(cls,pt){
    var h=document.createElement('div'); h.className='fig-ep '+cls; h.setAttribute('data-fig-ui','');
    h.style.left=pt.x+'px'; h.style.top=pt.y+'px'; cv.appendChild(h); return h;
  };
  var g=e._geom, cvPt=qPoint(g,0.5);
  if(e.dataset.label){
    /* 라벨이 곡선 중앙에 놓이므로 곡률 핸들은 법선 방향으로 비켜 놓는다(라벨 더블클릭 편집을 가리지 않게) */
    var ddx=g.p1.x-g.p0.x, ddy=g.p1.y-g.p0.y, dl=Math.sqrt(ddx*ddx+ddy*ddy)||1;
    var sgn=(parseFloat(e.dataset.curve||'0')>=0)?1:-1;
    cvPt={x:cvPt.x+(-ddy/dl)*sgn*20, y:cvPt.y+(ddx/dl)*sgn*20};
  }
  var hFrom=mk('from',g.p0), hTo=mk('to',g.p1), hCv=mk('curve',cvPt);
  hFrom.addEventListener('pointerdown',function(ev){ if(ev.button) return; startEndpointDrag(cv,e,'from',ev); });
  hTo.addEventListener('pointerdown',function(ev){ if(ev.button) return; startEndpointDrag(cv,e,'to',ev); });
  hCv.addEventListener('pointerdown',function(ev){ if(ev.button) return; startCurveDrag(cv,e,ev); });
}

/* ================================================================
   포인터 인터랙션. 노드 드래그 (스냅 가이드 포함)
   ================================================================ */
document.addEventListener('pointerdown',function(ev){
  if(!editing) return;
  if(ev.button) return;                                   // 우클릭·보조 버튼은 편집 동작을 시작하지 않는다
  if(labelEditing){ if(labelEditing.contains(ev.target)) return; finishLabelEdit(); }   // 라벨 편집은 다른 곳을 누르는 순간 확정
  if(ev.target.closest('[data-fig-ui]')&&!ev.target.closest('.fig-elabel')) return; // UI/핸들은 자체 처리
  if(texting){ if(ev.target.closest('[contenteditable="true"]')) return; stopTextEdit(); }
  var cv=ev.target.closest?ev.target.closest('.fig-canvas'):null;
  if(!cv) return;
  var node=ev.target.closest('.fig-node');
  if(node){
    ev.preventDefault();
    if(selection.indexOf(node)<0) select(node,ev.shiftKey);
    startNodeDrag(cv,node,ev);
  } else {
    clearSelection();
  }
},true);

function startNodeDrag(cv,primary,ev){
  var sc=effScale(cv);
  var startX=ev.clientX,startY=ev.clientY,moved=false,duped=false;
  var items=selNodes().map(function(n){ return {n:n,x:n.offsetLeft,y:n.offsetTop}; });
  var freeEdges=selEdges().filter(function(e){ return isPointVal(e.dataset.from)&&isPointVal(e.dataset.to); })
    .map(function(e){ return {e:e,p0:parsePoint(e.dataset.from),p1:parsePoint(e.dataset.to)}; });
  var gv=$('.fig-guide.v',cv), gh=$('.fig-guide.h',cv);
  function others(){
    return $$('.fig-node',cv).filter(function(n){ return items.every(function(it){ return it.n!==n; }); })
      .map(function(n){ return {x:n.offsetLeft,y:n.offsetTop,w:n.offsetWidth,h:n.offsetHeight}; });
  }
  var obs=others();
  function onMove(e2){
    var dx=(e2.clientX-startX)/sc, dy=(e2.clientY-startY)/sc;
    if(!moved&&Math.abs(dx)<2&&Math.abs(dy)<2) return;
    moved=true;
    if(e2.altKey&&!duped&&items.length){ // ⌥드래그 = 복제 이동
      duped=true;
      items=items.map(function(it){
        var c=cloneNode(it.n); return {n:c,x:it.x,y:it.y};
      });
      selection=items.map(function(it){ return it.n; }); applySelClass();
      obs=others();
    }
    // 스냅(대표 노드 기준)
    var snapX=null,snapY=null,TH=6;
    if(items.length){
      var p=items[0], nx=p.x+dx, ny=p.y+dy, w=p.n.offsetWidth, h=p.n.offsetHeight;
      var candX=[nx,nx+w/2,nx+w], candY=[ny,ny+h/2,ny+h];
      obs.forEach(function(o){
        [o.x,o.x+o.w/2,o.x+o.w].forEach(function(ox){
          candX.forEach(function(cx,ci){ if(Math.abs(cx-ox)<TH&&snapX===null){ snapX=ox; dx+=ox-cx; } });
        });
        [o.y,o.y+o.h/2,o.y+o.h].forEach(function(oy){
          candY.forEach(function(cy,ci){ if(Math.abs(cy-oy)<TH&&snapY===null){ snapY=oy; dy+=oy-cy; } });
        });
      });
    }
    gv.style.display=(snapX!==null)?'block':'none'; if(snapX!==null) gv.style.left=snapX+'px';
    gh.style.display=(snapY!==null)?'block':'none'; if(snapY!==null) gh.style.top=snapY+'px';
    items.forEach(function(it){ it.n.style.left=Math.round(it.x+dx)+'px'; it.n.style.top=Math.round(it.y+dy)+'px'; it.n.classList.add('fig-dragging'); });
    freeEdges.forEach(function(fe){
      fe.e.dataset.from=Math.round(fe.p0.x+dx)+','+Math.round(fe.p0.y+dy);
      fe.e.dataset.to=Math.round(fe.p1.x+dx)+','+Math.round(fe.p1.y+dy);
    });
    renderSoon(cv);
  }
  function onUp(){
    document.removeEventListener('pointermove',onMove);
    document.removeEventListener('pointerup',onUp);
    gv.style.display='none'; gh.style.display='none';
    items.forEach(function(it){ it.n.classList.remove('fig-dragging'); });
    if(moved) commit();
    refreshHandles();
  }
  document.addEventListener('pointermove',onMove);
  document.addEventListener('pointerup',onUp);
}

/* ---------------- 리사이즈 ---------------- */
function startResize(n,dir,ev){
  ev.preventDefault(); ev.stopPropagation();
  var cv=canvasOf(n), sc=effScale(cv);
  var sx=ev.clientX,sy=ev.clientY;
  var ox=n.offsetLeft,oy=n.offsetTop,ow=n.offsetWidth,oh=n.offsetHeight;
  var hasE=dir.indexOf('e')>=0,hasW=dir.indexOf('w')>=0,hasS=dir.indexOf('s')>=0,hasN=dir.indexOf('n')>=0;
  /* 이동과 동일한 스냅: 다른 노드의 모서리·중앙선에 크기 조절 변이 흡착 */
  var gv=$('.fig-guide.v',cv), gh=$('.fig-guide.h',cv);
  var xs=[],ys=[];
  $$('.fig-node',cv).forEach(function(m){
    if(m===n) return;
    xs.push(m.offsetLeft, m.offsetLeft+m.offsetWidth/2, m.offsetLeft+m.offsetWidth);
    ys.push(m.offsetTop, m.offsetTop+m.offsetHeight/2, m.offsetTop+m.offsetHeight);
  });
  function onMove(e2){
    var dx=(e2.clientX-sx)/sc, dy=(e2.clientY-sy)/sc;
    var x=ox,y=oy,w=ow,h=oh;
    if(hasE) w=ow+dx;
    if(hasS) h=oh+dy;
    if(hasW){ w=ow-dx; x=ox+ow-w; }
    if(hasN){ h=oh-dy; y=oy+oh-h; }
    var TH=6,snX=null,snY=null;
    if(hasE){ var rg=x+w; xs.forEach(function(v){ if(snX===null&&Math.abs(v-rg)<TH){ w+=v-rg; snX=v; } }); }
    else if(hasW){ xs.forEach(function(v){ if(snX===null&&Math.abs(v-x)<TH){ w+=x-v; x=v; snX=v; } }); }
    if(hasS){ var bt=y+h; ys.forEach(function(v){ if(snY===null&&Math.abs(v-bt)<TH){ h+=v-bt; snY=v; } }); }
    else if(hasN){ ys.forEach(function(v){ if(snY===null&&Math.abs(v-y)<TH){ h+=y-v; y=v; snY=v; } }); }
    if(w<24){ if(hasW) x-=24-w; w=24; }
    if(h<20){ if(hasN) y-=20-h; h=20; }
    gv.style.display=(snX!==null)?'block':'none'; if(snX!==null) gv.style.left=snX+'px';
    gh.style.display=(snY!==null)?'block':'none'; if(snY!==null) gh.style.top=snY+'px';
    n.style.left=Math.round(x)+'px'; n.style.top=Math.round(y)+'px';
    n.style.width=Math.round(w)+'px';
    if(hasS||hasN) n.style.height=Math.round(h)+'px';
    renderSoon(cv);
  }
  function onUp(){
    document.removeEventListener('pointermove',onMove);
    document.removeEventListener('pointerup',onUp);
    gv.style.display='none'; gh.style.display='none';
    commit(); refreshHandles();
  }
  document.addEventListener('pointermove',onMove);
  document.addEventListener('pointerup',onUp);
}

/* ---------------- 엣지: 전체 이동(자유형) ---------------- */
function startEdgeDrag(cv,e,ev){
  if(!(isPointVal(e.dataset.from)&&isPointVal(e.dataset.to))) return; // 연결형은 노드를 따름
  var sc=effScale(cv), sx=ev.clientX, sy=ev.clientY, moved=false;
  var p0=parsePoint(e.dataset.from), p1=parsePoint(e.dataset.to);
  function onMove(e2){
    var dx=(e2.clientX-sx)/sc, dy=(e2.clientY-sy)/sc;
    if(!moved&&Math.abs(dx)<2&&Math.abs(dy)<2) return;
    moved=true;
    e.dataset.from=Math.round(p0.x+dx)+','+Math.round(p0.y+dy);
    e.dataset.to=Math.round(p1.x+dx)+','+Math.round(p1.y+dy);
    renderSoon(cv);
  }
  function onUp(){
    document.removeEventListener('pointermove',onMove);
    document.removeEventListener('pointerup',onUp);
    if(moved) commit(); refreshHandles();
  }
  document.addEventListener('pointermove',onMove);
  document.addEventListener('pointerup',onUp);
}

/* ---------------- 엣지: 끝점 드래그 (노드 스냅) ---------------- */
function nodeAtPoint(cv,pt){
  var list=$$('.fig-node',cv);
  for(var i=list.length-1;i>=0;i--){
    var n=list[i];
    if(pt.x>=n.offsetLeft&&pt.x<=n.offsetLeft+n.offsetWidth&&pt.y>=n.offsetTop&&pt.y<=n.offsetTop+n.offsetHeight) return n;
  }
  return null;
}
function startEndpointDrag(cv,e,which,ev){
  ev.preventDefault(); ev.stopPropagation();
  var key=(which==='from')?'from':'to';
  var hovered=null;
  function onMove(e2){
    var pt=toCanvas(cv,e2.clientX,e2.clientY);
    e.dataset[key]=Math.round(pt.x)+','+Math.round(pt.y);
    var n=nodeAtPoint(cv,pt);
    if(hovered&&hovered!==n) hovered.classList.remove('fig-snaptarget');
    hovered=n; if(n) n.classList.add('fig-snaptarget');
    renderSoon(cv);
  }
  function onUp(e2){
    document.removeEventListener('pointermove',onMove);
    document.removeEventListener('pointerup',onUp);
    var pt=toCanvas(cv,e2.clientX,e2.clientY);
    var n=nodeAtPoint(cv,pt);
    if(hovered) hovered.classList.remove('fig-snaptarget');
    if(n){
      if(!n.id) n.id=genId('n');
      e.dataset[key]=n.id;
      /* 놓은 자리 고정: 드롭 지점을 노드 테두리(원형이면 타원 둘레)로 투영해 비율 앵커로 저장 */
      var r={x:n.offsetLeft,y:n.offsetTop,w:n.offsetWidth||1,h:n.offsetHeight||1};
      var fx,fy;
      if(isRoundNode(n)){
        var cx=r.x+r.w/2, cy=r.y+r.h/2, rx=r.w/2, ry=r.h/2;
        var th=Math.atan2((pt.y-cy)/ry,(pt.x-cx)/rx);
        fx=(rx+rx*Math.cos(th))/r.w; fy=(ry+ry*Math.sin(th))/r.h;
      } else {
        fx=clamp((pt.x-r.x)/r.w,0,1); fy=clamp((pt.y-r.y)/r.h,0,1);
        var dl=fx, dr=1-fx, dt=fy, db=1-fy, mn=Math.min(dl,dr,dt,db);
        if(mn===dl) fx=0; else if(mn===dr) fx=1; else if(mn===dt) fy=0; else fy=1;
      }
      e.dataset[(which==='from')?'anchorFrom':'anchorTo']=
        (Math.round(fx*1000)/1000)+','+(Math.round(fy*1000)/1000);
    }
    commit(); renderEdges(cv); refreshHandles(); updatePanel();
  }
  document.addEventListener('pointermove',onMove);
  document.addEventListener('pointerup',onUp);
}
function startCurveDrag(cv,e,ev){
  ev.preventDefault(); ev.stopPropagation();
  var g0=edgeGeom(cv,e); if(!g0) return;
  var c0=parseFloat(e.dataset.curve||'0');
  var dx=g0.p1.x-g0.p0.x, dy=g0.p1.y-g0.p0.y, len=Math.sqrt(dx*dx+dy*dy)||1;
  var mx=(g0.p0.x+g0.p1.x)/2, my=(g0.p0.y+g0.p1.y)/2, nx=-dy/len, ny=dx/len;
  function perp(pt){ return (pt.x-mx)*nx+(pt.y-my)*ny; }     // 현(chord)에서의 수직 거리
  var d0=perp(toCanvas(cv,ev.clientX,ev.clientY));
  function onMove(e2){
    /* 핸들이 라벨을 피해 비켜 있어도 튀지 않도록, 누른 지점 기준 상대 변화량으로 계산 */
    var d=perp(toCanvas(cv,e2.clientX,e2.clientY));
    var curve=clamp(c0+(d-d0)/(len*0.25),-1.6,1.6); // 곡률 핸들은 t=.5 지점(=offset의 절반)
    e.dataset.curve=(Math.round(curve*100)/100).toString();
    renderSoon(cv);
  }
  function onUp(){
    document.removeEventListener('pointermove',onMove);
    document.removeEventListener('pointerup',onUp);
    commit(); refreshHandles(); updatePanel();
  }
  document.addEventListener('pointermove',onMove);
  document.addEventListener('pointerup',onUp);
}

/* ================================================================
   텍스트 편집 (더블클릭)
   ================================================================ */
var TEXT_BLOCKS='h1,h2,h3,h4,h5,h6,p,li,td,th,dt,dd,figcaption,blockquote,summary';
document.addEventListener('dblclick',function(ev){
  if(!editing) return;
  if(ev.target.closest('[data-fig-ui]')){
    var lb=ev.target.closest('.fig-elabel');
    if(lb&&lb._edge){ startLabelEdit(lb); }
    return;
  }
  var node=ev.target.closest('.fig-node');
  var tgt=node||ev.target.closest(TEXT_BLOCKS);
  if(!tgt) return;
  startTextEdit(tgt);
});
function startTextEdit(el){
  stopTextEdit();
  texting=el; el._before=el.innerHTML;
  el.setAttribute('contenteditable','true');
  if(el.classList.contains('fig-node')) el.classList.add('fig-texting');
  el.focus();
  try{ document.execCommand('styleWithCSS',false,true); }catch(e){}
  updatePanel();
}
function stopTextEdit(){
  if(!texting) return;
  var el=texting; texting=null;
  el.removeAttribute('contenteditable');
  el.classList.remove('fig-texting');
  if(el._before!==el.innerHTML){ commit(); }
  delete el._before;
  updatePanel(); renderAll();
}
function startLabelEdit(lb){
  if(labelEditing===lb) return;
  finishLabelEdit();
  labelEditing=lb; lb._before=lb.textContent;
  lb.setAttribute('contenteditable','true'); lb.focus();
  try{ document.execCommand('selectAll',false,null); }catch(e){}
  lb.addEventListener('blur',onLabelBlur);
}
function onLabelBlur(){ finishLabelEdit(); }
/* 라벨 편집 확정(cancel=true면 원래 글자로). 다른 곳을 눌러 끝낼 때 renderAll보다 먼저 호출돼야 입력이 유실되지 않는다 */
function finishLabelEdit(cancel){
  var lb=labelEditing; if(!lb) return;
  labelEditing=null;
  lb.removeEventListener('blur',onLabelBlur);
  lb.removeAttribute('contenteditable');
  var e=lb._edge, old=lb._before; delete lb._before;
  var txt=cancel?old:lb.textContent.replace(/\s+/g,' ').trim();
  if(e) e.dataset.label=txt;
  if(!cancel&&txt!==old) commit();
  renderAll(); updatePanel();
}

/* ================================================================
   생성 · 복제 · 삭제 · z순서
   ================================================================ */
function targetCanvas(){
  if(selection.length){ var cv=canvasOf(selection[0]); if(cv) return cv; }
  var cvs=canvases();
  // 화면에 가장 많이 보이는 캔버스
  var best=cvs[0],bestA=-1;
  cvs.forEach(function(cv){
    var r=cv.getBoundingClientRect();
    var vis=Math.max(0,Math.min(r.bottom,innerHeight)-Math.max(r.top,0))*Math.max(0,Math.min(r.right,innerWidth)-Math.max(r.left,0));
    if(vis>bestA){ bestA=vis; best=cv; }
  });
  return best;
}
function viewCenter(cv){
  var r=cv.getBoundingClientRect();
  var cx=(Math.max(0,Math.min(r.right,innerWidth))+Math.max(r.left,0))/2;
  var cy=(Math.max(0,Math.min(r.bottom,innerHeight))+Math.max(r.top,0))/2;
  var p=toCanvas(cv,cx,cy), s=sizeOf(cv);
  return {x:clamp(p.x,40,s.w-40), y:clamp(p.y,40,s.h-40)};
}
function addNode(){
  var cv=targetCanvas(); if(!cv) return;
  var c=viewCenter(cv); insertSeq++;
  var n=document.createElement('div');
  n.className='fig-node'; n.id=genId('n');
  n.style.cssText='left:'+Math.round(c.x-90+insertSeq*12)+'px;top:'+Math.round(c.y-30+insertSeq*12)+'px;width:180px;'+
    'background:#ffffff;border:1px solid #cbd5e1;border-radius:10px;padding:12px 14px;'+
    'font-size:14px;line-height:1.45;color:#1f2937;box-shadow:0 2px 8px rgba(15,23,42,.06);';
  n.innerHTML='<div style="font-weight:700">새 박스</div><div style="font-size:12.5px;color:#64748b;margin-top:2px">더블클릭해서 수정</div>';
  cv.appendChild(n);
  select(n); commit(); toast('박스를 추가했습니다');
}
function addEdgeNew(){
  var cv=targetCanvas(); if(!cv) return;
  var c=viewCenter(cv); insertSeq++;
  var e=document.createElement('div');
  e.className='fig-edge';
  e.dataset.from=Math.round(c.x-90)+','+Math.round(c.y+insertSeq*10);
  e.dataset.to=Math.round(c.x+90)+','+Math.round(c.y+insertSeq*10);
  e.dataset.arrow='end'; e.dataset.width='2'; e.dataset.color='#475569';
  cv.appendChild(e);
  renderEdges(cv); select(e); commit(); toast('화살표를 추가했습니다. 끝점을 끌어 연결하세요');
}
function cloneNode(n){
  var c=n.cloneNode(true);
  c.id=genId('n');
  c.classList.remove('fig-selected','fig-texting','fig-dragging','fig-snaptarget');
  c.style.left=(n.offsetLeft+16)+'px'; c.style.top=(n.offsetTop+16)+'px';
  n.parentElement.appendChild(c);
  return c;
}
function duplicateSel(){
  if(!editing||!selection.length) return;
  var made=[];
  selNodes().forEach(function(n){ made.push(cloneNode(n)); });
  selEdges().forEach(function(e){
    var c=e.cloneNode(false); // 데이터 속성만 복사
    c.removeAttribute('id');   // id 중복 방지
    var cv=canvasOf(e);
    ['from','to'].forEach(function(k){
      if(isPointVal(c.dataset[k])){ var p=parsePoint(c.dataset[k]); c.dataset[k]=(p.x+16)+','+(p.y+16); }
    });
    cv.appendChild(c); made.push(c); renderEdges(cv);
  });
  if(made.length){ selection=made; applySelClass(); refreshHandles(); updatePanel(); commit(); toast('복제했습니다'); }
}
function deleteSel(){
  if(!editing||!selection.length) return;
  selEdges().forEach(function(e){ removeEdgeEl(e); });
  selNodes().forEach(function(n){
    var cv=canvasOf(n);
    // 이 노드에 연결된 엣지 정리
    $$('.fig-edge',cv).forEach(function(e){
      if(e.dataset.from===n.id||e.dataset.to===n.id) removeEdgeEl(e);
    });
    n.remove();
  });
  selection=[]; removeHandles(); updatePanel(); renderAll(); commit(); toast('삭제했습니다');
}
function removeEdgeEl(e){
  if(e._g) e._g.remove();
  if(e._label) e._label.remove();
  e.remove();
}
/* ================================================================
   클립보드 (⌘C / ⌘X / ⌘V). 시스템 클립보드 경유, 문서 간 이동 가능
   ================================================================ */
var FIG_CLIP_MARK='FIG-CLIP:';
var lastPaste={text:null,count:0};
function serializeSelection(){
  var nodes=selNodes(), edges=selEdges();
  if(!nodes.length&&!edges.length) return null;
  var payload={fig:'clipboard',v:1,nodes:[],edges:[]};
  nodes.forEach(function(n){
    var c=n.cloneNode(true);
    c.classList.remove('fig-selected','fig-texting','fig-dragging','fig-snaptarget');
    c.removeAttribute('contenteditable');
    Array.prototype.forEach.call(c.querySelectorAll('[contenteditable]'),function(el){ el.removeAttribute('contenteditable'); });
    Array.prototype.forEach.call(c.querySelectorAll('[data-fig-ui]'),function(el){ el.remove(); });
    runCleaners(c);
    payload.nodes.push({id:n.id,html:c.outerHTML});
  });
  edges.forEach(function(e){
    var g=e._geom||edgeGeom(canvasOf(e),e);
    payload.edges.push({html:e.cloneNode(false).outerHTML,
      p0:g?{x:Math.round(g.p0.x),y:Math.round(g.p0.y)}:null,
      p1:g?{x:Math.round(g.p1.x),y:Math.round(g.p1.y)}:null});
  });
  return FIG_CLIP_MARK+JSON.stringify(payload);
}
/* 숨은 텍스트영역. file:// 포함 어디서나 동작하는 클립보드 브리지 */
var clipTA=null;
function clipTextarea(){
  if(clipTA&&document.contains(clipTA)) return clipTA;
  clipTA=document.createElement('textarea');
  clipTA.setAttribute('data-fig-ui','');
  clipTA.setAttribute('aria-hidden','true');
  clipTA.tabIndex=-1;
  clipTA.style.cssText='position:fixed;left:-9999px;top:0;width:10px;height:10px;opacity:0;';
  body.appendChild(clipTA);
  return clipTA;
}
function writeClipboard(text){
  var ta=clipTextarea();
  ta.value=text; ta.focus(); ta.select();
  try{ document.execCommand('copy'); }catch(e){}
  ta.value=''; ta.blur();
  try{ navigator.clipboard.writeText(text).catch(function(){}); }catch(e){}
}
function copySelection(alsoCut){
  var text=serializeSelection(); if(!text) return false;
  var n=selection.length;
  writeClipboard(text);
  if(alsoCut){ deleteSel(); toast(n+'개 잘라냈습니다'); }
  else toast(n+'개 복사했습니다');
  return true;
}
function visiblePasteCanvas(){
  if(selection.length){
    var cv=canvasOf(selection[0]);
    if(cv&&cv.getBoundingClientRect().width>0) return cv;
  }
  return targetCanvas();
}
function pasteFromText(text){
  if(!text||text.indexOf(FIG_CLIP_MARK)!==0) return false;
  var payload; try{ payload=JSON.parse(text.slice(FIG_CLIP_MARK.length)); }catch(e){ return false; }
  if(!payload||payload.fig!=='clipboard') return false;
  var cv=visiblePasteCanvas(); if(!cv) return false;
  if(lastPaste.text===text) lastPaste.count++; else lastPaste={text:text,count:1};
  var off=24*lastPaste.count;
  var idMap={}, made=[], tmp=document.createElement('div');
  (payload.nodes||[]).forEach(function(item){
    tmp.innerHTML=item.html;
    var n=tmp.firstElementChild;
    if(!n||!n.classList.contains('fig-node')) return;
    var newId=genId('n'); if(item.id) idMap[item.id]=newId;
    n.id=newId;
    n.style.left=((parseFloat(n.style.left)||0)+off)+'px';
    n.style.top=((parseFloat(n.style.top)||0)+off)+'px';
    cv.appendChild(n); made.push(n);
  });
  (payload.edges||[]).forEach(function(item){
    tmp.innerHTML=item.html;
    var e=tmp.firstElementChild;
    if(!e||!e.classList.contains('fig-edge')) return;
    e.removeAttribute('id');
    var moved=0;
    ['from','to'].forEach(function(k,idx){
      var v=e.dataset[k];
      if(isPointVal(v)){ var p=parsePoint(v); e.dataset[k]=(p.x+off)+','+(p.y+off); moved++; return; }
      if(idMap[v]){ e.dataset[k]=idMap[v]; moved++; return; }   /* 함께 복사된 박스로 재연결(오프셋 따라감) */
      var exists=null; try{ exists=cv.querySelector('#'+CSS.escape(v||'')); }catch(err){}
      if(!exists){
        /* 상대 노드가 이 문서에 없음 → 복사 시점 좌표로 변환해 모양 유지 */
        var fb=(idx===0)?item.p0:item.p1;
        e.dataset[k]=fb?((fb.x+off)+','+(fb.y+off)):((120+off)+','+(120+off));
        delete e.dataset[(idx===0)?'anchorFrom':'anchorTo'];
        moved++;
      }
      /* else: 이미 있는 노드 참조 유지. 이동 없음 */
    });
    if(moved===0){
      /* 양 끝이 같은 노드에 그대로 연결돼 원본과 완전히 겹침 → 곡률을 벌려 구분 */
      var cu=parseFloat(e.dataset.curve||'0');
      var bump=0.3*lastPaste.count*(cu<0?-1:1);
      e.dataset.curve=String(clamp(cu+bump,-1.6,1.6));
    }
    cv.appendChild(e); made.push(e); renderEdge(cv,e);
  });
  if(!made.length) return false;
  selection=made; applySelClass(); refreshHandles(); updatePanel();
  renderEdges(cv); commit();
  flashPasted(made);
  toast(made.length+'개 붙여넣었습니다');
  return true;
}
/* 붙여넣은 요소를 잠깐 깜빡여 위치를 알린다 (완전히 겹쳐도 보이게) */
function flashPasted(els){
  els.forEach(function(el){
    var t=(el.classList&&el.classList.contains('fig-edge'))?el._g:el;
    if(!t||!t.classList) return;
    t.classList.remove('fig-paste-flash');
    void (t.getBBox?0:t.offsetWidth);   /* 리플로우로 애니메이션 재시작 */
    t.classList.add('fig-paste-flash');
    setTimeout(function(){ t.classList.remove('fig-paste-flash'); },900);
  });
}
document.addEventListener('paste',function(e){
  if(!editing||texting) return;
  var text='';
  try{ text=e.clipboardData.getData('text/plain'); }catch(err){}
  if(text&&text.indexOf(FIG_CLIP_MARK)===0){
    e.preventDefault();
    pasteFromText(text);
    if(clipTA&&document.activeElement===clipTA){ clipTA.value=''; clipTA.blur(); }
  } else if(clipTA&&document.activeElement===clipTA){
    /* 도형 페이로드가 아닌 일반 텍스트. 브리지만 정리 */
    e.preventDefault(); clipTA.value=''; clipTA.blur();
  }
});

function zOrder(front){
  var ns=selNodes(); if(!ns.length) return;
  ns.forEach(function(n){
    var cv=canvasOf(n);
    var zs=$$('.fig-node',cv).map(function(m){ return parseInt(getComputedStyle(m).zIndex)||0; });
    n.style.zIndex=front?(Math.max.apply(null,zs)+1):(Math.min.apply(null,zs)-1);
  });
  commit();
}

/* ================================================================
   속성 패널
   ================================================================ */
function mountPanel(parent){
  var p=document.createElement('div');
  p.className='fig-panel'; p.id='figPanel';
  p.innerHTML=
  '<h4><span id="fpTitle">속성</span><span class="cnt" id="fpCnt"></span></h4>'+
  '<div id="fpNode">'+
    '<div class="fp-row"><label>배경</label><input type="color" id="fpBg"></div>'+
    '<div class="fp-row"><label>테두리</label><input type="color" id="fpBd"><input type="range" id="fpBw" min="0" max="8" step="0.5"><span class="val" id="fpBwV"></span></div>'+
    '<div class="fp-row"><label>글자색</label><input type="color" id="fpFg"></div>'+
    '<div class="fp-row"><label>둥글기</label><input type="range" id="fpRad" min="0" max="40" step="1"><span class="val" id="fpRadV"></span></div>'+
    '<div class="fp-row"><label>투명도</label><input type="range" id="fpOp" min="10" max="100" step="5"><span class="val" id="fpOpV"></span></div>'+
    '<div class="fp-btns">'+
      '<button class="fig-pb tgl" id="fpShadow">그림자</button>'+
      '<button class="fig-pb" id="fpFront">맨앞</button><button class="fig-pb" id="fpBack">맨뒤</button>'+
      '<button class="fig-pb" id="fpDup">복제 ⌘D</button><button class="fig-pb warn" id="fpDel">삭제</button>'+
    '</div>'+
  '</div>'+
  '<div id="fpEdge">'+
    '<div class="fp-row"><label>선 색</label><input type="color" id="feCol"><select id="feStyle"><option value="solid">실선</option><option value="dashed">파선</option><option value="dotted">점선</option></select></div>'+
    '<div class="fp-row"><label>두께</label><input type="range" id="feW" min="1" max="8" step="0.5"><span class="val" id="feWV"></span></div>'+
    '<div class="fp-row"><label>화살촉</label><select id="feArrow"><option value="end">끝</option><option value="both">양쪽</option><option value="none">없음</option></select>'+
      '<button class="fig-pb" id="feRev">⇄ 반전</button></div>'+
    '<div class="fp-row"><label>시작점</label><select id="feAnchF">'+
      '<option value="auto">자동</option><option value="top">위</option><option value="bottom">아래</option>'+
      '<option value="left">왼쪽</option><option value="right">오른쪽</option></select></div>'+
    '<div class="fp-row"><label>끝점</label><select id="feAnchT">'+
      '<option value="auto">자동</option><option value="top">위</option><option value="bottom">아래</option>'+
      '<option value="left">왼쪽</option><option value="right">오른쪽</option></select></div>'+
    '<div class="fp-row"><label>곡률</label><input type="range" id="feCurve" min="-100" max="100" step="5"><span class="val" id="feCurveV"></span></div>'+
    '<div class="fp-row"><label>투명도</label><input type="range" id="feOp" min="10" max="100" step="5"><span class="val" id="feOpV"></span></div>'+
    '<div class="fp-row"><label>라벨</label><input type="text" id="feLabel" placeholder="화살표 라벨"></div>'+
    '<div class="fp-btns"><button class="fig-pb tgl" id="feFlow">흐름 애니메이션</button><button class="fig-pb warn" id="feDel">삭제</button></div>'+
  '</div>'+
  '<div id="fpText">'+
    '<div class="ft-row"><select class="ft-sel" id="ftBlock" title="단락 스타일">'+
      '<option value="p">본문</option><option value="h1">제목 1</option><option value="h2">제목 2</option><option value="h3">소제목</option><option value="blockquote">인용</option></select></div>'+
    '<div class="ft-row"><select class="ft-sel" id="ftFont" title="글씨체">'+
      '<option value="">글씨체</option>'+
      '<option value="\'Pretendard\',\'Apple SD Gothic Neo\',sans-serif">기본(고딕)</option>'+
      '<option value="Georgia,\'Noto Serif KR\',serif">세리프</option>'+
      '<option value="ui-monospace,\'JetBrains Mono\',Menlo,monospace">고정폭</option></select></div>'+
    '<div class="ft-row ft-size"><button class="ft-b" id="ftSizeDn" title="한 단계 작게">A−</button>'+
      '<select class="ft-sel" id="ftSize" title="글씨 크기"><option value="">크기</option>'+
      '<option>12</option><option>14</option><option>16</option><option>18</option><option>20</option><option>24</option><option>28</option><option>32</option><option>36</option><option>40</option><option>48</option><option>56</option><option>64</option><option>72</option><option>80</option><option>96</option><option>120</option><option>160</option></select>'+
      '<button class="ft-b" id="ftSizeUp" title="한 단계 크게">A+</button></div>'+
    '<div class="ft-row ft-g5">'+
      '<button class="ft-b" id="ftB" style="font-weight:900" title="굵게">B</button>'+
      '<button class="ft-b" id="ftI" style="font-style:italic" title="기울임">I</button>'+
      '<button class="ft-b" id="ftU" style="text-decoration:underline" title="밑줄">U</button>'+
      '<button class="ft-b" id="ftS" style="text-decoration:line-through" title="취소선">S</button>'+
      '<button class="ft-b" id="ftClear" title="서식 지우기">↺</button></div>'+
    '<div class="ft-row">'+
      '<span class="ft-col"><label>글자</label><input type="color" id="ftCol"></span>'+
      '<span class="ft-col"><label>배경</label><input type="color" id="ftBg" value="#fff3a3"><button class="ft-mini" id="ftBgClear" title="배경 지움">지움</button></span></div>'+
    '<div class="ft-row ft-g5">'+
      '<button class="ft-b" id="ftAL" title="왼쪽 정렬">⇤</button>'+
      '<button class="ft-b" id="ftAC" title="가운데 정렬">≡</button>'+
      '<button class="ft-b" id="ftAR" title="오른쪽 정렬">⇥</button>'+
      '<button class="ft-b" id="ftUL" title="불릿 목록">•</button>'+
      '<button class="ft-b" id="ftOL" title="번호 목록">1.</button></div>'+
    '<div class="ft-row ft-g5">'+
      '<button class="ft-b" id="ftOut" title="내어쓰기">◂</button>'+
      '<button class="ft-b" id="ftIn" title="들여쓰기">▸</button>'+
      '<button class="ft-b" id="ftTable" title="표 삽입">표</button></div>'+
    '<div class="fp-note">글자를 드래그로 선택한 뒤 적용하세요. Esc로 편집 종료.</div>'+
  '</div>'+
  '<div class="fp-note" id="fpHint">요소를 클릭해 선택하세요.<br>더블클릭 = 글자 수정 · ⌥드래그 = 복제</div>';
  (parent||body).appendChild(p);

  /* --- 노드 --- */
  function eachN(fn){ selNodes().forEach(fn); scheduleCommit(); }
  $('#fpBg',p).addEventListener('input',function(){ var v=this.value; eachN(function(n){ n.style.background=v; }); });
  $('#fpBd',p).addEventListener('input',function(){ var v=this.value; eachN(function(n){ n.style.borderColor=v;
    if(!parseFloat(getComputedStyle(n).borderTopWidth)){ n.style.borderWidth='1px'; n.style.borderStyle='solid'; $('#fpBw',p).value=1; $('#fpBwV',p).textContent='1'; } }); });
  $('#fpBw',p).addEventListener('input',function(){ var v=this.value; $('#fpBwV',p).textContent=v;
    eachN(function(n){ n.style.borderWidth=v+'px'; n.style.borderStyle=(+v)?'solid':'none'; }); });
  $('#fpFg',p).addEventListener('input',function(){ var v=this.value; eachN(function(n){ n.style.color=v; }); });
  $('#fpRad',p).addEventListener('input',function(){ var v=this.value; $('#fpRadV',p).textContent=v;
    eachN(function(n){ n.style.borderRadius=v+'px'; }); });
  $('#fpOp',p).addEventListener('input',function(){ var v=this.value; $('#fpOpV',p).textContent=v+'%';
    eachN(function(n){ n.style.opacity=v/100; }); });
  $('#fpShadow',p).addEventListener('click',function(){
    var on=!this.classList.contains('on'); this.classList.toggle('on',on);
    eachN(function(n){ n.style.boxShadow=on?'0 8px 24px rgba(15,23,42,.14)':'none'; });
  });
  $('#fpFront',p).addEventListener('click',function(){ zOrder(true); });
  $('#fpBack',p).addEventListener('click',function(){ zOrder(false); });
  $('#fpDup',p).addEventListener('click',duplicateSel);
  $('#fpDel',p).addEventListener('click',deleteSel);

  /* --- 엣지 --- */
  function eachE(fn){ selEdges().forEach(function(e){ fn(e); renderEdge(canvasOf(e),e); }); refreshHandles(); scheduleCommit(); }
  $('#feCol',p).addEventListener('input',function(){ var v=this.value; eachE(function(e){ e.dataset.color=v; }); });
  $('#feStyle',p).addEventListener('change',function(){ var v=this.value; eachE(function(e){ e.dataset.style=v; }); });
  $('#feW',p).addEventListener('input',function(){ var v=this.value; $('#feWV',p).textContent=v; eachE(function(e){ e.dataset.width=v; }); });
  $('#feArrow',p).addEventListener('change',function(){ var v=this.value; eachE(function(e){ e.dataset.arrow=v; }); });
  $('#feRev',p).addEventListener('click',function(){
    eachE(function(e){
      var f=e.dataset.from; e.dataset.from=e.dataset.to; e.dataset.to=f;
      var af=e.dataset.anchorFrom, at=e.dataset.anchorTo;
      if(af) e.dataset.anchorTo=af; else delete e.dataset.anchorTo;
      if(at) e.dataset.anchorFrom=at; else delete e.dataset.anchorFrom;
      if(e.dataset.curve) e.dataset.curve=String(-parseFloat(e.dataset.curve));
    });
  });
  function bindAnchor(selId,attr){
    $(selId,p).addEventListener('change',function(){
      var v=this.value;
      eachE(function(e){
        if(v==='auto') delete e.dataset[attr];
        else if(v!=='custom') e.dataset[attr]=v;
      });
    });
  }
  bindAnchor('#feAnchF','anchorFrom');
  bindAnchor('#feAnchT','anchorTo');
  $('#feCurve',p).addEventListener('input',function(){ var v=this.value; $('#feCurveV',p).textContent=(v/100).toFixed(2);
    eachE(function(e){ e.dataset.curve=v/100; }); });
  $('#feOp',p).addEventListener('input',function(){ var v=this.value; $('#feOpV',p).textContent=v+'%';
    eachE(function(e){ e.dataset.opacity=v/100; }); });
  $('#feLabel',p).addEventListener('input',function(){ var v=this.value; eachE(function(e){ e.dataset.label=v; }); });
  $('#feFlow',p).addEventListener('click',function(){
    var on=!this.classList.contains('on'); this.classList.toggle('on',on);
    eachE(function(e){ if(on) e.dataset.flow='on'; else delete e.dataset.flow; });
  });
  $('#feDel',p).addEventListener('click',deleteSel);

  /* --- 텍스트 서식 (html-doc 편집 기능 전체) --- */
  function refocus(){ if(texting) texting.focus(); }
  function tq(c){ try{ return document.queryCommandState(c); }catch(e){ return false; } }
  function ftExec(cmd,val){ refocus(); try{ document.execCommand('styleWithCSS',false,true); }catch(e){} document.execCommand(cmd,false,val); scheduleCommit(); ftReflect(); }
  var FT_SIZES=[12,14,16,18,20,24,28,32,36,40,48,56,64,72,80,96,120,160];
  function ftApplySize(px){
    refocus();
    /* styleWithCSS를 잠시 꺼야 fontSize=7이 <font size=7>로 생성됨(켜져 있으면 xxx-large 스팬 → 초대형 버그) */
    try{ document.execCommand('styleWithCSS',false,false); }catch(e){}
    document.execCommand('fontSize',false,'7');
    try{ document.execCommand('styleWithCSS',false,true); }catch(e){}
    $$('font[size="7"]',texting||document).forEach(function(f){
      f.removeAttribute('size'); f.style.fontSize=px+'px';
      $$('font[size],[style*="font-size"]',f).forEach(function(inner){ inner.removeAttribute('size'); inner.style.fontSize=''; });
    });
    scheduleCommit(); ftReflect();
  }
  function curFontPx(){
    var sel=window.getSelection(), el=null;
    if(sel&&sel.rangeCount){
      var rg=sel.getRangeAt(0), sc=rg.startContainer;
      el = (sc.nodeType===3) ? sc.parentElement
         : (sc.childNodes[rg.startOffset]||sc.childNodes[rg.startOffset-1]||sc);
      if(el&&el.nodeType===3) el=el.parentElement;
    }
    if((!el||(texting&&!texting.contains(el)&&el!==texting))&&texting) el=texting;
    return el?(Math.round(parseFloat(getComputedStyle(el).fontSize))||16):16;
  }
  function ftStep(dir){
    var cur=curFontPx(), idx=0, best=Infinity;
    FT_SIZES.forEach(function(s,i){ var d=Math.abs(s-cur); if(d<best){ best=d; idx=i; } });
    var ni;
    if(FT_SIZES[idx]===cur) ni=idx+dir;
    else ni = dir>0 ? (FT_SIZES[idx]>cur?idx:idx+1) : (FT_SIZES[idx]<cur?idx:idx-1);
    ftApplySize(FT_SIZES[Math.max(0,Math.min(FT_SIZES.length-1,ni))]);
  }
  function ftBack(c){ refocus(); try{ document.execCommand('styleWithCSS',false,true); }catch(e){}
    if(!document.execCommand('hiliteColor',false,c)) document.execCommand('backColor',false,c); scheduleCommit(); }
  function ftInsertTable(){
    refocus(); var h='<table style="border-collapse:collapse;width:100%;margin:6px 0">';
    for(var r=0;r<2;r++){ h+='<tr>'; for(var c=0;c<2;c++) h+='<td style="border:1px solid #cbd5e1;padding:4px 8px">&nbsp;</td>'; h+='</tr>'; }
    h+='</table>'; document.execCommand('insertHTML',false,h); scheduleCommit();
  }
  function ftReflect(){
    if(!texting) return;
    [['ftB','bold'],['ftI','italic'],['ftU','underline'],['ftS','strikeThrough'],
     ['ftAL','justifyLeft'],['ftAC','justifyCenter'],['ftAR','justifyRight'],
     ['ftUL','insertUnorderedList'],['ftOL','insertOrderedList']].forEach(function(x){
      var b=$('#'+x[0],p); if(b) b.classList.toggle('on', tq(x[1]));
    });
    var ss=$('#ftSize',p); if(ss){ var px=curFontPx(); ss.value=FT_SIZES.indexOf(px)>=0?String(px):''; }
  }
  $('#ftB',p).addEventListener('click',function(){ ftExec('bold'); });
  $('#ftI',p).addEventListener('click',function(){ ftExec('italic'); });
  $('#ftU',p).addEventListener('click',function(){ ftExec('underline'); });
  $('#ftS',p).addEventListener('click',function(){ ftExec('strikeThrough'); });
  $('#ftClear',p).addEventListener('click',function(){ ftExec('removeFormat'); });
  $('#ftAL',p).addEventListener('click',function(){ ftExec('justifyLeft'); });
  $('#ftAC',p).addEventListener('click',function(){ ftExec('justifyCenter'); });
  $('#ftAR',p).addEventListener('click',function(){ ftExec('justifyRight'); });
  $('#ftUL',p).addEventListener('click',function(){ ftExec('insertUnorderedList'); });
  $('#ftOL',p).addEventListener('click',function(){ ftExec('insertOrderedList'); });
  $('#ftOut',p).addEventListener('click',function(){ ftExec('outdent'); });
  $('#ftIn',p).addEventListener('click',function(){ ftExec('indent'); });
  $('#ftTable',p).addEventListener('click',ftInsertTable);
  $('#ftBlock',p).addEventListener('change',function(){ ftExec('formatBlock','<'+this.value+'>'); });
  $('#ftFont',p).addEventListener('change',function(){ if(this.value) ftExec('fontName',this.value); this.value=''; });
  $('#ftSize',p).addEventListener('change',function(){ if(this.value) ftApplySize(this.value); });
  $('#ftSizeUp',p).addEventListener('click',function(){ ftStep(1); });
  $('#ftSizeDn',p).addEventListener('click',function(){ ftStep(-1); });
  $('#ftCol',p).addEventListener('input',function(){ ftExec('foreColor',this.value); });
  $('#ftBg',p).addEventListener('input',function(){ ftBack(this.value); });
  $('#ftBgClear',p).addEventListener('click',function(){ ftBack('transparent'); });
  ftReflectRef=ftReflect;   /* selectionchange 리스너는 모듈 레벨에서 한 번만 등록 */
  // 패널 내 조작이 선택 해제로 이어지지 않게
  p.addEventListener('pointerdown',function(ev){ ev.stopPropagation(); });
}
function updatePanel(){
  var p=$('#figPanel'); if(!p) return;
  var ns=selNodes(), es=selEdges();
  $('#fpNode',p).style.display=(ns.length&&!texting)?'block':'none';
  $('#fpEdge',p).style.display=(es.length&&!texting)?'block':'none';
  $('#fpText',p).style.display=texting?'block':'none';
  $('#fpHint',p).style.display=(!ns.length&&!es.length&&!texting)?'block':'none';
  $('#fpCnt',p).textContent=(ns.length+es.length)>1?((ns.length+es.length)+'개 선택'):'';
  $('#fpTitle',p).textContent=texting?'글자 서식':(es.length&&!ns.length?'화살표':(ns.length?'박스':'속성'));
  if(ns.length&&!texting){
    var n=ns[0], cs=getComputedStyle(n);
    $('#fpBg',p).value=rgbToHex(cs.backgroundColor);
    $('#fpBd',p).value=rgbToHex(cs.borderTopColor);
    $('#fpBw',p).value=parseFloat(cs.borderTopWidth)||0; $('#fpBwV',p).textContent=parseFloat(cs.borderTopWidth)||0;
    $('#fpFg',p).value=rgbToHex(cs.color);
    $('#fpRad',p).value=parseFloat(cs.borderRadius)||0; $('#fpRadV',p).textContent=Math.round(parseFloat(cs.borderRadius)||0);
    var op=Math.round((parseFloat(cs.opacity)||1)*100);
    $('#fpOp',p).value=op; $('#fpOpV',p).textContent=op+'%';
    $('#fpShadow',p).classList.toggle('on',cs.boxShadow!=='none');
  }
  if(es.length&&!texting){
    var e=es[0];
    /* 앵커 셀렉트: 비율 고정이면 '지정 위치' 표시, 좌표 끝점이면 비활성 */
    [['#feAnchF','anchorFrom','from'],['#feAnchT','anchorTo','to']].forEach(function(cfg){
      var sel=$(cfg[0],p), v=e.dataset[cfg[1]]||'auto', endVal=e.dataset[cfg[2]]||'';
      var cust=sel.querySelector('option[value="custom"]');
      if(/^[\d.]+\s*,\s*[\d.]+$/.test(v)){
        if(!cust){ cust=document.createElement('option'); cust.value='custom'; cust.textContent='지정 위치'; sel.appendChild(cust); }
        sel.value='custom';
      } else {
        if(cust) cust.remove();
        sel.value=(['top','bottom','left','right'].indexOf(v)>=0)?v:'auto';
      }
      sel.disabled=isPointVal(endVal);   /* 좌표 끝점엔 앵커 개념 없음 */
    });
    $('#feCol',p).value=(e.dataset.color&&e.dataset.color[0]==='#')?e.dataset.color:rgbToHex(e.dataset.color||'#64748b');
    $('#feStyle',p).value=e.dataset.style||'solid';
    $('#feW',p).value=parseFloat(e.dataset.width||'2'); $('#feWV',p).textContent=parseFloat(e.dataset.width||'2');
    $('#feArrow',p).value=e.dataset.arrow||'end';
    var cv=Math.round(parseFloat(e.dataset.curve||'0')*100);
    $('#feCurve',p).value=clamp(cv,-100,100); $('#feCurveV',p).textContent=(cv/100).toFixed(2);
    var eo=Math.round((e.dataset.opacity?parseFloat(e.dataset.opacity):1)*100);
    $('#feOp',p).value=eo; $('#feOpV',p).textContent=eo+'%';
    $('#feLabel',p).value=e.dataset.label||'';
    $('#feFlow',p).classList.toggle('on', /^(on|1|true|yes)$/i.test(e.dataset.flow||''));
  }
}

/* ================================================================
   툴바 · 토스트 · 배너 · 히스토리 모달
   ================================================================ */
/* 문서 레벨 리스너는 여기서 한 번만 등록한다(mountUI/mountPanel은 undo마다 다시 실행되므로 그 안에서 등록하면 누적된다) */
document.addEventListener('pointerdown',function(ev){
  var m=$('#figMenu');
  if(m&&m.classList.contains('open')&&!(ev.target.closest&&ev.target.closest('#figPill'))) m.classList.remove('open');
},true);
document.addEventListener('selectionchange',function(){ if(editing&&texting&&ftReflectRef) ftReflectRef(); });
function mountUI(){
  if($('#figDock')) return;
  /* 보기 모드: 미니 필 (✎ 편집 + ⋯ 메뉴) */
  var pill=document.createElement('div');
  pill.className='fig-pill'; pill.id='figPill'; pill.setAttribute('data-fig-ui','');
  pill.innerHTML='<button class="fp-edit" id="figEditToggle">✎ 편집</button>'+
    '<button class="fp-more" id="figMore" title="더보기">⋯</button>'+
    '<div class="fig-menu" id="figMenu">'+
      '<button id="figSaveM">저장&nbsp;&nbsp;⌘S</button>'+
      '<button id="figSaveAsM">다른 이름으로 저장</button>'+
      '<button id="figExportM">배포용으로 저장 (편집기 제거)</button>'+
      '<button id="figHistoryM">저장 히스토리</button></div>';
  body.appendChild(pill);
  /* 편집 모드: 통합 도크 */
  var dock=document.createElement('div');
  dock.className='fig-dock'; dock.id='figDock'; dock.setAttribute('data-fig-ui','');
  dock.innerHTML=
    '<div class="fd-head"><span class="dot"></span><span class="t">편집 중</span>'+
      '<button class="fd-done" id="figDone">완료</button></div>'+
    '<div class="fd-sec"><div class="fd-cap">삽입</div>'+
      '<div class="fd-row"><button class="fd-b" id="figAddNode">▢ 박스</button>'+
      '<button class="fd-b" id="figAddEdge">↗ 화살표</button></div></div>'+
    '<div class="fd-sec"><div class="fd-cap">문서</div>'+
      '<div class="fd-row">'+
        '<button class="fd-b sq" id="figUndo" title="되돌리기 ⌘Z">↩︎</button>'+
        '<button class="fd-b sq" id="figRedo" title="다시 실행 ⇧⌘Z">↪︎</button>'+
        '<button class="fd-b primary" id="figSave">저장 ⌘S</button></div>'+
      '<div class="fd-row"><button class="fd-b" id="figSaveAs">다른 이름</button>'+
        '<button class="fd-b" id="figHistory">히스토리</button></div>'+
      '<div class="fd-row"><button class="fd-b" id="figExport" title="편집기를 걷어낸 정적 HTML로 저장">배포용 저장</button></div></div>';
  body.appendChild(dock);
  var to=document.createElement('div'); to.className='fig-toast'; to.id='figToast'; to.setAttribute('data-fig-ui',''); body.appendChild(to);
  var bn=document.createElement('div'); bn.className='fig-banner'; bn.id='figBanner'; bn.setAttribute('data-fig-ui','');
  bn.innerHTML='<span class="msg"></span><button class="fd-done" id="figRbRestore">복구</button>'+
    '<button class="fd-b" style="flex:0 0 auto;background:#fff;color:#6b7280;border-color:#e4dcc9" id="figRbIgnore">무시</button>';
  body.appendChild(bn);
  var md=document.createElement('div'); md.className='fig-modal'; md.id='figModal'; md.setAttribute('data-fig-ui','');
  md.innerHTML='<div class="fm-card"><div class="fm-head"><b>저장 히스토리</b><button class="fd-b" style="flex:0 0 auto;background:#eef1f5;color:#374151;border-color:#dfe3ea" id="figHistClose">닫기</button></div>'+
    '<div class="fm-body"><div class="fm-list" id="figHistList"></div><div class="fm-preview" id="figHistPrev"></div></div></div>';
  body.appendChild(md);

  mountPanel(dock);   /* 속성 섹션은 도크 안에 */

  $('#figEditToggle').addEventListener('click',function(){ setEdit(true); });
  $('#figDone').addEventListener('click',function(){ setEdit(false); });
  $('#figMore').addEventListener('click',function(ev){ ev.stopPropagation(); $('#figMenu').classList.toggle('open'); });
  function menuAct(id,fn){ $(id).addEventListener('click',function(){ $('#figMenu').classList.remove('open'); fn(); }); }
  menuAct('#figSaveM',function(){ saveToFile(false); });
  menuAct('#figSaveAsM',function(){ saveToFile(true); });
  menuAct('#figHistoryM',openHistory);
  menuAct('#figExportM',saveStaticToFile);
  $('#figExport').addEventListener('click',saveStaticToFile);
  $('#figSave').addEventListener('click',function(){ saveToFile(false); });
  $('#figSaveAs').addEventListener('click',function(){ saveToFile(true); });
  $('#figHistory').addEventListener('click',openHistory);
  $('#figHistClose').addEventListener('click',function(){ $('#figModal').classList.remove('open'); });
  $('#figModal').addEventListener('mousedown',function(e){ if(e.target===this) this.classList.remove('open'); });
  $('#figAddNode').addEventListener('click',addNode);
  $('#figAddEdge').addEventListener('click',addEdgeNew);
  $('#figUndo').addEventListener('click',undo);
  $('#figRedo').addEventListener('click',redo);
}

/* ================================================================
   스냅샷 · Undo/Redo
   ================================================================ */
/* 정리 훅: 같은 문서의 다른 런타임(html-deck 등)이 저장·undo 스냅샷·배포본·클립보드에서
   자기 상태(장면 클래스, 카메라, 맞춤 스타일)를 걷어내도록 등록한다. FigEditor.onClean(fn), fn(루트 요소) */
var cleaners=[];
function runCleaners(root){ cleaners.forEach(function(fn){ try{ fn(root); }catch(e){} }); }
function cleanBodyHTML(){
  var c=body.cloneNode(true);
  $$('[data-fig-ui]',c).forEach(function(el){ el.remove(); });
  $$('script',c).forEach(function(el){ el.remove(); });   /* 엔진·히스토리 script는 스냅샷에서 제외(히스토리 중첩·비대화 방지) */
  $$('.fig-scale',c).forEach(function(w){
    var cv=$('.fig-canvas',w);
    if(cv){ cv.style.transform=''; w.parentNode.replaceChild(cv,w); } else w.remove();
  });
  $$('.fig-selected,.fig-texting,.fig-dragging,.fig-snaptarget',c).forEach(function(el){
    el.classList.remove('fig-selected','fig-texting','fig-dragging','fig-snaptarget');
  });
  $$('[contenteditable]',c).forEach(function(el){ el.removeAttribute('contenteditable'); });
  c.classList.remove('fig-editing');
  runCleaners(c);
  return c.innerHTML;
}
/* 스냅샷 정화: 예전 엔진이 남긴 script(엔진·히스토리)를 제거한다 */
function sanitizeSnapshot(html){
  if(!html||html.indexOf('<script')<0) return html;
  var t=document.createElement('template'); t.innerHTML=html;
  Array.prototype.slice.call(t.content.querySelectorAll('script')).forEach(function(s){ s.remove(); });
  return t.innerHTML;
}
function restoreBody(html){
  finishLabelEdit(true); stopTextEdit(); selection=[];
  body.innerHTML=sanitizeSnapshot(html);
  bodyScripts.forEach(function(s){ body.appendChild(s); });   /* 이미 실행된 script 요소라 재실행 없이 DOM에만 복귀(저장 파일에 엔진이 남도록) */
  mountUI(); initCanvases(); renderAll();
  body.classList.toggle('fig-editing',editing);
  updatePanel();
}
function commit(){
  var snap=cleanBodyHTML();
  if(undoStack.length&&undoStack[undoStack.length-1]===snap) return;
  undoStack.push(snap);
  if(undoStack.length>UNDO_MAX) undoStack.shift();
  redoStack=[];
  scheduleAutosave();
}
function scheduleCommit(){ clearTimeout(commitTimer); commitTimer=setTimeout(commit,500); }
function undo(){
  if(!editing) return;
  if(undoStack.length<2){ toast('되돌릴 내용이 없습니다'); return; }
  redoStack.push(undoStack.pop());
  restoreBody(undoStack[undoStack.length-1]);
  scheduleAutosave();
}
function redo(){
  if(!editing||!redoStack.length){ if(editing) toast('다시 실행할 내용이 없습니다'); return; }
  var s=redoStack.pop(); undoStack.push(s);
  restoreBody(s); scheduleAutosave();
}

/* ================================================================
   직렬화 · 저장 · 히스토리 · 자동저장
   ================================================================ */
function histEl(){
  var el=$('#fig-history');
  if(!el){ el=document.createElement('script'); el.type='application/json'; el.id='fig-history';
    el.textContent='[]'; body.appendChild(el); }
  return el;
}
function loadHistory(){
  var arr; try{ arr=JSON.parse(histEl().textContent||'[]'); }catch(e){ arr=[]; }
  if(!Array.isArray(arr)) arr=[];
  arr.forEach(function(h){ if(h&&typeof h.html==='string') h.html=sanitizeSnapshot(h.html); });   /* 구버전의 중첩 히스토리 정리 */
  return arr;
}
function docTitle(){
  var t=document.title||''; if(t) return t;
  var h=$('h1,h2'); return h?h.textContent.trim():'도식';
}
function serialize(){
  histEl().textContent=escForScript(JSON.stringify(histArr));
  var clone=document.documentElement.cloneNode(true);
  var b=clone.querySelector('body');
  if(b){
    var tmp=document.createElement('div');
    // cleanBodyHTML과 동일 규칙을 클론에 적용
    Array.prototype.slice.call(b.querySelectorAll('[data-fig-ui]')).forEach(function(el){
      if(el.id==='fig-history') return; // 히스토리는 보존
      el.remove();
    });
    Array.prototype.slice.call(b.querySelectorAll('.fig-scale')).forEach(function(w){
      var cv=w.querySelector('.fig-canvas');
      if(cv){ cv.style.transform=''; w.parentNode.replaceChild(cv,w); } else w.remove();
    });
    Array.prototype.slice.call(b.querySelectorAll('.fig-selected,.fig-texting,.fig-dragging,.fig-snaptarget')).forEach(function(el){
      el.classList.remove('fig-selected','fig-texting','fig-dragging','fig-snaptarget');
    });
    Array.prototype.slice.call(b.querySelectorAll('[contenteditable]')).forEach(function(el){ el.removeAttribute('contenteditable'); });
    b.classList.remove('fig-editing');
    runCleaners(b);
  }
  return '<!DOCTYPE html>\n'+clone.outerHTML;
}
function suggestName(){
  var t=docTitle().replace(/[\\/:*?"<>|]/g,'').trim();
  return (t||'도식')+'.html';
}
function downloadHtml(html){ downloadHtmlAs(html,suggestName()); }
function downloadHtmlAs(html,name){
  var blob=new Blob([html],{type:'text/html;charset=utf-8'});
  var a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=name;
  document.body.appendChild(a); a.click();
  setTimeout(function(){ URL.revokeObjectURL(a.href); a.remove(); },1200);
}
var lastSavedHtml=null;
function snapshotForHistory(){ return cleanBodyHTML(); }
function pushHistoryIfChanged(){
  var cur=snapshotForHistory();
  if(lastSavedHtml!==null&&cur!==lastSavedHtml){
    histArr.unshift({ts:new Date().toISOString(), title:docTitle(), html:lastSavedHtml});
    histArr=histArr.slice(0,30);
  }
}
async function writeSerialized(handle){ var w=await handle.createWritable(); await w.write(serialize()); await w.close(); }
/* 클로드 아티팩트 안에서 열린 경우: 페이지가 자기 새 버전을 발행하는 런타임(claude.use('artifact'))이 있으면 파일 대신 그쪽으로 저장한다.
   일반 브라우저에는 window.claude가 없으므로 즉시 null. 결과는 한 번만 확인해 둔다 */
var artifactNs;
function artifactApi(){
  if(artifactNs!==undefined) return Promise.resolve(artifactNs);
  if(!(window.claude&&typeof window.claude.use==='function')){ artifactNs=null; return Promise.resolve(null); }
  return Promise.resolve().then(function(){ return window.claude.use('artifact'); })
    .then(function(ns){ artifactNs=(ns&&typeof ns.publish==='function')?ns:null; return artifactNs; })
    .catch(function(){ artifactNs=null; return null; });
}
async function saveToFile(forceNew){
  finishLabelEdit(); if(texting) stopTextEdit();
  /* 편집 모드를 껐다 켜지 않는다(선택·도크 유지). serialize()가 편집 흔적을 알아서 걷어낸다 */
  var art=forceNew?null:await artifactApi();
  if(art){
    toast('아티팩트에 저장 중…');
    try{
      pushHistoryIfChanged();
      await art.publish(serialize());          /* 새 버전 발행. 열어 둔 모든 화면이 이 버전으로 다시 열린다 */
      lastSavedHtml=snapshotForHistory();
      try{ localStorage.removeItem(autosaveKey()); }catch(e){}
      toast('아티팩트에 새 버전으로 저장했습니다');
    }catch(err){
      var code=String((err&&(err.code||err.name))||'');
      if(/not_writer|not_granted/i.test(code)) toast('이 아티팩트에 편집 권한이 없어 저장할 수 없습니다');
      else if(/conflict/i.test(code)) toast('다른 사람이 먼저 저장해 최신 버전으로 다시 열립니다');
      else toast('아티팩트 저장 실패'+(code?' ('+code+')':''));
    }
    return;
  }
  if(!window.showSaveFilePicker){
    pushHistoryIfChanged(); downloadHtml(serialize()); lastSavedHtml=snapshotForHistory();
    toast('다운로드로 저장했습니다 (이 브라우저는 같은 파일 덮어쓰기 미지원)'); return;
  }
  function pick(){ return window.showSaveFilePicker({suggestedName:suggestName(),
    types:[{description:'HTML 문서',accept:{'text/html':['.html','.htm']}}]}); }
  var handle=forceNew?null:fileHandle, note='';
  try{
    /* 1) 저장 대상 확보: 기존 핸들 권한 확인 → 안 되면 파일 선택창으로 재획득
          (2차 저장부터 브라우저가 권한을 prompt로 되돌려도 조용히 실패하지 않게) */
    if(handle){
      var perm=await handle.queryPermission({mode:'readwrite'});
      if(perm!=='granted') perm=await handle.requestPermission({mode:'readwrite'});
      if(perm!=='granted'){ note='권한 재요청'; handle=await pick(); }
    } else {
      handle=await pick();
    }
    if(handle!==fileHandle) rotateDocId();
    fileHandle=handle;
    pushHistoryIfChanged();
    /* 2) 쓰기. 실패하면 파일 선택창으로 한 번 더 시도 */
    try{ await writeSerialized(handle); }
    catch(werr){
      note=werr&&werr.name||'쓰기오류';
      handle=await pick();
      if(handle!==fileHandle){ rotateDocId(); fileHandle=handle; }
      await writeSerialized(handle);
    }
    lastSavedHtml=snapshotForHistory();
    try{ localStorage.removeItem(autosaveKey()); }catch(e){}
    storeHandle(fileHandle);   /* 다음 세션에도 '저장'이 바로 이 파일로 */
    toast('저장되었습니다 · '+fileHandle.name);
  }catch(err){
    if(err&&err.name==='AbortError') return;   /* 사용자가 대화상자 취소 */
    pushHistoryIfChanged(); downloadHtml(serialize()); lastSavedHtml=snapshotForHistory();
    toast('파일 저장 실패. 다운로드로 대체했습니다'+(note?' ('+note+')':''));
  }
}
/* ================================================================
   배포용 정적 내보내기: 엔진·편집 UI를 걷어내고, 엔진이 그린 화살표 SVG와 라벨을 문서에 굽는다.
   결과물은 편집이 안 되는 대신 어떤 환경에서도 그대로 보이는 HTML 한 파일이다.
   ================================================================ */
var STATIC_CSS=
'/* fig-static: 배포본 최소 스타일. fig-editor.css의 규약 부분과 같게 유지한다 */\n'+
'.fig-scale{position:relative;overflow:visible}\n'+
'.fig-canvas{position:relative;transform-origin:0 0}\n'+
'.fig-node{position:absolute;box-sizing:border-box}\n'+
'.fig-node *{box-sizing:border-box}\n'+
'.fig-edge{display:none}\n'+
'.fig-edges{position:absolute;left:0;top:0;width:100%;height:100%;overflow:visible;pointer-events:none;z-index:5}\n'+
'.fig-elabel{position:absolute;z-index:6;font-size:12px;font-weight:700;padding:2px 8px;border-radius:12px;'+
'background:rgba(255,255,255,.94);box-shadow:0 1px 4px rgba(15,23,42,.14);white-space:nowrap;transform:translate(-50%,-50%);pointer-events:none}\n'+
'@keyframes figFlow{to{stroke-dashoffset:-28}}\n'+
'.fig-edges g.fig-flow .fe-main{stroke-dasharray:7 7 !important;animation:figFlow 1.05s linear infinite}\n';
var STATIC_JS=
'/* fig-static: 창 폭에 맞춰 캔버스를 축소하는 뷰어. 편집 기능은 없다 */\n'+
'(function(){\n'+
'function fit(){Array.prototype.forEach.call(document.querySelectorAll(".fig-canvas"),function(cv){'+
'var m=(cv.getAttribute("data-size")||"").match(/^\\s*(\\d+)\\s*[x\\u00d7]\\s*(\\d+)/i);'+
'var w=m?+m[1]:cv.offsetWidth,h=m?+m[2]:cv.offsetHeight;cv.style.width=w+"px";cv.style.height=h+"px";'+
'var wrap=cv.parentElement;if(!wrap.classList.contains("fig-scale")){var d=document.createElement("div");d.className="fig-scale";cv.parentNode.insertBefore(d,cv);d.appendChild(cv);wrap=d;}'+
'var sc=Math.min(1,(wrap.clientWidth||w)/w);cv.style.transform=sc<1?"scale("+sc+")":"";wrap.style.height=(h*sc)+"px";});}\n'+
'window.addEventListener("resize",fit);if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",fit);else fit();\n'+
'var noop=function(){};\n'+
'/* html-deck 런타임 등이 부르는 편집 API는 빈 함수로 둔다 */\n'+
'window.FigEditor=window.FigEditor||{static:true,fitAll:fit,renderAll:noop,setEdit:noop,onClean:noop,isEditing:function(){return false},'+
'selection:function(){return []},select:noop,clearSelection:noop,commit:noop,toast:noop,save:noop,'+
'serialize:function(){return "<!DOCTYPE html>\\n"+document.documentElement.outerHTML},clean:function(){return document.body.innerHTML}};\n'+
'})();\n';
var ENGINE_MARK='fig-editor.js: 편집 가능한 HTML 도식 공용 엔진';
function exportStatic(){
  finishLabelEdit(); if(texting) stopTextEdit();
  /* 숨겨진 컨테이너(덱의 비활성 슬라이드, 탭 등) 안의 캔버스는 크기가 0으로 측정돼 화살표가 한 점으로 구워지고
     높이가 0으로 굳는다. 굽는 동안만 조상을 펼치고, 복제본과 원본 모두 원래대로 되돌린다 */
  var shown=[];
  canvases().forEach(function(cv){
    var a=cv.parentElement;
    while(a&&a!==body){
      if(getComputedStyle(a).display==='none'&&!a.hasAttribute('data-fig-shown')){
        shown.push([a,a.style.display]); a.setAttribute('data-fig-shown',a.style.display||''); a.style.display='block';
      }
      a=a.parentElement;
    }
  });
  renderAll();
  var clone=document.documentElement.cloneNode(true);
  var head=clone.querySelector('head'), b=clone.querySelector('body');
  /* 높이를 지정하지 않은 노드는 지금 그려진 높이를 인라인으로 굳힌다. 구워진 화살표 좌표와 박스가 글꼴 환경에 관계없이 맞도록 */
  var liveNodes=$$('.fig-node'), cloneNodes=Array.prototype.slice.call(clone.querySelectorAll('.fig-node'));
  liveNodes.forEach(function(n,i){ var c=cloneNodes[i]; if(c&&!n.style.height&&n.offsetHeight>0) c.style.height=n.offsetHeight+'px'; });
  Array.prototype.slice.call(clone.querySelectorAll('[data-fig-shown]')).forEach(function(el){
    var v=el.getAttribute('data-fig-shown'); if(v) el.style.display=v; else el.style.removeProperty('display');
    if(!el.getAttribute('style')) el.removeAttribute('style'); el.removeAttribute('data-fig-shown');
  });
  shown.forEach(function(pr){ pr[0].style.display=pr[1]; pr[0].removeAttribute('data-fig-shown'); });
  Array.prototype.slice.call(clone.querySelectorAll('#fig-editor-css,#fig-static-css,#fig-static-js')).forEach(function(el){ el.remove(); });
  Array.prototype.slice.call(clone.querySelectorAll('script')).forEach(function(s){
    /* 엔진과 히스토리만 제거한다. 문서(또는 덱 런타임)의 다른 스크립트는 남긴다 */
    if(s.id==='fig-history'||(s.textContent||'').indexOf(ENGINE_MARK)>=0) s.remove();
  });
  if(b){
    Array.prototype.slice.call(b.querySelectorAll('[data-fig-ui]')).forEach(function(el){
      if(el.classList.contains('fig-edges')||el.classList.contains('fig-elabel')){ el.removeAttribute('data-fig-ui'); return; }   /* 화살표·라벨은 굽는다 */
      el.remove();   /* 도크·필·핸들·가이드·토스트·배너·모달·클립보드 브리지 */
    });
    Array.prototype.slice.call(b.querySelectorAll('.fig-edges .fe-hit')).forEach(function(el){ el.remove(); });
    Array.prototype.slice.call(b.querySelectorAll('.fig-edges [filter]')).forEach(function(el){ el.removeAttribute('filter'); });
    Array.prototype.slice.call(b.querySelectorAll('.fig-scale')).forEach(function(w){
      var cv=w.querySelector('.fig-canvas');
      if(cv){ cv.style.transform=''; w.parentNode.replaceChild(cv,w); } else w.remove();
    });
    Array.prototype.slice.call(b.querySelectorAll('.fig-selected,.fig-texting,.fig-dragging,.fig-snaptarget')).forEach(function(el){
      el.classList.remove('fig-selected','fig-texting','fig-dragging','fig-snaptarget');
    });
    Array.prototype.slice.call(b.querySelectorAll('[contenteditable]')).forEach(function(el){ el.removeAttribute('contenteditable'); });
    b.classList.remove('fig-editing'); runCleaners(b); if(!b.className) b.removeAttribute('class');
    b.removeAttribute('data-fig-doc');
    var js=document.createElement('script'); js.id='fig-static-js'; js.textContent=STATIC_JS; b.appendChild(js);
  }
  if(head){ var st=document.createElement('style'); st.id='fig-static-css'; st.textContent=STATIC_CSS; head.appendChild(st); }
  return '<!DOCTYPE html>\n'+clone.outerHTML;
}
function staticName(){ return (docTitle().replace(/[\\/:*?"<>|]/g,'').trim()||'도식')+' 배포용.html'; }
async function saveStaticToFile(){
  var html=exportStatic(), name=staticName();
  if(!window.showSaveFilePicker){ downloadHtmlAs(html,name); toast('배포용 파일을 다운로드했습니다 (편집기 제거)'); return; }
  try{
    var h=await window.showSaveFilePicker({suggestedName:name,types:[{description:'HTML 문서',accept:{'text/html':['.html','.htm']}}]});
    var w=await h.createWritable(); await w.write(html); await w.close();
    toast('배포용으로 저장했습니다 · '+h.name+' (편집기 제거. 원본은 그대로)');
  }catch(err){
    if(err&&err.name==='AbortError') return;
    downloadHtmlAs(html,name); toast('파일 저장 실패. 다운로드로 대체했습니다');
  }
}
/* 히스토리 모달 */
function fmtTs(iso){ try{ return new Date(iso).toLocaleString('ko-KR',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}); }catch(e){ return iso; } }
function openHistory(){
  var list=$('#figHistList'); list.innerHTML='';
  if(!histArr.length) list.innerHTML='<p style="font-size:13px;color:#6b7280">저장 히스토리가 없습니다.<br>저장할 때마다 직전 버전이 쌓입니다.</p>';
  histArr.forEach(function(h,i){
    var b=document.createElement('button'); b.className='fig-hist-item';
    b.innerHTML='<strong>'+escapeHtml(h.title)+'</strong><span>'+fmtTs(h.ts)+'</span>';
    b.onclick=function(){ previewHistory(i); };
    list.appendChild(b);
  });
  $('#figHistPrev').innerHTML='<p style="font-size:13px;color:#6b7280">왼쪽에서 버전을 선택하면 미리보기가 표시됩니다.</p>';
  $('#figModal').classList.add('open');
}
function previewHistory(i){
  var h=histArr[i], pv=$('#figHistPrev'); pv.innerHTML='';
  var bar=document.createElement('div'); bar.className='fm-actions';
  var btn=document.createElement('button'); btn.className='fd-done'; btn.textContent='이 버전으로 복원';
  btn.onclick=function(){ restoreFromHistory(i); };
  bar.appendChild(btn); pv.appendChild(bar);
  var doc=document.createElement('div'); doc.className='fm-doc'; doc.innerHTML=h.html;
  // 미리보기 안 스크립트/캔버스 크기 축소 표시
  Array.prototype.slice.call(doc.querySelectorAll('script')).forEach(function(s){ s.remove(); });
  pv.appendChild(doc);
}
function restoreFromHistory(i){
  histArr.unshift({ts:new Date().toISOString(), title:'복원 전: '+docTitle(), html:cleanBodyHTML()});
  histArr=histArr.slice(0,30);
  restoreBody(histArr[i+1]?histArr[i+1].html:histArr[0].html); // i는 unshift 이후 +1
  $('#figModal').classList.remove('open');
  commit(); toast('해당 버전으로 복원했습니다. 파일에 반영하려면 [저장]을 누르세요.');
}
/* 파일 핸들 영속화 (IndexedDB). '저장'은 대화상자 없이 같은 파일 덮어쓰기 */
function idbStore(mode,fn){
  try{
    var req=indexedDB.open('fig-editor',1);
    req.onupgradeneeded=function(){ req.result.createObjectStore('handles'); };
    req.onsuccess=function(){
      try{ fn(req.result.transaction('handles',mode).objectStore('handles')); }catch(e){}
    };
  }catch(e){}
}
function handleKey(){ return 'fig:handle:'+(body.dataset.figDoc||'__unsaved__'); }
function storeHandle(h){ if(h) idbStore('readwrite',function(st){ st.put(h,handleKey()); }); }
function loadHandle(cb){
  var done=false;
  idbStore('readonly',function(st){
    var g=st.get(handleKey());
    g.onsuccess=function(){ done=true; cb(g.result||null); };
    g.onerror=function(){ done=true; cb(null); };
  });
  setTimeout(function(){ if(!done) cb(null); },1500);
}

/* 자동저장 */
function genDocId(){ return 'fg-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8); }
/* 아직 저장 전인 문서: 열 때마다 id가 바뀌면 자동저장본을 못 찾으므로 파일 경로 해시로 고정한다(첫 저장 때 고유 id로 교체됨) */
function defaultDocId(){
  var p=location.pathname||'';
  if(!p||p==='/') return genDocId();
  var h=0; for(var i=0;i<p.length;i++){ h=(h*31+p.charCodeAt(i))|0; }
  return 'fg-path-'+(h>>>0).toString(36);
}
function autosaveKey(){ return 'fig:autosave:'+(body.dataset.figDoc||'__unsaved__'); }
function rotateDocId(){ try{ localStorage.removeItem(autosaveKey()); }catch(e){} body.dataset.figDoc=genDocId(); }
function scheduleAutosave(){ clearTimeout(autosaveTimer); autosaveTimer=setTimeout(doAutosave,700); }
function doAutosave(){ try{ localStorage.setItem(autosaveKey(),JSON.stringify({ts:new Date().toISOString(),html:cleanBodyHTML()})); }catch(e){} }
function checkAutosave(){
  try{
    var raw=localStorage.getItem(autosaveKey()); if(!raw) return;
    var a=JSON.parse(raw);
    if(a&&a.html&&a.html!==cleanBodyHTML()){
      var bn=$('#figBanner');
      $('.msg',bn).innerHTML='<b>자동저장본</b>('+fmtTs(a.ts)+')이 있습니다. 복구하시겠어요?';
      bn.classList.add('show');
      $('#figRbRestore').onclick=function(){ restoreBody(a.html); bn.classList.remove('show'); commit(); toast('자동저장본을 복구했습니다.'); };
      $('#figRbIgnore').onclick=function(){ bn.classList.remove('show'); };
    }
  }catch(e){}
}

/* ================================================================
   키보드
   ================================================================ */
document.addEventListener('keydown',function(e){
  var mod=e.metaKey||e.ctrlKey;
  if(mod&&!e.shiftKey&&(e.key==='s'||e.key==='S')){ e.preventDefault(); saveToFile(false); return; }
  if(mod&&(e.key==='e'||e.key==='E')){ e.preventDefault(); setEdit(!editing); return; }
  if(!editing) return;
  if(labelEditing){   /* 화살표 라벨 인라인 편집: Enter 확정, Esc 취소 */
    if(e.key==='Enter'){ e.preventDefault(); finishLabelEdit(); }
    else if(e.key==='Escape'){ e.preventDefault(); finishLabelEdit(true); }
    return;
  }
  if(texting){ if(e.key==='Escape'){ e.preventDefault(); stopTextEdit(); } return; }
  /* 폼 입력(속성 패널의 라벨·색·크기 등)이나 라벨 직접편집 중에는 캔버스 단축키를 실행하지 않는다
     Backspace로 라벨 글자를 지우려다 화살표가 삭제되는 문제 방지 */
  var kt=e.target;
  if(kt&&(kt.tagName==='INPUT'||kt.tagName==='TEXTAREA'||kt.tagName==='SELECT'||kt.isContentEditable)) return;
  if(mod&&(e.key==='z'||e.key==='Z')){ e.preventDefault(); e.shiftKey?redo():undo(); return; }
  if(mod&&(e.key==='d'||e.key==='D')){ e.preventDefault(); duplicateSel(); return; }
  if(mod&&(e.key==='c'||e.key==='C')){
    var selC=window.getSelection();
    if(selC&&!selC.isCollapsed) return;      /* 일반 텍스트 복사는 방해하지 않는다 */
    if(selection.length){ e.preventDefault(); copySelection(false); }
    return;
  }
  if(mod&&(e.key==='x'||e.key==='X')){
    var selX=window.getSelection();
    if(selX&&!selX.isCollapsed) return;
    if(selection.length){ e.preventDefault(); copySelection(true); }
    return;
  }
  if(mod&&(e.key==='v'||e.key==='V')){
    /* 숨은 텍스트영역에 포커스 → 브라우저가 paste 이벤트를 반드시 발화
       (preventDefault 하지 않는다. 네이티브 붙여넣기를 그쪽으로 유도) */
    var ta=clipTextarea(); ta.value=''; ta.focus();
    setTimeout(function(){ if(document.activeElement===ta){ ta.value=''; ta.blur(); } },500);
    return;
  }
  if(e.key==='Escape'){ clearSelection(); return; }
  if((e.key==='Delete'||e.key==='Backspace')&&selection.length){ e.preventDefault(); deleteSel(); return; }
  if(/^Arrow/.test(e.key)&&selection.length){
    e.preventDefault();
    var d=e.shiftKey?10:1;
    var dx=(e.key==='ArrowLeft'?-d:e.key==='ArrowRight'?d:0);
    var dy=(e.key==='ArrowUp'?-d:e.key==='ArrowDown'?d:0);
    selNodes().forEach(function(n){
      n.style.left=(n.offsetLeft+dx)+'px'; n.style.top=(n.offsetTop+dy)+'px';
    });
    selEdges().forEach(function(ed){
      ['from','to'].forEach(function(k){
        if(isPointVal(ed.dataset[k])){ var pt=parsePoint(ed.dataset[k]); ed.dataset[k]=(pt.x+dx)+','+(pt.y+dy); }
      });
    });
    renderSoon(); refreshHandles(); scheduleCommit();
  }
});
/* 편집 중 이미지 네이티브 드래그 방지 */
document.addEventListener('dragstart',function(e){ if(editing) e.preventDefault(); });

/* ================================================================
   초기화
   ================================================================ */
function init(){
  $$('#fig-static-css,#fig-static-js').forEach(function(el){ el.remove(); });   /* 배포본에 엔진을 다시 넣은 경우 뷰어 잔재 제거 */
  if(!body.dataset.figDoc) body.dataset.figDoc=defaultDocId();
  bodyScripts=$$('body script').filter(function(s){ return s.id!=='fig-history'; });
  histArr=loadHistory();
  mountUI();
  initCanvases();
  renderAll();
  lastSavedHtml=cleanBodyHTML();
  checkAutosave();
  loadHandle(function(h){ if(h&&!fileHandle) fileHandle=h; });  /* 지난 세션의 파일 위치 복원 */
}
if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',init);
else init();

/* 외부 연동 API (덱 런타임·검증 스크립트용) */
window.FigEditor={
  setEdit:setEdit,
  isEditing:function(){ return editing; },
  serialize:serialize,
  clean:cleanBodyHTML,
  commit:commit,
  renderAll:renderAll,
  fitAll:fitAll,
  addNode:addNode,
  addEdge:addEdgeNew,
  save:saveToFile,
  selection:function(){ return selection.slice(); },
  select:function(el){ if(el) select(el,false); },
  clearSelection:clearSelection,
  history:function(){ return histArr.slice(); },
  exportStatic:exportStatic,
  saveStatic:saveStaticToFile,
  toast:toast,
  onClean:function(fn){ if(typeof fn==='function') cleaners.push(fn); }
};
})();
