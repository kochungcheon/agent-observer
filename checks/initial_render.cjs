// DOM contract checks only; this does not replace rendered-browser verification.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '../internal/webui/index.html'), 'utf8');
const frames = [], scrolls = [], dom = new Map();
function element() {
  return {
    htmlWrites:0, get innerHTML(){return this._innerHTML||'';},set innerHTML(value){this._innerHTML=value;this.htmlWrites++;},
    addEventListener() {}, style: {}, dataset: {}, hidden: false, className: '',
    classList: {toggle() {}}, attributes: {}, setAttribute(k,v) {this.attributes[k]=v;}, append() {}, remove() {},
    clientWidth: 640, clientHeight: 240, scrollTop: 0, scrollLeft: 0,
    get offsetTop() {return parseFloat(this.style.cssText?.match(/top:([\d.]+)/)?.[1] || 0);},
    get offsetLeft() {return parseFloat(this.style.cssText?.match(/left:([\d.]+)/)?.[1] || 0);},
    get offsetHeight() {return 116;}, get offsetWidth() {return 280;},
    scrollTo(options) {scrolls.push(options); this.scrollTop = options.top; this.scrollLeft = options.left;},
  };
}
const context = vm.createContext({
  document: {querySelector(id) {if (!dom.has(id)) dom.set(id, element()); return dom.get(id);}, createElement: element},
  requestAnimationFrame(fn) {frames.push(fn);}, matchMedia() {return {matches: false};},
  EventSource: class {addEventListener() {} close() {}},
  ResizeObserver: class {observe() {}},
  // Leave polling pending: these fixtures exercise render, not network behavior.
  fetch() {return new Promise(() => {});}, AbortSignal, setTimeout,
});
vm.runInContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], context);
function render(turn, count) {
  context.snapshot = {turn, nodes: Array.from({length: count}, (_, i) => ({
    id: `${turn}-${i}`, kind: i ? 'tool' : 'agent', label: `Task ${i}`,
    parent: i ? `${turn}-${i-1}` : null, status: '완료',
  }))};
  vm.runInContext('render(snapshot)', context);
}
const classes = () => vm.runInContext('[...elements.values()].map(el=>el.className).join("|")', context);
const flush = () => {while (frames.length) frames.shift()();};
render('first', 0);
vm.runInContext("expandedGroups.add('first-0')",context);
render('first', 8);
assert(!classes().includes('new'), 'First nonempty snapshot must not fade cards');
assert(dom.get('#edges').innerHTML.includes('<path'), 'Connections exist with cards');
assert.equal(frames.length, 0, 'Initial positioning must happen before paint');
assert.equal(scrolls.at(-1).behavior, 'instant');
render('first', 9);
assert(classes().includes('new'), 'Live additions retain entrance effect');
flush();
assert.equal(scrolls.at(-1).behavior, 'smooth');
const before = scrolls.length;
render('first', 9);
flush();
assert.equal(scrolls.length, before, 'Status-only updates must not scroll');
render('second', 8);
assert(!classes().includes('new'), 'New turn starts with a stable snapshot');
assert.equal(scrolls.at(-1).behavior, 'instant');
vm.runInContext('setFollowing(false)', context);
render('second', 9);
flush();
assert.equal(scrolls.at(-1).behavior, 'instant', 'Follow-off must suppress live scrolling');
console.log('PASS: initial/empty snapshot, edges, live addition, status update, turn reset, follow-off');
context.snapshot = {turn: 'labels', nodes: [
  {id: 'agent', kind: 'agent', label: '메인'},
  {id: 'subagent:/root/ux', kind: 'subagent', agentPath: '/root/ux', label: 'ux', parent: 'agent'},
  {id: 'subagent:/root/dx/ux', kind: 'subagent', agentPath: '/root/dx/ux', label: 'ux', parent: 'agent'},
  {id: 'tool', kind: 'tool', label: '파일 읽기', ownerAgent: 'subagent:/root/ux', parent: 'subagent:/root/ux', childActivity: true},
  {id: 'skill', kind: 'skill', label: '스킬', parent: 'tool'},
  {id: 'a2a', kind: 'a2a', source: 'subagent:/root/ux', target: 'subagent:/root/dx/ux', parent: 'agent'},
  {id: 'unknown', kind: 'new-kind', label: 'undefined', status: 'undefined'},
]};
vm.runInContext('render(snapshot)', context);
vm.runInContext("expandedGroups.add('subagent:/root/ux');layout()",context);
const card = id => vm.runInContext(`elements.get(${JSON.stringify(id)}).innerHTML`, context);
assert(card('subagent:/root/ux').includes('<b>ux</b>'));
assert(card('subagent:/root/dx/ux').includes('<b>dx/ux</b>'));
assert(card('tool').includes('도구 · ux 소속'));
assert(card('skill').includes('스킬 · ux 소속'));
assert(vm.runInContext('[...messageElements.values()].some(el=>el.textContent.includes("ux → dx/ux"))',context));
assert(card('unknown').includes('기타 이벤트'));
for (const node of context.snapshot.nodes) {
  if(node.kind!=='a2a')assert(!card(node.id).includes('undefined'));
  context.chosenId = node.id;
  vm.runInContext('selected=chosenId;inspect()', context);
  assert(!dom.get('#detail').innerHTML.includes('undefined'));
}
console.log('PASS: agent identity, nested names, tool/skill ownership, A2A, missing labels in cards and inspector');
context.snapshot.nodes.push({id:'reply',kind:'a2a',source:'subagent:/root/dx/ux',target:'subagent:/root/ux'});
context.snapshot.nodes.push({id:'second-message',kind:'a2a',source:'subagent:/root/ux',target:'subagent:/root/dx/ux'});
vm.runInContext("expandedGroups.add('agent');expandedGroups.add('subagent:/root/ux');expandedGroups.add('subagent:/root/dx/ux')",context);
for(const width of [640,1200]) {
  dom.get('#canvas').clientWidth=width;
  vm.runInContext('render(snapshot)',context);
  const plan=vm.runInContext('positionsFor(visibleNodes())',context);
  for(const node of context.snapshot.nodes.filter(n=>n.kind!=='a2a')){
    const p=plan.pos.get(node.id);
    context.testNode=node;
    const owner=vm.runInContext('ownerId(testNode,data.nodes)',context);
    const g=plan.groups.get(owner);
    assert(p.x>=g.x&&p.x+p.w<=g.x+g.w&&p.y>=g.y&&p.y+p.h<=g.y+g.h, node.id+' stays inside owner group');
  }
  const ux=plan.groups.get('subagent:/root/ux'),dx=plan.groups.get('subagent:/root/dx/ux');
  assert(width===640?dx.y>=ux.y+ux.h:dx.x>=ux.x+ux.w,'Groups do not overlap');
  assert(!vm.runInContext('elements.has("a2a")',context),'Messages have no hidden duplicate cards');
  assert.equal(vm.runInContext('messageElements.size',context),2,'Two directed connections');
  assert(vm.runInContext('[...messageElements.values()].some(el=>el.textContent.endsWith("2건"))',context),'Messages aggregate by direction');
  vm.runInContext('[...messageElements.values()][0].onclick()',context);
  assert(dom.get('#detail').innerHTML.includes('주고받은 메시지 3건'));
}
// Collapse affects only contents; messages and recent work remain available.
vm.runInContext("toggleGroup('subagent:/root/ux')",context);
assert(vm.runInContext("!elements.has('tool')&&!elements.has('skill')",context));
assert.equal(vm.runInContext('messageElements.size',context),2);
assert(card('subagent:/root/ux').includes('최근 작업'));
assert.equal(vm.runInContext("elements.get('subagent:/root/ux').attributes['aria-expanded']",context),'false');
const collapsedHeight=vm.runInContext("positionsFor(visibleNodes()).groups.get('subagent:/root/ux').h",context);
context.snapshot.nodes.push({id:'new-tool',kind:'tool',label:'새 작업',at:'2026-10-15T12:00:00Z',ownerAgent:'subagent:/root/ux',parent:'subagent:/root/ux'});
vm.runInContext('render(snapshot)',context);
assert(vm.runInContext("!elements.has('new-tool')",context),'Live events must not expand group');
assert(card('subagent:/root/ux').includes('새 작업'),'Collapsed summary updates');
vm.runInContext("elements.get('subagent:/root/ux').onclick()",context);
assert(!vm.runInContext("elements.get('new-tool').hidden||elements.get('skill').hidden",context));
assert(vm.runInContext("positionsFor(visibleNodes()).groups.get('subagent:/root/ux').h",context)>collapsedHeight);
assert.equal(vm.runInContext('messageElements.size',context),2);
vm.runInContext('render(snapshot)',context);
assert(!vm.runInContext("elements.get('tool').hidden",context),'Expanded state survives polling');
render('empty-turn',0);
assert.equal(vm.runInContext('expandedGroups.size',context),0,'New turn defaults collapsed');
render('default-collapse',4);
assert(vm.runInContext("!elements.has('default-collapse-1')",context));
render('empty-turn',0);
console.log('PASS: default collapse, toggle, live summary, persistent expansion, messages retained');
assert.equal(vm.runInContext('groupElements.size+messageElements.size',context),0,'Remove old groups and connections');
console.log('PASS: narrow/wide group containment, non-overlap, message aggregation, selection, turn cleanup');
context.snapshot={turn:'request-start',nodes:[{id:'request',kind:'request',label:'사용자 요청'}]};
vm.runInContext('render(snapshot)',context);
assert.equal(vm.runInContext('groupElements.size',context),0,'A request alone is not an unassigned group');
assert(!vm.runInContext("elements.get('request').hidden",context));
context.snapshot.nodes.push({id:'agent',kind:'agent',label:'메인 에이전트',parent:'request'});
vm.runInContext('render(snapshot)',context);
const requestPlan=vm.runInContext('positionsFor(visibleNodes())',context);
assert.equal(requestPlan.groups.size,1);
assert(!requestPlan.groups.has('unassigned'));
assert(requestPlan.pos.get('request').y+requestPlan.pos.get('request').h<requestPlan.groups.get('agent').y);
assert.equal(requestPlan.groups.get('agent').members.length,0);
console.log('PASS: user request is a standalone start node above agent groups');
context.snapshot.nodes.push({id:'ux',kind:'subagent',label:'UX',parent:'agent'},{id:'dx',kind:'subagent',label:'DX',parent:'agent'},{id:'msg',kind:'a2a',source:'ux',target:'dx'});
for(const width of [640,1200]){
 dom.get('#canvas').clientWidth=width;
 vm.runInContext('render(snapshot)',context);
 const flow=vm.runInContext('positionsFor(visibleNodes())',context);
 const main=flow.groups.get('agent');
 for(const id of ['ux','dx'])assert(main.y+main.h<flow.groups.get(id).y);
 assert.equal((dom.get('#edges').innerHTML.match(/class="hierarchy-edge"/g)||[]).length,3);
 assert(dom.get('#edges').innerHTML.includes('class="message-edge"'));
 vm.runInContext("toggleGroup('ux')",context);
 assert.equal((dom.get('#edges').innerHTML.match(/class="hierarchy-edge"/g)||[]).length,3);
}
console.log('PASS: request → coordinator → delegates ordering and hierarchy/message paths coexist');
// A tall viewport must not stretch/center the SVG after groups collapse.
dom.get('#canvas').clientHeight=1600;
vm.runInContext('layout()',context);
const edgeBox=dom.get('#edges').attributes.viewBox.split(' ').map(Number);
assert.equal(parseFloat(dom.get('#edges').style.width),edgeBox[2]);
assert.equal(parseFloat(dom.get('#edges').style.height),edgeBox[3]);
assert(edgeBox[3]<1600,'Exercise min-height larger than content');
const onBoundary=(p,g)=>p.y>=g.y&&p.y<=g.y+g.h&&(p.x===g.x||p.x===g.x+g.w);
for(const width of [640,1200])for(const aHeight of [196,900])for(const bHeight of [196,700]){
 context.a={id:'a',x:24,y:20,w:320,h:aHeight};
 context.b={id:'b',x:width===640?24:544,y:width===640?20+aHeight+48:20,w:320,h:bHeight};
 for(const reverse of [false,true]){
  context.reverse=reverse;
  const route=vm.runInContext('messageRoute(a,b,reverse)',context);
  assert(onBoundary(route.start,context.a));assert(onBoundary(route.end,context.b));
  const back=vm.runInContext('messageRoute(b,a,reverse)',context);
  assert(onBoundary(back.start,context.b));assert(onBoundary(back.end,context.a));
 }
}
console.log('PASS: SVG CSS-pixel alignment in tall viewport and boundary anchors with unequal expanded/collapsed groups');

