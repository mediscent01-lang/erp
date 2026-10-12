const {test}=require('node:test'),assert=require('node:assert/strict');const {app,fixture,copy}=require('./harness.cjs');const C=require('../erp-core.js');
test('승인 처방 보호와 생산 시점 스냅샷',async t=>{
 const data=fixture();data.master.M_FORMULA=[{id:91,productId:1,version:'v2',name:'검증 처방',bom:copy(data.master.M_PRODUCT[0].bom),status:'DRAFT'}];
 const a=await app({data});try{
  await t.test('초안은 생산 적용하지 않고 승인 이력을 남긴다',()=>{assert.equal(a.w.productionProduct(1).productionFormulaId,null);assert.equal(a.w.approveFormula2(91),true);assert.equal(a.w.db.master.M_FORMULA[0].approvedBy,'test-user');assert.equal(a.w.productionProduct(1).productionFormulaId,91)});
  await t.test('승인한 처방 삭제 차단',()=>{a.w.deleteFormula2(91);assert.equal(a.w.db.master.M_FORMULA.length,1)});
  await t.test('승인한 처방 수정 차단',()=>{a.w.editFormula2(91);a.value('fml-name2','변조');a.w.saveFormula2();assert.equal(a.w.db.master.M_FORMULA[0].name,'검증 처방')});
  await t.test('마스터 변경 후에도 승인 BOM으로 배합하고 벌크에 동결',()=>{a.w.db.master.M_PRODUCT[0].bom[0].qty=99;a.w.goPage('t-bulk');a.value('bulk-product2',1);a.value('bulk-qty2',10);a.value('bulk-date2',C.kstDate());a.value('bulk-mature-days2',0);a.w.createBulk2();const l=a.w.db.stock.BULK_LOT[0];assert.equal(l.formulaId,91);assert.equal(l.bomSnapshot[0].qty,20);assert.equal(a.w.db.stock.RAW_LOT[0].remaining,920);a.w.db.master.M_FORMULA[0].bom[0].qty=50;assert.equal(l.bomSnapshot[0].qty,20)});
  await t.test('운영 전체 삭제가 직접 업로드로 우회하지 않는다',()=>{const before=JSON.stringify(a.w.db);a.w.resetDB();assert.equal(JSON.stringify(a.w.db),before);assert.equal(a.server.requests.filter(r=>r.method==='POST').length,0)});
  await t.test('재고 전체 삭제 우회도 차단',()=>{const before=JSON.stringify(a.w.db);a.w.wipeAllStock();assert.equal(JSON.stringify(a.w.db),before)});
  await t.test('LOT 직접 수정으로 QC 합격을 만들 수 없다',()=>{const l=a.w.db.stock.BULK_LOT[0];a.w.openLotEdit('BULK_LOT',l.id);a.value('le-status','OK');a.w.saveLotEdit('BULK_LOT',l.id);assert.equal(l.status,'HOLD');a.w.document.getElementById('lot-edit-modal').remove()});
  await t.test('기초재고도 승인 없이 출고 가능한 OK로 생성하지 않는다',()=>{a.w.goPage('loc-stock');a.value('init-prod',1);a.value('init-qty',5);a.value('init-cost',3000);a.w.saveInitStock();assert.equal(a.w.db.stock.FGT_LOT.at(-1).status,'HOLD')});
  await t.test('LOT 관리 화면의 취소는 삭제 대신 VOID와 조정 이력 보존',()=>{const l=a.w.db.stock.FGT_LOT.at(-1);const count=a.w.db.stock.FGT_LOT.length;a.w.deleteLot('FGT_LOT',l.id);a.value('v42-reason','검증 취소');const input=a.w.document.getElementById('v42-reason');input.dispatchEvent(new a.w.Event('input'));a.w.document.getElementById('v42-confirm').click();assert.equal(a.w.db.stock.FGT_LOT.length,count);assert.equal(l.status,'VOID');assert.equal(l.remaining,0);assert.equal(a.w.db.txn.T_ADJ.at(-1).action,'VOID')});
 }finally{a.close()}
});
