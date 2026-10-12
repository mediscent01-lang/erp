const {test}=require('node:test'),assert=require('node:assert/strict');
const C=require('../erp-core.js'),M=require('../business-math.js');const {fixture}=require('./harness.cjs');
test('한국 자정 날짜 전환과 타임존 독립성',()=>{
 assert.equal(C.kstDate('2026-10-10T14:59:59Z'),'2026-10-10');assert.equal(C.kstDate('2026-10-10T15:00:00Z'),'2026-10-11');
 assert.equal(C.addDays('2026-10-10',7),'2026-10-17');assert.equal(C.addDays('2028-02-28',1),'2028-02-29');
 assert.throws(()=>C.addDays('2026-02-30',1));
});
test('QC 미판정·취소·재작업·만료·숙성 미완료 LOT 사용 차단',()=>{
 for(const status of ['HOLD','VOID','FAIL','REWORK','EXPIRED',''])assert.ok(C.blockReason({status},'2026-10-10'));
 assert.ok(C.blockReason({status:'OK',matureUntil:'2026-10-11'},'2026-10-10'));
 assert.ok(C.blockReason({status:'OK',expDate:'2026-10-09'},'2026-10-10'));
 assert.equal(C.blockReason({status:'OK',expDate:'2026-10-10'},'2026-10-10'),null);
});
test('중복 ID 진단과 모호한 LOT 선택 차단',()=>{
 const d=fixture();d.stock.RAW_LOT.push({...d.stock.RAW_LOT[0],lotNo:'R-other'});
 assert.ok(C.validate(d).some(x=>x.kind==='DUPLICATE_ID'));assert.throws(()=>C.uniqueLot(d,'RAW_LOT',1));
});
test('여러 행에서 공유하는 원료 소요량 합산',()=>{
 const d=fixture();d.stock.RAW_LOT[0].remaining=100;
 const need=(p,b,q)=>b.type==='RAW'?b.qty/100*p.fillWeight*q:b.qty*q;
 assert.throws(()=>C.preflightProduction(d,[{pid:1,qty:10},{pid:1,qty:10}],need));
 assert.equal(d.stock.RAW_LOT[0].remaining,100);
});
test('미승인 최신 처방은 생산 처방으로 선택하지 않는다',()=>{
 const d=fixture();d.master.M_FORMULA=[{id:1,productId:1,status:'APPROVED',approvedAt:'2026-01-01',approvedBy:'u'},{id:2,productId:1,createdAt:'2026-10-10',status:'DRAFT'}];
 assert.equal(C.formula(d,1).id,1);
});
test('중량 배합 1kg·25% 향료: 250g/750g',()=>{
 const r=M.perfumeBatch({unit:'kg',basis:'ww',finalAmount:1,targetPercent:25});assert.equal(r.stockWeight,250);assert.equal(r.diluentWeight,750);
});
test('부피 배합 700mL·25% 및 원료별 밀도 환산',()=>{
 const r=M.perfumeBatch({unit:'ml',basis:'vv',finalAmount:700,targetPercent:25,stockDensity:1.056,diluentDensity:.789});
 assert.equal(r.stockAmount,175);assert.equal(r.diluentAmount,525);assert.equal(r.stockWeight,184.8);assert.equal(r.diluentWeight,414.225);
});
test('중량 기준 mL는 완성 벌크 밀도로 계산',()=>{
 const r=M.perfumeBatch({unit:'ml',basis:'ww',finalAmount:700,targetPercent:25,finishedDensity:.87});assert.equal(r.stockWeight,152.25);assert.equal(r.diluentWeight,456.75);
});
test('밀도 누락·잘못된 농도·손실 100% 거부',()=>{
 assert.throws(()=>M.perfumeBatch({unit:'ml',basis:'vv',finalAmount:700,targetPercent:25}));
 assert.throws(()=>M.perfumeBatch({unit:'g',basis:'vv',finalAmount:700,targetPercent:25}));
 assert.throws(()=>M.dilution({finalAmount:100,targetPercent:50,stockPercent:25}));
 assert.throws(()=>M.dilution({finalAmount:100,targetPercent:20,lossPercent:100}));
});
test('손실 보정은 순량/(1-손실률)',()=>{
 const r=M.dilution({finalAmount:980,targetPercent:20,lossPercent:2});assert.equal(r.grossAmount,1000);assert.equal(r.stockAmount,200);assert.equal(r.diluentAmount,800);
});
test('수수료 차감 후 공헌이익과 손익분기 무한대 처리',()=>{
 const r=M.costMargin({retailPrice:11000,cogs:4000,platformFeeRate:10,fulfillment:1000});assert.equal(r.contribution,3900);
 assert.equal(M.costMargin({retailPrice:100,cogs:10,wholesaleRate:0}).breakEvenRetail,Infinity);
});
