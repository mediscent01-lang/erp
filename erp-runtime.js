(function(){
  'use strict';
  let finish;
  const state={ready:false,user:null,base:null,error:null};
  const loaded=new Promise(resolve=>{finish=resolve;});
  const runtime={state,loaded,
    async session(){
      if(!window.sbAuth)return null;
      try{const r=await window.sbAuth.auth.getSession();const s=r?.data?.session;state.user=s?.user||null;if(!s)state.ready=false;return s||null;}catch(e){state.user=null;state.ready=false;state.error=e.message;return null;}
    },
    complete(base,error){state.base=base;state.error=error||null;state.ready=!error&&!!state.user;finish(state);window.dispatchEvent(new CustomEvent('erp:loaded',{detail:state}));},
    requireReady(){if(state.ready)return true;if(window.toast)window.toast('로그인 후 클라우드 데이터를 정상적으로 불러와야 기록할 수 있습니다.','error');return false;}
  };
  window.ERPRuntime=runtime;
  window.productionProduct=function(id){
    const p=window.db?.master?.M_PRODUCT?.find(p=>String(p.productId)===String(id));
    if(!p)return null;
    const f=ERPCore.formula(window.db,id);
    return {...p,bom:JSON.parse(JSON.stringify(f?.bom||p.bom||[])),productionFormulaId:f?.id||null,productionFormulaVersion:f?.version||null};
  };
  window.approveFormula2=function(id){
    if(!runtime.requireReady())return false;
    const f=window.db.master.M_FORMULA.find(f=>String(f.id)===String(id));
    if(!f||f.status==='APPROVED')return false;
    const p=window.db.master.M_PRODUCT.find(p=>String(p.productId)===String(f.productId));
    const rows=f.bom||[];
    if(!p||!rows.some(r=>r.type==='RAW')||rows.some(r=>!Number.isFinite(Number(r.qty))||Number(r.qty)<0||!['RAW','PACK'].includes(r.type))){window.toast('처방과 제품 기준정보를 확인하세요.','error');return false;}
    if(Number(p.fillWeight)>0&&Math.abs(rows.filter(r=>r.type==='RAW').reduce((s,r)=>s+Number(r.qty),0)-100)>0.001){window.toast('원료 배합비 합계는 100%여야 합니다.','error');return false;}
    if(!window.confirm('이 처방을 생산 기준으로 승인할까요? 승인 후 수정·삭제할 수 없습니다.'))return false;
    f.status='APPROVED';f.approvedAt=new Date().toISOString();f.approvedBy=state.user.id;
    window.logEvent('생산 처방 승인: '+f.version);window.saveDB();window.goPage('formula-dev');return true;
  };
  // Cached drafts remain on disk for recovery but are never loaded before auth.
  document.addEventListener('click',function(ev){
    if(state.ready||ev.target.closest('#sb-login'))return;
    if(ev.target.closest('main button, main [onclick], aside button')){ev.preventDefault();ev.stopImmediatePropagation();runtime.requireReady();}
  },true);
})();
