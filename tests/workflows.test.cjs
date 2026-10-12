const {test}=require('node:test'),assert=require('node:assert/strict');
const {app,fixture,copy}=require('./harness.cjs');
const C=require('../erp-core.js');
function pick(a,page,fields){a.w.goPage(page);for(const [id,v]of Object.entries(fields))a.value(id,v);}
test('실제 폼 함수로 제조·QC·출고·반품 연결 검증',async t=>{
 const a=await app();const w=a.w;
 try{
  await t.test('전체 스크립트 초기화 오류 없음',()=>assert.deepEqual(a.errors,[]));
  await t.test('로그인 후 읽기만으로 자동 저장하지 않는다',()=>assert.equal(a.server.requests.filter(r=>r.method!=='GET').length,0));
  await t.test('입고 1kg→1000g, 300000원/kg→300원/g, QC 대기',()=>{
   pick(a,'t-goods-in',{'gi-type':'RAW','gi-item':1,'gi-unit':'kg','gi-qty':1,'gi-unitcost':300000,'gi-lot':'R-KG'});w.saveGoodsIn();
   const l=w.db.stock.RAW_LOT.find(l=>l.lotNo==='R-KG');assert.equal(l.remaining,1000);assert.equal(l.unitCost,300);assert.equal(l.status,'HOLD');
  });
  await t.test('벌크 10EA분: 향료80g·알코올320g, 원료원가25600원',()=>{
   pick(a,'t-bulk',{'bulk-product2':1,'bulk-qty2':10,'bulk-date2':C.kstDate(),'bulk-mature-days2':0});w.createBulk2();
   assert.equal(w.db.txn.T_BULK.length,1);assert.equal(w.db.stock.RAW_LOT[0].remaining,920);assert.equal(w.db.stock.RAW_LOT[1].remaining,680);
   assert.equal(w.db.txn.T_BULK[0].rawCost,25600);assert.equal(w.db.stock.BULK_LOT[0].status,'HOLD');
  });
  await t.test('중복 클릭으로 벌크가 두 번 생성되지 않는다',()=>{w.createBulk2();assert.equal(w.db.txn.T_BULK.length,1)});
  await t.test('QC 미승인 벌크 충진 차단',()=>{
   pick(a,'t-batch',{'batch-bulk-lot2':w.db.stock.BULK_LOT[0].id,'batch-qty2':10});w.createBatch2();assert.equal(w.db.txn.T_BATCH.length,0);
  });
  await t.test('벌크 QC 합격 후 충진: 포장재10개 차감·완제품 HOLD',()=>{
   pick(a,'t-qc',{'qc-type2':'BULK'});a.value('qc-lot2',w.db.stock.BULK_LOT[0].id);a.value('qc-status2','OK');w.saveQc2();
   pick(a,'t-batch',{'batch-bulk-lot2':w.db.stock.BULK_LOT[0].id,'batch-qty2':10});w.createBatch2();
   assert.equal(w.db.txn.T_BATCH.length,1);assert.equal(w.db.stock.BULK_LOT[0].remaining,0);assert.equal(w.db.stock.PACK_LOT[0].remaining,90);
   assert.equal(w.db.stock.FGT_LOT[0].remaining,10);assert.equal(w.db.stock.FGT_LOT[0].status,'HOLD');assert.equal(w.db.stock.FGT_LOT[0].unitCost,3260);
  });
  await t.test('완제품 QC 이전 출고 차단',()=>{
   pick(a,'t-sale',{'sale-cust2':1,'sale-lot2':w.db.stock.FGT_LOT[0].id,'sale-qty2':4,'sale-price2':90000});w.saveSale2();assert.equal(w.db.txn.T_SALE.length,0);
  });
  await t.test('검사 항목 부적합인데 합격 버튼을 눌러도 차단',()=>{
   pick(a,'qc-prod',{'qcp-lot':w.db.stock.FGT_LOT[0].id,'qcp-visual':'부적합'});w.saveQcProd('OK');assert.equal(w.db.stock.FGT_LOT[0].status,'HOLD');
  });
  await t.test('완제품 합격·4개 출고: 잔량6·출고액360000원',()=>{
   a.value('qcp-visual','적합');w.saveQcProd('OK');
   pick(a,'t-sale',{'sale-cust2':1,'sale-lot2':w.db.stock.FGT_LOT[0].id,'sale-qty2':4,'sale-price2':90000});w.saveSale2();
   assert.equal(w.db.txn.T_SALE.length,1);assert.equal(w.db.stock.FGT_LOT[0].remaining,6);assert.equal(w.db.txn.T_SALE[0].amount,360000);
  });
  await t.test('출고 중복 클릭 방지',()=>{w.saveSale2();assert.equal(w.db.txn.T_SALE.length,1)});
  await t.test('반품2개는 정상 잔량6을 건드리지 않고 격리 HOLD',()=>{
   pick(a,'sales-return',{'ret-lot':w.db.stock.FGT_LOT[0].id,'ret-qty':2,'ret-action':'재입고'});w.processReturn();
   assert.equal(w.db.stock.FGT_LOT[0].remaining,6);const l=w.db.stock.FGT_LOT.find(l=>l.location==='반품격리');assert.equal(l.remaining,2);assert.equal(l.status,'HOLD');
  });
  await t.test('출고4·이미 반품2인데 추가3 반품 차단',()=>{
   pick(a,'sales-return',{'ret-lot':w.db.stock.FGT_LOT[0].id,'ret-qty':3,'ret-action':'재입고'});w.processReturn();assert.equal(w.db.txn.T_RETURN.length,1);
  });
  await t.test('최종 서버 저장 완료 확인·로컬과 서버 거래 일치',async()=>{
   const r=await w.saveDB();assert.equal(r.ok,true);assert.equal(a.server.requests.filter(r=>r.method==='POST'&&r.url.includes('/erp_data')).length,0);assert.equal(a.server.data.txn.T_SALE.length,1);assert.equal(a.server.data.txn.T_RETURN.length,1);
   assert.equal(a.server.data.stock.FGT_LOT[0].remaining,6);
  });
 }finally{a.close()}
});
test('간편 기록의 부족·QC·중복 SKU 입력 보호',async t=>{
 const a=await app();const w=a.w;
 function reset(d){clearTimeout(w.SHIFTI_SUITE.state.timer);w.db=copy(d);w.renderAll();}
 function quick(qty){w.goPage('quick-log');w.qlTab('prod');a.value('ql-p-0',1);a.value('ql-q-0',qty)}
 try{
  await t.test('사용가능 원료와 HOLD 원료를 합쳐 생산하지 않는다',()=>{
   const d=fixture();d.stock.RAW_LOT[0].status='HOLD';reset(d);quick(10);w.commitQuick();assert.equal(w.db.stock.FGT_LOT.length,0);
  });
  await t.test('BOM 없는 제품으로 원가0 완제품 생성 차단',()=>{
   const d=fixture();d.master.M_PRODUCT[0].bom=[];reset(d);quick(10);w.commitQuick();assert.equal(w.db.stock.FGT_LOT.length,0);
  });
  await t.test('같은 SKU 두 행의 합계 원료 부족이면 전체 중단',()=>{
   const d=fixture();d.stock.RAW_LOT[0].remaining=100;reset(d);quick(10);a.value('ql-p-1',1);a.value('ql-q-1',10);w.commitQuick();assert.equal(w.db.stock.RAW_LOT[0].remaining,100);assert.equal(w.db.stock.FGT_LOT.length,0);
  });
  await t.test('간편 생산 성공해도 바로 판매할 수 없다',()=>{
   reset(fixture());quick(10);w.commitQuick();assert.equal(w.db.stock.FGT_LOT[0].status,'HOLD');assert.equal(w.db.stock.FGT_LOT[0].location,'공장');
   w.qlTab('sale');a.value('ql-loc','공장');a.value('ql-p-0',1);a.value('ql-q-0',1);w.commitQuick();assert.equal(w.db.txn.T_SALE.length,0);
  });
  await t.test('중복 LOT ID 선택으로 출고하지 않는다',()=>{
   const d=fixture();d.stock.FGT_LOT=[{id:'same',productId:1,lotNo:'F1',remaining:10,status:'OK'},{id:'same',productId:1,lotNo:'F2',remaining:20,status:'OK'}];reset(d);
   pick(a,'t-sale',{'sale-cust2':1,'sale-lot2':'same','sale-qty2':1});w.saveSale2();assert.equal(w.db.txn.T_SALE.length,0);assert.equal(w.db.stock.FGT_LOT[0].remaining,10);
  });
  await t.test('만료된 OK 완제품 출고 차단',()=>{
   const d=fixture();d.stock.FGT_LOT=[{id:'expired',productId:1,lotNo:'F1',remaining:10,status:'OK',expDate:'2020-01-01'}];reset(d);
   pick(a,'t-sale',{'sale-cust2':1,'sale-lot2':'expired','sale-qty2':1});w.saveSale2();assert.equal(w.db.txn.T_SALE.length,0);
  });
 }finally{a.close()}
});
