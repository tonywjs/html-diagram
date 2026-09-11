#!/usr/bin/env python3
"""각 모델 폴더의 poster.html 정적 검사 → static.json"""
import pathlib,re,json
base=pathlib.Path.home()/'html-diagram-compare'; sk=pathlib.Path.home()/'.claude/skills/html-diagram/assets'
css=(sk/'fig-editor.css').read_text(encoding='utf-8'); js=(sk/'fig-editor.js').read_text(encoding='utf-8')
emoji=re.compile('[\U0001F300-\U0001FAFF☀-➿]')
def attr(e,k):
    m=re.search(r'data-'+k+r'="([^"]*)"',e); return m.group(1) if m else None
pt=r'^-?[\d.]+\s*,\s*-?[\d.]+$'
out={}
for d in sorted(base.iterdir()):
    f=d/'poster.html'
    if not d.is_dir() or not f.exists(): continue
    t=f.read_text(encoding='utf-8')
    tm=re.search(r'<title>(.*?)</title>',t,re.S)
    r={'bytes':len(t.encode('utf-8')),'engine_css_ok':css in t,'engine_js_ok':js in t,'title':tm.group(1).strip() if tm else None}
    c=t.replace(css,'').replace(js,'')
    r['dashes']=len(re.findall('[—–]',c)); r['emoji']=len(emoji.findall(c))
    nodes=re.findall(r'<div[^>]*class="[^"]*\bfig-node\b[^"]*"[^>]*>',c)
    ids=[m.group(1) for n in nodes for m in [re.search(r'\bid="([^"]+)"',n)] if m]
    r['nodes']=len(nodes); r['nodes_without_id']=len(nodes)-len(ids); r['dup_ids']=len(ids)-len(set(ids))
    r['nodes_missing_inline_pos']=sum(1 for n in nodes if not all(re.search(r'style="[^"]*\b'+k+r'\s*:',n) for k in ('left','top','width')))
    edges=re.findall(r'<div[^>]*class="[^"]*\bfig-edge\b[^"]*"[^>]*>',c)
    r['edges']=len(edges); allids=set(ids)
    r['edges_bad_ref']=sum(1 for e in edges for k in ('from','to') if (attr(e,k) is None) or (not re.match(pt,attr(e,k)) and attr(e,k) not in allids))
    r['canvases']=len(re.findall(r'class="[^"]*\bfig-canvas\b',c))
    side=('top','bottom','left','right')
    r['edge_features']={'solid':sum(1 for e in edges if attr(e,'style') in (None,'solid')),'styles':sorted(set(filter(None,[attr(e,'style') for e in edges]))),'arrows':sorted(set(filter(None,[attr(e,'arrow') for e in edges]))),
      'curve':sum(1 for e in edges if attr(e,'curve') not in (None,'0','0.0')),'opacity':sum(1 for e in edges if attr(e,'opacity')),'flow':sum(1 for e in edges if attr(e,'flow')),
      'label':sum(1 for e in edges if attr(e,'label')),'side_anchor':sum(1 for e in edges if (attr(e,'anchor-from') in side) or (attr(e,'anchor-to') in side)),
      'ratio_anchor':sum(1 for e in edges if re.match(r'^[\d.]+\s*,\s*[\d.]+$',attr(e,'anchor-from') or '') or re.match(r'^[\d.]+\s*,\s*[\d.]+$',attr(e,'anchor-to') or '')),
      'coord_end':sum(1 for e in edges if re.match(pt,attr(e,'from') or '') or re.match(pt,attr(e,'to') or ''))}
    r['text_features']={'table':c.count('<table'),'list':c.count('<ul')+c.count('<ol'),'blockquote':c.count('<blockquote'),
      'bold':len(re.findall(r'<(b|strong)\b',c)),'italic':len(re.findall(r'<(i|em)\b',c)),'underline':len(re.findall(r'<u[ >]',c)),'strike':len(re.findall(r'<(s|del|strike)[ >]',c)),
      'svg_icons':c.count('<svg'),'round_nodes':len(re.findall(r'border-radius\s*:\s*(50%|999px|9999px)',c))}
    out[d.name]=r
(base/'static.json').write_text(json.dumps(out,ensure_ascii=False,indent=1),encoding='utf-8')
print(json.dumps({k:{'bytes':v['bytes'],'nodes':v['nodes'],'edges':v['edges'],'canvases':v['canvases'],'engine':v['engine_css_ok'] and v['engine_js_ok'],'bad_ref':v['edges_bad_ref'],'dashes':v['dashes'],'emoji':v['emoji'],'title':v['title']} for k,v in out.items()},ensure_ascii=False,indent=1))