context.messageFixture={id:'safe',kind:'a2a',source:'agent',target:'subagent:/root/ux',body:'<img src=x onerror=alert(1)>\n다음 줄',at:'2026-10-15T01:00:00Z',status:'송신 호출 관측'};
vm.runInContext('data.nodes.push(messageFixture);selected="safe";inspect()',context);
assert(dom.get('#detail').innerHTML.includes('&lt;img'));
assert(!dom.get('#detail').innerHTML.includes('<img'));
assert(dom.get('#detail').innerHTML.includes('다음 줄'));
console.log('PASS: conversation body is readable text, never executable markup');

// Session switches reset selections/expansion even when turn ids collide.
context.snapshot={sessionId:'session-a',turn:'same',revision:1,nodes:[{id:'agent',kind:'agent',label:'A'}]};
vm.runInContext("render(snapshot);expandedGroups.add('agent');selected='agent'",context);
context.snapshot={sessionId:'session-b',turn:'same',revision:1,nodes:[{id:'agent',kind:'agent',label:'B'}]};
vm.runInContext('render(snapshot)',context);
assert.equal(vm.runInContext('expandedGroups.size',context),0);
assert(dom.get('#detail').innerHTML.includes('B'));
vm.runInContext("selectSession('session-a')",context);
assert.equal(vm.runInContext('data.nodes.length',context),0,'No old graph while switching');
assert.equal(vm.runInContext('revision',context),-1);
console.log('PASS: multi-session selection clears stale graph and expansion across identical turn ids');
context.catalogFixture=[{sessionId:'alpha',label:'Project A',registered:false},{sessionId:'beta',label:'Project B',registered:true}];
vm.runInContext('showOverview();updateSessions(catalogFixture)',context);
assert.equal(dom.get('#overview').hidden,false);
assert.equal(dom.get('#flow-view').hidden,true);
assert.equal(vm.runInContext('activeSession',context),'');
assert(dom.get('#session-grid').innerHTML.includes('?session=alpha'));
assert(dom.get('#session-grid').innerHTML.includes('?session=beta'));
dom.get('#session-search').value='Project B';
vm.runInContext('renderSessionCards()',context);
assert(!dom.get('#session-grid').innerHTML.includes('?session=alpha'));
assert(dom.get('#session-grid').innerHTML.includes('?session=beta'));
vm.runInContext("selectSession('beta')",context);
assert.equal(dom.get('#overview').hidden,true);
assert.equal(dom.get('#flow-view').hidden,false);
console.log('PASS: catalog landing, session links, search, and back-to-list navigation');

