const {test}=require('node:test');
const assert=require('node:assert/strict');
const {app,fixture}=require('./harness.cjs');
const M=require('../business-math.js');
test('로그인 전 기본 재고 생성 및 서버 쓰기 금지',async()=>{
 const a=await app({authenticated:false});try{
 assert.equal(a.server.requests.filter(x=>x.method!=='GET').length,0);
 assert.equal(a.w.db.stock.FGT_LOT.length,0);
 }finally{a.close()}
});
test('숙성 완료는 QC 합격으로 바꾸지 않는다',async()=>{
 const d=fixture();d.stock.BULK_LOT=[{id:4,productId:1,lotNo:'B1',qty:10,remaining:10,status:'HOLD',matureUntil:'2020-01-01'}];
 const a=await app({data:d});try{a.w.renderBulkPage();assert.equal(a.w.db.stock.BULK_LOT[0].status,'HOLD')}finally{a.close()}
});
test('간편 생산 원료 부족 시 전체 거래 중단',async()=>{
 const d=fixture();d.stock.RAW_LOT[0].remaining=1;
 const a=await app({data:d});try{
 a.w.goPage('quick-log');a.w.qlTab('prod');a.value('ql-p-0',1);a.value('ql-q-0',10);
 const before=JSON.stringify(a.w.db.stock);a.w.commitQuick();
 assert.equal(JSON.stringify(a.w.db.stock),before);
 assert.equal(a.w.db.txn.T_BATCH.length,0);
 }finally{a.close()}
});
test('배합비 음수 거부',()=>assert.throws(()=>M.batchComposition({finalAmount:100,components:[{percent:-10},{percent:110}]})));
test('공급률 0을 100으로 바꾸지 않는다',()=>assert.equal(M.costMargin({retailPrice:100,wholesaleRate:0,cogs:10}).channelRevenue,0));
