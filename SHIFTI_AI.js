(function(){
  'use strict';
  const AI_PAGE_ID = 'shifti-ai';

  function esc(v){ return String(v ?? '').replace(/[&<>"']/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s])); }
  function fmt(n){ return Number(n||0).toLocaleString('ko-KR'); }

  function ensurePage(){
    if(document.getElementById('page-'+AI_PAGE_ID)) return;
    const main = document.getElementById('main-content') || document.querySelector('main');
    if(!main) return;
    const sec = document.createElement('section');
    sec.id = 'page-'+AI_PAGE_ID;
    sec.className = 'page-section';
    sec.innerHTML = `
      <div class="space-y-4 max-w-5xl mx-auto">
        <div class="flex items-center justify-between">
          <div>
            <div class="text-[11px] font-bold tracking-[.15em] text-teal-600 uppercase">SHIFTI AI</div>
            <h2 class="text-xl font-black text-slate-900 mt-1">오늘 무엇을 해야 할까요?</h2>
            <p class="text-xs text-slate-500 mt-1">ERP 재고·수주·판매·안전재고를 기준으로 생산 우선순위를 계산합니다.</p>
          </div>
          <button class="btn btn-primary" onclick="window.shiftiAIRefresh()">오늘 생산량 계산</button>
        </div>

        <div id="shifti-ai-warnings"></div>

        <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div class="card p-4">
            <div class="text-[10px] text-slate-400 font-bold">오늘 권장 생산</div>
            <div id="shifti-ai-total" class="text-3xl font-black mt-1">-</div>
            <div class="text-xs text-slate-500 mt-1">ea</div>
          </div>
          <div class="card p-4">
            <div class="text-[10px] text-slate-400 font-bold">ERP 데이터 기준일</div>
            <div id="shifti-ai-source" class="text-lg font-black mt-1">-</div>
            <div id="shifti-ai-age" class="text-xs text-slate-500 mt-1">-</div>
          </div>
          <div class="card p-4">
            <div class="text-[10px] text-slate-400 font-bold">계산 방식</div>
            <div class="text-xs font-bold text-slate-700 mt-2 leading-5">주문 + 안전재고 + 판매속도<br>− QC OK 재고 − 생산예정</div>
          </div>
        </div>

        <div class="card overflow-hidden">
          <div class="card-header">
            <div>
              <div class="font-black">생산 추천</div>
              <div class="text-[10px] text-slate-400 mt-1">권장수량이 큰 순서</div>
            </div>
          </div>
          <div class="overflow-x-auto">
            <table>
              <thead><tr>
                <th>제품</th><th class="text-right">OK재고</th><th class="text-right">미출고주문</th><th class="text-right">안전재고</th><th class="text-right">최근판매</th><th class="text-right">14일예측</th><th class="text-right">권장생산</th><th>판정</th>
              </tr></thead>
              <tbody id="shifti-ai-table"><tr><td colspan="8" class="text-center py-8 text-slate-400">계산 버튼을 눌러주세요.</td></tr></tbody>
            </table>
          </div>
        </div>

        <div class="card p-4">
          <div class="font-black mb-3">빠른 명령</div>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-2">
            <button class="btn btn-secondary justify-start" onclick="window.shiftiAIRefresh()">오늘 몇 개 생산해야 돼?</button>
            <button class="btn btn-secondary justify-start" disabled title="Gmail 주문 자동수집 연결 후 활성화">오늘 주문 반영해줘 <span class="text-slate-400">(연결 예정)</span></button>
            <button class="btn btn-secondary justify-start" disabled title="견적/메일 연결 후 활성화">거래처 견적서 보내줘 <span class="text-slate-400">(연결 예정)</span></button>
            <button class="btn btn-secondary justify-start" disabled title="Telegram Bot 연결 후 활성화">월간 실적 텔레그램으로 보내줘 <span class="text-slate-400">(연결 예정)</span></button>
          </div>
        </div>
      </div>`;
    main.appendChild(sec);
  }

  function ensureNav(){
    if(document.querySelector('[data-shifti-ai-nav="1"]')) return;
    const aside = document.querySelector('aside');
    if(!aside) return;
    const nav = document.createElement('div');
    nav.className = 'nav-item';
    nav.dataset.shiftiAiNav = '1';
    nav.innerHTML = '<span>✦</span><span>SHIFTI AI</span>';
    nav.addEventListener('click', () => {
      if(typeof window.goPage === 'function') window.goPage(AI_PAGE_ID);
      else {
        document.querySelectorAll('.page-section').forEach(x=>x.classList.remove('active'));
        document.getElementById('page-'+AI_PAGE_ID)?.classList.add('active');
      }
      window.shiftiAIRefresh();
    });
    aside.appendChild(nav);
  }

  async function api(action){
    const url = (window.SB_URL || 'https://foctzlqkspneznevbkmp.supabase.co') + '/functions/v1/shifti-ai?action=' + encodeURIComponent(action);
    const key = window.SB_KEY;
    if(!key) throw new Error('ERP Supabase 키를 찾을 수 없습니다.');
    const r = await fetch(url, { headers: { apikey:key, Authorization:'Bearer '+key } });
    const data = await r.json().catch(()=>({}));
    if(!r.ok) throw new Error(data.message || data.error || ('HTTP '+r.status));
    return data;
  }

  window.shiftiAIRefresh = async function(){
    ensurePage();
    const tbody = document.getElementById('shifti-ai-table');
    if(tbody) tbody.innerHTML = '<tr><td colspan="8" class="text-center py-8 text-slate-400">계산 중...</td></tr>';
    try {
      const d = await api('daily-production');
      document.getElementById('shifti-ai-total').textContent = fmt(d.totalRecommendedQty);
      document.getElementById('shifti-ai-source').textContent = d.sourceUpdatedAt ? new Date(d.sourceUpdatedAt).toLocaleDateString('ko-KR') : '-';
      document.getElementById('shifti-ai-age').textContent = d.sourceAgeDays == null ? '기준일 확인 필요' : `${d.sourceAgeDays}일 전 데이터`;
      const warn = document.getElementById('shifti-ai-warnings');
      warn.innerHTML = (d.warnings||[]).map(w=>`<div class="card p-3 border-amber-200 bg-amber-50 text-amber-800 text-xs font-bold mb-2">⚠ ${esc(w)}</div>`).join('');
      tbody.innerHTML = (d.rows||[]).map(r => `<tr>
        <td><div class="font-bold">${esc(r.name)}</div><div class="text-[10px] text-slate-400">${esc(r.code)}</div></td>
        <td class="text-right">${fmt(r.stockOk)}</td>
        <td class="text-right">${fmt(r.openOrders)}</td>
        <td class="text-right">${fmt(r.safetyStock)}</td>
        <td class="text-right">${fmt(r.recentSalesQty)}</td>
        <td class="text-right">${fmt(r.forecastHorizonQty)}</td>
        <td class="text-right font-black ${r.recommendedQty>0?'text-teal-700':''}">${fmt(r.recommendedQty)}</td>
        <td><span class="badge-soft">${esc(r.priority)}</span></td>
      </tr>`).join('') || '<tr><td colspan="8" class="text-center py-8 text-slate-400">현재 생산 추천 없음</td></tr>';
    } catch(e){
      if(tbody) tbody.innerHTML = `<tr><td colspan="8" class="text-center py-8 text-red-500">${esc(e.message||e)}</td></tr>`;
    }
  };

  function boot(){ ensurePage(); ensureNav(); }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
  window.addEventListener('load', boot);
})();