// One visible tool update must preserve all other cards and all unchanged edges.
context.snapshot={sessionId:'incremental',turn:'incremental',nodes:[
 {id:'agent',kind:'agent',label:'Main'},
 {id:'a',kind:'tool',label:'A',parent:'agent',status:'running'},
 {id:'b',kind:'tool',label:'B',parent:'agent',status:'running'}]};
vm.runInContext("render(snapshot);toggleGroup('agent')",context);
const stableCard=vm.runInContext("elements.get('b')",context);
const cardWrites=stableCard.htmlWrites,edgeWrites=dom.get('#edges').htmlWrites,detailWrites=dom.get('#detail').htmlWrites;
vm.runInContext('render(JSON.parse(JSON.stringify(snapshot)),false)',context);
assert.equal(stableCard.htmlWrites,cardWrites,'Identical JSON response does not rewrite card');
assert.equal(dom.get('#edges').htmlWrites,edgeWrites,'Unchanged edges retain DOM');
assert.equal(dom.get('#detail').htmlWrites,detailWrites,'Unchanged inspector retains DOM');
const changed=vm.runInContext("elements.get('a')",context);const oldWrites=changed.htmlWrites;
context.snapshot.nodes[1].status='completed';
vm.runInContext('render(snapshot,false)',context);
assert.equal(changed.htmlWrites,oldWrites+1,'Only updated tool content is replaced');
assert.equal(stableCard.htmlWrites,cardWrites,'Unrelated tool not rewritten');
vm.runInContext("toggleGroup('agent')",context);
assert.equal(vm.runInContext('elements.size',context),1,'Collapsed children removed, not hidden');
context.snapshot.nodes[1].label='A changed while collapsed';
vm.runInContext('render(snapshot,false);toggleGroup("agent")',context);
assert(card('a').includes('A changed while collapsed'));
context.snapshot.nodes.splice(1,1);
vm.runInContext('render(snapshot,false)',context);
assert(!vm.runInContext("elements.has('a')",context),'Deleted node removed');
console.log('PASS: absent collapsed DOM, no-op JSON, targeted updates, deletion and fresh expansion');
vm.runInContext("toggleGroup('agent');selected='b';setFollowing(true)",context);
dom.get('#viewport').scrollTop=10000;
const beforeHiddenFollow=scrolls.length;
vm.runInContext("followNode('b',true)",context);
assert.equal(scrolls.length,beforeHiddenFollow+1,'Absent child follows its visible owner header');
assert(!vm.runInContext("elements.has('b')",context),'Following does not materialize collapsed child');
vm.runInContext("setFollowing(false)",context);
console.log('PASS: automatic following anchors to collapsed owner without hidden child DOM');
// Network lifecycle fixtures: stale streams cannot update a new selection;
// paused streams keep receiving and resume without waiting for another event.
context.streams=[];
vm.runInContext(`EventSource=class {constructor(url){this.url=url;this.listeners={};streams.push(this);}addEventListener(k,fn){this.listeners[k]=fn;}close(){this.closed=true;}};
activeSession='a';startEventStream('a',connectionGeneration);`,context);
const streamA=context.streams.at(-1);
const emit=(stream,session,revision,label)=>stream.listeners.state({data:JSON.stringify({sessionId:session,revision,turn:'sse',nodes:[{id:'agent',kind:'agent',label}]})});
emit(streamA,'a',1,'A');
vm.runInContext("activeSession='b';connectionGeneration++;eventStream.close();startEventStream('b',connectionGeneration)",context);
const streamB=context.streams.at(-1);
emit(streamB,'b',1,'B');emit(streamA,'a',99,'STALE');
assert.equal(vm.runInContext('data.sessionId',context),'b');
vm.runInContext('paused=true',context);emit(streamB,'b',2,'Paused update');
assert.equal(vm.runInContext('data.nodes[0].label',context),'B');
dom.get('#pause').onclick({target:dom.get('#pause')});
assert.equal(vm.runInContext('data.nodes[0].label',context),'Paused update');
assert(streamA.closed);
console.log('PASS: SSE session generation, stale events ignored, pause buffers latest and resume renders immediately');

