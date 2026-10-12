const {test}=require('node:test'),assert=require('node:assert/strict');const {app,fixture,copy}=require('./harness.cjs');
test('동시 저장은 서버 버전 조건으로 하나만 반영하고 다른 작업 보존',async()=>{
 const data=fixture(),backend={data:copy(data),stamp:data.meta.updatedAt,requests:[],delay:20};
 const [a,b]=await Promise.all([app({backend}),app({backend})]);
 try{
  a.w.db.meta.edit='A';b.w.db.meta.edit='B';
  const [ra,rb]=await Promise.all([a.w.saveDB(),b.w.saveDB()]);
  assert.equal([ra,rb].filter(r=>r.ok).length,1);assert.equal([ra,rb].filter(r=>r.conflict).length,1);
  const loser=ra.conflict?a:b;assert.ok(loser.w.document.getElementById('sf-conflict'));assert.equal(loser.w.document.getElementById('sf-cf').disabled,true);
  assert.equal(JSON.parse(loser.w.localStorage.getItem('shifti_erp_v2')).meta.edit,ra.conflict?'A':'B');
 }finally{a.close();b.close()}
});
test('저장 실패는 성공으로 표시하지 않고 로컬 유지·재시도',async()=>{
 const a=await app({fail:true});try{
  a.w.db.meta.edit='pending';const r=await a.w.saveDB();assert.equal(r.ok,false);assert.equal(a.server.data.meta.edit,undefined);
  assert.equal(JSON.parse(a.w.localStorage.getItem('shifti_erp_v2')).meta.edit,'pending');assert.equal(a.w.SHIFTI_SUITE.state.dirty,true);
  a.server.fail=false;const retry=await a.w.saveDB();assert.equal(retry.ok,true);assert.equal(a.server.data.meta.edit,'pending');
 }finally{a.close()}
});
test('클라우드 조회 실패 시 오래된 캐시 자동 업로드 금지',async()=>{
 const local=fixture();local.meta.updatedAt='2099-01-01T00:00:00Z';local.meta.edit='local';const a=await app({local,readFail:true});
 try{assert.equal(a.w.ERPRuntime.state.ready,false);const r=await a.w.saveDB();assert.equal(r.ok,false);assert.equal(a.server.requests.filter(r=>r.method!=='GET').length,0)}finally{a.close()}
});
test('서버보다 미래인 로컬 캐시도 서버 원장을 덮어쓰지 않는다',async()=>{
 const local=fixture();local.meta.updatedAt='2099-01-01T00:00:00Z';local.meta.edit='stale-local';const a=await app({local});
 try{assert.equal(a.w.db.meta.edit,undefined);assert.equal(a.server.requests.filter(r=>r.method!=='GET').length,0);assert.equal(JSON.parse(a.w.localStorage.getItem('shifti_erp_v2_recovery')).meta.edit,'stale-local')}finally{a.close()}
});
test('서버 요청 진행 중 추가 수정도 두 번째 조건부 저장으로 보존',async()=>{
 const a=await app();try{
  a.server.delay=200;a.w.db.meta.edit='first';const first=a.w.saveDB();
  await new Promise((resolve,reject)=>{let n=0;const poll=()=>{if(a.server.requests.some(r=>r.method==='PATCH'))return resolve();if(++n>50)return reject(new Error('save did not start'));setTimeout(poll,50)};poll()});
  a.w.db.meta.edit='second';const second=a.w.saveDB();assert.equal((await first).ok,true);assert.equal((await second).ok,true);assert.equal(a.server.data.meta.edit,'second');assert.equal(a.w.db.meta.edit,'second');
 }finally{a.close()}
});
test('세션 만료 시 공개 키로 저장하지 않고 기록을 잠근다',async()=>{
 const a=await app();try{a.w.__auth.auth.getSession=async()=>({data:{session:null}});const r=await a.w.saveDB();assert.equal(r.ok,false);assert.equal(a.w.ERPRuntime.state.ready,false);assert.equal(a.server.requests.filter(r=>r.method==='PATCH').length,0)}finally{a.close()}
});
