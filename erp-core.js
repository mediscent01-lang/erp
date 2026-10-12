(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.ERPCore=api;
})(typeof window!=='undefined'?window:null,function(){
  'use strict';
  function kstDate(value=new Date()) {
    const d=new Date(value);
    if(!Number.isFinite(d.getTime()))throw new Error('올바른 날짜가 필요합니다.');
    return new Date(d.getTime()+9*3600000).toISOString().slice(0,10);
  }
  function addDays(iso,days){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(iso)||!Number.isInteger(Number(days)))throw new Error('날짜와 정수 일수를 확인하세요.');
    const d=new Date(iso+'T00:00:00Z');
    if(d.toISOString().slice(0,10)!==iso)throw new Error('존재하지 않는 날짜입니다.');
    d.setUTCDate(d.getUTCDate()+Number(days));return d.toISOString().slice(0,10);
  }
  function blockReason(lot,today=kstDate()){
    if(!lot)return 'LOT 없음';
    const status=String(lot.status||'').toUpperCase();
    if(status!=='OK')return '검사 미승인 또는 사용불가 ('+(status||'미판정')+')';
    if(lot.expDate&&lot.expDate<today)return '사용기한 경과';
    if(lot.matureUntil&&lot.matureUntil>today)return '숙성 미완료';
    if(lot.costStatus==='UNCONFIRMED')return '원가 미확인';
    return null;
  }
  function validate(db){
    if(!db||!db.master||!db.stock||!db.txn)throw new Error('ERP 데이터 구조가 올바르지 않습니다.');
    const issues=[];
    ['RAW_LOT','PACK_LOT','BULK_LOT','FGT_LOT'].forEach(k=>{
      if(!Array.isArray(db.stock[k]))throw new Error(k+' 배열이 필요합니다.');
      const ids=new Map();
      db.stock[k].forEach(l=>{
        if(l.id==null||l.id==='')issues.push({kind:'MISSING_ID',table:k,lotNo:l.lotNo});
        else if(ids.has(String(l.id)))issues.push({kind:'DUPLICATE_ID',table:k,id:l.id,lotNo:l.lotNo});
        else ids.set(String(l.id),true);
        if(!Number.isFinite(Number(l.remaining))||Number(l.remaining)<0)issues.push({kind:'INVALID_REMAINING',table:k,lotNo:l.lotNo});
      });
    });
    return issues;
  }
  function uniqueLot(db,key,id){
    const rows=(db.stock[key]||[]).filter(l=>String(l.id)===String(id));
    if(rows.length!==1)throw new Error(rows.length?'중복 LOT ID입니다. 데이터 점검 후 선택하세요.':'LOT를 찾을 수 없습니다.');
    return rows[0];
  }
  function preflightProduction(db,lines,need,today=kstDate()){
    const demand=new Map();
    lines.forEach(line=>{
      if(!Number.isInteger(Number(line.qty))||Number(line.qty)<=0)throw new Error('완제품 수량은 양의 정수여야 합니다.');
      const p=(db.master.M_PRODUCT||[]).find(p=>String(p.productId)===String(line.pid));
      if(!p||!(p.bom||[]).length)throw new Error('제품 BOM이 없습니다.');
      if(Number(p.fillWeight)>0){
        const pct=p.bom.filter(b=>b.type==='RAW').reduce((s,b)=>s+Number(b.qty),0);
        if(!Number.isFinite(pct)||Math.abs(pct-100)>0.001)throw new Error('원료 배합비 합계가 100%여야 합니다.');
      }
      p.bom.forEach(b=>{
        if(!['RAW','PACK'].includes(b.type))throw new Error('BOM 자재 유형을 확인하세요.');
        const q=Number(need(p,b,Number(line.qty)));
        if(!Number.isFinite(q)||q<0)throw new Error('BOM 소요량을 확인하세요.');
        const key=b.type+':'+b.itemId;
        demand.set(key,{type:b.type,itemId:b.itemId,qty:q+(demand.get(key)?.qty||0)});
      });
    });
    demand.forEach(req=>{
      const key=req.type==='RAW'?'RAW_LOT':'PACK_LOT',idKey=req.type==='RAW'?'rawId':'packId';
      const available=(db.stock[key]||[]).filter(l=>String(l[idKey])===String(req.itemId)&&!blockReason(l,today)).reduce((s,l)=>s+Number(l.remaining||0),0);
      (db.stock[key]||[]).filter(l=>String(l[idKey])===String(req.itemId)&&!blockReason(l,today)&&Number(l.remaining)>0).forEach(l=>uniqueLot(db,key,l.id));
      if(available+1e-6<req.qty)throw new Error(req.type+' '+req.itemId+' 가용자재 부족 ('+req.qty+' 필요 / '+available+' 가용)');
    });
    return true;
  }
  function formula(db,pid){
    const rows=(db.master.M_FORMULA||[]).filter(f=>String(f.productId)===String(pid)&&f.status==='APPROVED'&&f.approvedAt&&f.approvedBy);
    return rows.sort((a,b)=>String(b.approvedAt).localeCompare(String(a.approvedAt)))[0]||null;
  }
  return {kstDate,addDays,blockReason,validate,uniqueLot,preflightProduction,formula};
});