// Transport patches preserve unchanged objects, exact ordering, and paused state.
vm.runInContext(`{
 const a={id:'a'}, b={id:'b'};
 const initial={sessionId:'s',turn:'t',sequence:1,nodes:[a,b]};
 const patch={sessionId:'s',baseSequence:1,sequence:2,metadata:{sessionId:'s',turn:'t',revision:2},upsert:[{id:'c'}],removed:[]};
 const merged=mergeStreamDelta(initial,patch,'s');
 if(merged.nodes[0]!==a||merged.nodes.map(n=>n.id).join(',')!=='a,b,c')throw Error('append delta');
 const ordered=mergeStreamDelta(merged,{...patch,baseSequence:2,sequence:3,upsert:[{id:'a',label:'changed'}],removed:['b'],order:['c','a']},'s');
 if(ordered.nodes.map(n=>n.id).join(',')!=='c,a'||ordered.nodes[1].label!=='changed')throw Error('delete/reorder delta');
 for(const bad of [{...patch,baseSequence:0},{...patch,sessionId:'other'},{...patch,order:['missing']}]){
  let rejected=false;try{mergeStreamDelta(initial,bad,'s')}catch(e){rejected=true}if(!rejected)throw Error('invalid delta accepted');
 }
}`,context);
console.log('Delta merge: append, update, deletion, order, identity and baseline guards passed');
streamB.listeners.state({data:JSON.stringify({sessionId:'b',revision:3,turn:'sse',sequence:1,nodes:[{id:'agent',kind:'agent',label:'Before delta'}]})});
vm.runInContext('paused=true',context);
for(let seq=2;seq<=3;seq++)streamB.listeners.delta({data:JSON.stringify({sessionId:'b',baseSequence:seq-1,sequence:seq,metadata:{sessionId:'b',turn:'sse',revision:seq+2},removed:[],upsert:[{id:'agent',kind:'agent',label:'Delta '+seq}]})});
assert.equal(vm.runInContext('data.nodes[0].label',context),'Before delta');
dom.get('#pause').onclick({target:dom.get('#pause')});
assert.equal(vm.runInContext('data.nodes[0].label',context),'Delta 3');
streamB.listeners.delta({data:JSON.stringify({sessionId:'b',baseSequence:1,sequence:2,metadata:{sessionId:'b',turn:'sse'},upsert:[],removed:[]})});
assert(streamB.closed,'Sequence gap reconnects instead of corrupting state');
console.log('PASS: consecutive paused deltas, immediate resume and sequence-gap reconnect');
context.large={sessionId:'virtual',turn:'virtual',nodes:[{id:'agent',kind:'agent',label:'Main'}, {id:'sub',kind:'subagent',parent:'agent',label:'UX'},...Array.from({length:10000},(_,i)=>({id:'v'+i,kind:i%2?'skill':'tool',label:'Node '+i,parent:i%2?'v'+(i-1):'agent'})),{id:'msg',kind:'a2a',source:'agent',target:'sub',label:'Message'}]};
dom.get('#viewport').scrollTop=0;
vm.runInContext("render(large,false);toggleGroup('agent')",context);
assert(vm.runInContext('elements.size',context)<30);
const virtualHeight=vm.runInContext('graphGeometry().height',context);
const messagePath=dom.get('#edges').innerHTML.match(/class="message-edge"[^>]*d="([^"]+)"/);
vm.runInContext("document.querySelector('#viewport').scrollTop=graphGeometry().pos.get('v5001').y;layout()",context);
assert(vm.runInContext("elements.has('v5001')",context));
assert(!vm.runInContext("elements.has('v0')",context));
assert(dom.get('#edges').innerHTML.includes('data-target="v5001"'));
assert(vm.runInContext('elements.size',context)<30);
assert.equal(vm.runInContext('graphGeometry().height',context),virtualHeight);
assert.equal(vm.runInContext('messageElements.size',context),1,'Messages survive viewport changes');
vm.runInContext("selected='v9999';setFollowing(true);followNode('v9999',true);layout()",context);
assert(vm.runInContext("elements.has('v9999')",context),'Follow reaches unmounted target');
vm.runInContext("toggleGroup('agent')",context);
assert.equal(vm.runInContext('messageElements.size',context),1);
console.log('PASS: 10k viewport card bound, middle/end scrolling, skill edges, message retention, logical follow');
// Mailbox messages share the conversation view, with explicit provenance and Ack semantics.
context.mailboxGraph={sessionId:'mailbox',turn:'mailbox',nodes:[
 {id:'agent',kind:'agent',label:'Main'},
 {id:'ux',kind:'subagent',parent:'agent',label:'UX'},
 {id:'dx',kind:'subagent',parent:'agent',label:'DX'},
 {id:'mailbox-one',kind:'a2a',source:'ux',target:'dx',bodySource:'observer-mailbox',body:'첫 줄\n<검증>',status:'전달 수락 · 수신 확인 대기',at:'2026-10-16T00:00:00Z'},
 {id:'mailbox-two',kind:'a2a',source:'dx',target:'ux',bodySource:'observer-mailbox',body:'확인했습니다',status:'수신 확인',ackedAt:'2026-10-16T00:00:02Z',at:'2026-10-16T00:00:01Z'}
]};
vm.runInContext("render(mailboxGraph,false);selected='mailbox-one';inspect()",context);
assert(dom.get('#detail').innerHTML.includes('Observer 메시지함'));
assert(dom.get('#detail').innerHTML.includes('첫 줄\n&lt;검증&gt;'));
assert(dom.get('#detail').innerHTML.includes('확인했습니다'));
assert(dom.get('#detail').innerHTML.includes('명시적인 Ack'));
vm.runInContext("toggleGroup('ux');toggleGroup('dx');toggleGroup('ux');toggleGroup('dx')",context);
assert.equal(vm.runInContext('messageElements.size',context),2);
assert.equal(vm.runInContext("conversationBody({bodyUnavailable:'expired'})",context),'수신 확인 후 보관 기간이 지나 본문이 삭제되었습니다.');
console.log('PASS: mailbox provenance, escaped two-way bodies, Ack explanation and collapsed message edges');

// Native messages can lack plaintext; never imply a failed hook or glue a missing origin to status.
context.nativeMessage={id:'a2a:/root/ux:native-call',kind:'a2a',source:'ux',target:'dx',body:null,bodyUnavailable:'encrypted',status:'호출 반환 관측',at:'2026-10-16T00:00:03Z'};
vm.runInContext("render({...mailboxGraph,nodes:[...mailboxGraph.nodes,nativeMessage]},false);selected=nativeMessage.id;inspect()",context);
assert(dom.get('#detail').innerHTML.includes('Codex 기본 메시지 · 본문 미제공 · 호출 반환 관측'));
assert(dom.get('#detail').innerHTML.includes('본문 2건 · 본문 없음 1건'));
assert(!dom.get('#detail').innerHTML.includes('미수집호출'));
assert(!dom.get('#detail').innerHTML.includes('훅에서 수집한 본문이 연결되지'));
assert.equal(vm.runInContext("messageStatus({id:'unknown',status:'<상태>'})",context),'수집 경로 미확인 · 본문 미제공 · <상태>');
vm.runInContext("render({...mailboxGraph,nodes:[...mailboxGraph.nodes,{...nativeMessage,id:'unknown',bodySource:'sender-local',body:'<정확한 원문>',status:'<상태>'}]},false);selected='unknown';inspect()",context);
assert(dom.get('#detail').innerHTML.includes('송신자 제공 · 로컬 수집 · &lt;상태&gt;'));
assert(dom.get('#detail').innerHTML.includes('&lt;정확한 원문&gt;'));
assert(!dom.get('#detail').innerHTML.includes('본문 없음 1건'));
console.log('PASS: unavailable native body, honest provenance, joined status and escaped sender body');

// Finishing harness bookkeeping must not erase the task shown on a collapsed group.
context.workGraph={sessionId:'work-summary',turn:'work-summary',nodes:[
 {id:'agent',kind:'agent',label:'Main'},
 {id:'ux-work',kind:'subagent',parent:'agent',label:'UX'},
 {id:'dx-work',kind:'subagent',parent:'agent',label:'DX'},
 {id:'ux-review',kind:'tool',parent:'ux-work',toolName:'cat',label:'메시지 문서 검토',at:'2026-10-16T01:00:00Z'},
 {id:'dx-test',kind:'tool',parent:'dx-work',toolName:'go',label:'SSE 테스트 실행',at:'2026-10-16T01:00:01Z'},
]};
vm.runInContext('render(workGraph,false)',context);
assert(card('ux-work').includes('최근 작업 · 메시지 문서 검토'));
assert(card('dx-work').includes('최근 작업 · SSE 테스트 실행'));
context.workGraph.nodes.push(
 {id:'ux-send',kind:'tool',parent:'ux-work',toolName:'agent-observer',label:'메시지 보내기',at:'2026-10-16T01:00:02Z'},
 {id:'dx-ack',kind:'tool',parent:'dx-work',toolName:'agent-observer',label:'메시지 수신 확인',at:'2026-10-16T01:00:02Z'},
 {id:'ux-helper',kind:'tool',parent:'ux-work',toolName:'python3',label:'코드 실행 · python3',at:'2026-10-16T01:00:03Z'},
 {id:'dx-harness-doc',kind:'tool',parent:'dx-work',toolName:'cat',label:'하네스 관측 문서 읽기',at:'2026-10-16T01:00:04Z'},
 {id:'ux-mark',kind:'tool',parent:'ux-work',toolName:'tools.task_observation',label:'작업 관찰 · 종료',at:'2026-10-16T01:00:05Z'},
 {id:'dx-mark',kind:'tool',parent:'dx-work',toolName:'tools.task_measurement',label:'작업 관찰 · 기록',at:'2026-10-16T01:00:06Z',exitCode:1},
 {id:'work-message',kind:'a2a',source:'ux-work',target:'dx-work',body:'검토 결과',status:'수신 확인'},
);
vm.runInContext('render(workGraph,false)',context);
for(const internal of ['ux-mark','dx-mark','dx-harness-doc'])assert(!vm.runInContext(`visibleNodes().some(n=>n.id==='${internal}')`,context));
assert(card('ux-work').includes('최근 작업 · 메시지 문서 검토'));
assert(card('dx-work').includes('최근 작업 · SSE 테스트 실행'));
assert.equal(vm.runInContext('messageElements.size',context),1);
vm.runInContext("toggleGroup('ux-work');toggleGroup('dx-work')",context);
assert(vm.runInContext("elements.has('ux-helper')&&elements.has('ux-send')&&elements.has('dx-ack')",context),'Supporting work remains inspectable');
dom.get('#internals').onclick();
assert(vm.runInContext("elements.has('ux-mark')&&elements.has('dx-mark')&&elements.has('dx-harness-doc')",context),'Internal events remain available on demand');
assert(card('dx-mark').includes('내부 ·'));
assert(card('ux-work').includes('최근 작업 · 메시지 문서 검토'));
assert(card('dx-work').includes('최근 작업 · SSE 테스트 실행'));
context.workGraph.nodes.push({id:'dx-real-next',kind:'tool',parent:'dx-work',label:'메시지 테스트 실행',toolName:'go',at:'2026-10-16T01:00:07Z',exitCode:1,status:'오류'});
vm.runInContext("render(workGraph,false);toggleGroup('dx-work')",context);
assert(card('dx-work').includes('최근 작업 · 메시지 테스트 실행'),'A later real task, including a failure, updates the summary');
assert.equal(vm.runInContext('messageElements.size',context),1);
dom.get('#internals').onclick();
context.workGraph.nodes=context.workGraph.nodes.filter(n=>!['ux-review','ux-helper','ux-mark'].includes(n.id));
vm.runInContext('render(workGraph,false)',context);
assert(card('ux-work').includes('최근 작업 · 메시지 보내기'),'A group with only messaging still describes its observed work');
context.workGraph.nodes=context.workGraph.nodes.filter(n=>n.id!=='ux-send');
vm.runInContext('render(workGraph,false)',context);
assert(card('ux-work').includes('작업 기록 대기'),'Never borrow a task from a different agent');
context.workGraph.nodes.push({id:'ux-review-again',kind:'tool',parent:'ux-work',label:'메시지 문서 검토',at:'2026-10-16T01:00:08Z'},
 {id:'ux-failed-script',kind:'tool',parent:'ux-work',label:'코드 실행 · python3',toolName:'python3',status:'오류',exitCode:1,at:'2026-10-16T01:00:09Z'});
vm.runInContext('render(workGraph,false)',context);
assert(card('ux-work').includes('최근 작업 · 코드 실행 · python3 · 오류'),'An unclassified real failure must not be concealed by an earlier named task');
context.workGraph.nodes.push({id:'ux-new-test',kind:'tool',parent:'ux-work',label:'SSE 테스트 실행',status:'완료 관측',at:'2026-10-16T01:00:10Z'});
vm.runInContext('render(workGraph,false)',context);
assert(card('ux-work').includes('최근 작업 · SSE 테스트 실행'),'A later real task replaces the failure');
context.workGraph.nodes.push({id:'ux-active-script',kind:'tool',parent:'ux-work',label:'코드 실행 · python3',status:'running',at:'2026-10-16T01:00:11Z'});
vm.runInContext('render(workGraph,false)',context);
assert(card('ux-work').includes('최근 작업 · 코드 실행 · python3'),'An unclassified active task remains visible');
console.log('PASS: meaningful group work survives harness/Ack events; internals stay expandable and later real tasks update');

context.snapshot={turn:'managed-push',nodes:[
 {id:'agent',kind:'agent',label:'메인',parent:'request'},
 {id:'managed:ux',kind:'subagent',label:'UX',parent:'agent',managedWorker:true,currentTask:'메시지 UX 검토',status:'작업 중'},
 {id:'managed:dx',kind:'subagent',label:'DX',parent:'agent',managedWorker:true,status:'유휴 · 메시지 대기'},
 {id:'managed-msg',kind:'a2a',source:'managed:ux',target:'managed:dx',bodySource:'observer-managed',body:'실제 본문 <script>danger()</script>',status:'작업자 턴 완료',result:'확인 <img src=x onerror=bad()>'},
]};
vm.runInContext("render(snapshot);selected='managed-msg';inspect()",context);
assert(card('managed:ux').includes('Observer 관리 작업자'));
assert(card('managed:ux').includes('담당 작업 · 메시지 UX 검토'));
assert(dom.get('#detail').innerHTML.includes('Observer 자동 전달'));
assert(dom.get('#detail').innerHTML.includes('수신 작업자의 실행 결과'));
assert(!dom.get('#detail').innerHTML.includes('<script>danger()'));
assert(!dom.get('#detail').innerHTML.includes('<img src=x'));
console.log('PASS: managed worker identity, declared task, push provenance and escaped execution results');

context.timeCases=[
 {id:'later',at:'2026-10-15T00:00:00.000000002Z'},
 {id:'earlier',at:'2026-10-15T09:00:00.000000001+09:00'},
 {id:'tie-z',at:'2026-10-15T00:00:00.000000001Z'},
 {id:'invalid-b',at:'2026-02-30T00:00:00Z'}, {id:'invalid-a'},
];
const ordered=vm.runInContext('timeCases.slice().sort(compareChronological).map(n=>n.id).join(",")',context);
assert.equal(ordered,'invalid-a,invalid-b,earlier,tie-z,later');
assert.equal(vm.runInContext('timeCases.slice().reverse().sort(compareChronological).map(n=>n.id).join(",")',context),ordered);
for(const invalid of ['2026-10-15T00:00:00+24:00','2026-10-15T00:00:00.1234567890Z','2026-02-29T00:00:00Z']){
 context.invalid=invalid;assert.equal(vm.runInContext('instantNs(invalid)',context),null);
}
assert.equal(vm.runInContext("instantNs('2026-10-15T00:00:00-00:00')===instantNs('2026-10-15T00:00:00Z')",context),true);
context.workCases=[
 {id:'new',kind:'tool',label:'New',at:'2026-10-15T00:00:00.000000002Z'},
 {id:'old',kind:'tool',label:'Old',at:'2026-10-15T09:00:00.000000001+09:00'},
 {id:'bad',kind:'tool',label:'Bad',at:'invalid'},
];
assert.equal(vm.runInContext('groupSummary({members:workCases})',context),'최근 작업 · New');
context.snapshot={sessionId:'evidence',turn:'evidence',nodes:[
 {id:'agent',kind:'agent',label:'Main'}, {id:'managed:ux',kind:'subagent',label:'UX'},
 ...context.timeCases.filter(n=>n.at).map((n,i)=>({...n,kind:'a2a',source:'agent',target:'managed:ux',body:'message-'+n.id,result:'result-'+n.id,outputState:i===0?'truncated':i===1?'complete':'',outputReason:i===0?'display-limit':''})),
]};
vm.runInContext("render(snapshot);selected='later';inspect()",context);
const timeDetail=dom.get('#detail').innerHTML;
assert(timeDetail.indexOf('message-earlier')<timeDetail.indexOf('message-later'),'conversation compares instants');
assert(timeDetail.includes('전체 결과 보관')&&timeDetail.includes('일부 결과 보관 · 길이 제한')&&timeDetail.includes('결과 완전성 미수집'),'output completeness rendered');
vm.runInContext('[...messageElements.values()][0].onclick()',context);
assert.equal(vm.runInContext('selected',context),'later','edge opens chronologically latest message');
assert(vm.runInContext("executionResult({outputState:'omitted',outputReason:'no-final-text'}).includes('결과 본문 미수집')",context));
assert(vm.runInContext("executionResult({outputState:'complete'}).includes('(빈 결과)')",context));
console.log('PASS: nanosecond/offset chronology, invalid timestamps, output completeness, edge selection');

context.changedTimestamp={id:'changed',at:'2026-10-15T00:00:00Z'};
assert(vm.runInContext("nodeInstant(changedTimestamp)===instantNs(changedTimestamp.at)",context));
context.changedTimestamp.at='2026-10-15T00:00:01Z';
assert(vm.runInContext("nodeInstant(changedTimestamp)===instantNs(changedTimestamp.at)",context),'timestamp cache invalidates changed fields');

// Sample is a separate view and must invalidate previously queued live work.
let sampleRequests=0;
const originalFetch=context.fetch;
context.fetch=()=>{sampleRequests++;return new Promise(()=>{});};
const beforeSampleCatalog=vm.runInContext('sessionItems',context);
const beforeGeneration=vm.runInContext('connectionGeneration',context);
vm.runInContext('openSample()',context);
assert.equal(sampleRequests,0,'Sample makes no HTTP requests');
assert(vm.runInContext('sampleMode&&connectionGeneration>0&&eventStream===null',context));
assert(vm.runInContext('connectionGeneration',context)>beforeGeneration);
assert.equal(dom.get('#sample-notice').hidden,false);
assert.equal(dom.get('#sample-inspector').hidden,false);
assert(dom.get('#detail').innerHTML.includes('가상 검토 의견'));
assert(dom.get('#detail').innerHTML.includes('합성 샘플 메시지'));
assert.equal(vm.runInContext('sessionItems',context),beforeSampleCatalog);
context.staleSnapshot={sessionId:'stale',turn:'stale',nodes:[{id:'stale',kind:'agent'}]};
vm.runInContext('applyLiveState(staleSnapshot);updateSessions([{sessionId:"stale",label:"stale"}])',context);
assert.equal(vm.runInContext('data.sessionId',context),'synthetic-sample');
assert.equal(vm.runInContext('sessionItems',context),beforeSampleCatalog);
vm.runInContext('openSample();openSample()',context);
assert.equal(vm.runInContext('data.nodes.length',context),8);
assert.equal(sampleRequests,0);
vm.runInContext('showOverview()',context);
assert.equal(dom.get('#sample-notice').hidden,true);
assert.equal(dom.get('#pause').hidden,false);
assert.equal(dom.get('#overview').hidden,false);
context.fetch=originalFetch;
console.log('PASS: synthetic view, no requests, stale live data ignored, unchanged catalog, repeat and exit');

// Copy/paste mistakes should be corrected or explained before any source is read.
context.manualPath='  /tmp/session fixtures/first use.jsonl  ';
const manualInput=vm.runInContext("sessionInput(manualPath,' First use ')",context);
assert.equal(manualInput.source,'/tmp/session fixtures/first use.jsonl');
assert.equal(manualInput.label,'First use');
assert.equal(vm.runInContext("sessionInput('~/.codex/sessions/example.jsonl','').label",context),null);
for(const [source,message] of [['relative.jsonl','전체 경로'],['/tmp/sessions','파일을 선택']]){
 context.invalidPath=source;
 assert.throws(()=>vm.runInContext("sessionInput(invalidPath,'')",context),new RegExp(message));
}
assert.throws(()=>vm.runInContext("sessionInput('/tmp/file.jsonl','x'.repeat(101))",context),/100자/);
console.log('PASS: manual connection whitespace, paths with spaces, home shorthand and actionable input errors');

// Transport health and recorded activity are independent evidence. A successful
// poll/reconnect must not invent a new event or erase a known source-read error.
const recordedAt='2026-10-15T01:02:03Z',checkedAt='2026-10-15T09:10:11Z';
const localClock=value=>new Date(value).toLocaleTimeString('ko-KR',{hour12:false});
context.activitySnapshot={sessionId:'activity',turn:'activity',revision:1,lastEvent:recordedAt,checkedAt,
 nodes:[{id:'agent',kind:'agent',label:'Synthetic agent'}]};
vm.runInContext("activeSession='activity';paused=false;applyLiveState(activitySnapshot)",context);
const heartbeat=dom.get('#heartbeat'),status=dom.get('#status');
assert.equal(heartbeat.textContent,'마지막 기록 '+localClock(recordedAt),'Use the recorded event time, not the later observation time');
assert.equal(heartbeat.title,'마지막 확인 '+localClock(checkedAt));
context.activitySnapshot.checkedAt='2026-10-16T09:10:11Z';
vm.runInContext('applyLiveState(activitySnapshot)',context);
assert.equal(heartbeat.textContent,'마지막 기록 '+localClock(recordedAt),'An idle observation does not count as new work');
assert.equal(status.dataset.state,'online','Old records alone do not establish an agent stall');
for(const lastEvent of [null,undefined,'invalid','2026-02-30T00:00:00Z']){
 context.activitySnapshot.lastEvent=lastEvent;
 vm.runInContext('applyLiveState(activitySnapshot)',context);
 assert.equal(heartbeat.textContent,'기록 시각 미수집','Missing or invalid event times remain unknown');
 assert.equal(status.dataset.state,'online');
}
context.activitySnapshot.lastEvent=recordedAt;
context.activitySnapshot.error='Synthetic source read error';
vm.runInContext('applyLiveState(activitySnapshot);startEventStream(activeSession,connectionGeneration)',context);
const sourceErrorStream=context.streams.at(-1);
sourceErrorStream.onopen();
assert.equal(status.dataset.state,'source-error','SSE open must retain the known source-read error');
assert.equal(status.textContent,'SSE 연결됨 · 기록 읽기 오류');
sourceErrorStream.onerror();
assert.equal(status.dataset.state,'offline','Transport failure is distinct from a source-read error');
sourceErrorStream.onopen();
assert.equal(status.dataset.state,'source-error','Automatic reconnection cannot clear source-read evidence');
const knownSourceState=vm.runInContext('latestState',context);
vm.runInContext('connectEvents();startEventStream(activeSession,connectionGeneration)',context);
assert.equal(vm.runInContext('latestState',context),knownSourceState,'An explicit same-session reconnect retains the last source result');
context.streams.at(-1).onopen();
assert.equal(status.dataset.state,'source-error');
context.activitySnapshot.error=null;
vm.runInContext('applyLiveState(activitySnapshot)',context);
assert.equal(status.dataset.state,'online','A valid source result clears the error');
vm.runInContext('paused=true;applyLiveState(activitySnapshot)',context);
context.streams.at(-1).onopen();
assert.equal(status.dataset.state,'paused','SSE open does not resume paused rendering');
vm.runInContext("paused=false;activeSession='another-activity';connectEvents();startEventStream(activeSession,connectionGeneration)",context);
assert.equal(vm.runInContext('latestState',context),null,'A different session must not inherit the previous source result');
assert.equal(heartbeat.textContent,'기록 연결 대기');
assert.equal(heartbeat.title,'');
context.streams.at(-1).onopen();
assert.equal(status.textContent,'SSE 연결됨 · 기록 확인 중','Transport open alone is not a successful source read');
vm.runInContext('openSample()',context);
assert.equal(status.dataset.state,'sample');
assert.equal(heartbeat.title,'','Sample mode must not retain a real source observation time');

// Resolve only the status-dot rules; layout/color rendering still needs the
// real-browser check required by CONTRIBUTING.md.
const css=html.match(/<style>([\s\S]*?)<\/style>/)[1];
function statusDotColor(state){
 let color;
 for(const [,selectors,declarations] of css.matchAll(/([^{}]+)\{([^{}]+)\}/g)){
  if(!selectors.split(',').some(s=>s.trim()==='#status:before'||s.trim()===`#status[data-state="${state}"]:before`))continue;
  color=/(?:^|;)\s*background\s*:\s*([^;]+)/.exec(declarations)?.[1]||color;
 }
 return color;
}
for(const state of ['connecting','sample','unknown'])assert.notEqual(statusDotColor(state),statusDotColor('online'),'Only an established connection gets the online color');
assert.notEqual(statusDotColor('source-error'),statusDotColor('online'));
assert.equal(statusDotColor('source-error'),statusDotColor('offline'),'Source-read failures retain the error color');
assert.notEqual(statusDotColor('paused'),statusDotColor('online'));
console.log('PASS: recorded activity vs observation time, unknown timestamps, reconnect/source-error precedence, pause and status-dot colors');
