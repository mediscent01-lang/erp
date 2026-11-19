/**
 * SHIFTI ERP — Responsive Mobile/Tablet Patch
 * Usage: Add <script src="responsive-erp.js"></script> before </body>
 * Works with SHIFTI ERP v3.0 (mediscent01-lang.github.io/erp)
 */
(function() {
  'use strict';

  /* ── 1. Inject Responsive CSS ── */
  const css = `
    #mob-overlay{display:none;position:fixed;inset:0;background:rgba(15,23,42,.58);z-index:190;cursor:pointer;backdrop-filter:blur(2px);-webkit-backdrop-filter:blur(2px)}
    #mob-overlay.show{display:block}
    .hbg-btn{display:none;width:36px;height:36px;border:none;background:transparent;cursor:pointer;border-radius:7px;align-items:center;justify-content:center;color:#475569;flex-shrink:0;transition:background .15s;-webkit-tap-highlight-color:transparent}
    .hbg-btn:hover{background:#f1f5f9}
    .sidebar-close-btn{display:none;width:30px;height:30px;border:none;background:transparent;cursor:pointer;border-radius:6px;align-items:center;justify-content:center;color:#64748b;margin-left:auto;flex-shrink:0;-webkit-tap-highlight-color:transparent}
    .sidebar-close-btn:hover{background:#1e293b;color:#e2e8f0}
    #mob-bottom-nav{display:none;position:fixed;bottom:0;left:0;right:0;height:60px;background:#fff;border-top:1px solid #e2e8f0;z-index:100;box-shadow:0 -2px 16px rgba(15,23,42,.08)}
    .mbn-inner{height:100%;display:flex;align-items:center;justify-content:space-around;padding:0 4px}
    .mbn-btn{display:flex;flex-direction:column;align-items:center;gap:2px;cursor:pointer;border:none;background:transparent;color:#94a3b8;font-size:9px;font-weight:700;padding:6px 6px;border-radius:8px;transition:color .15s;text-transform:uppercase;letter-spacing:.04em;min-width:48px;line-height:1.2;-webkit-tap-highlight-color:transparent;font-family:'Pretendard',sans-serif}
    .mbn-btn:active{transform:scale(.92)}
    .mbn-btn.mbn-active{color:var(--accent)}
    .mbn-icon{font-size:19px;line-height:1}

    @media(max-width:767px){
      body{overflow-x:hidden}
      aside{position:fixed!important;top:0!important;left:0!important;bottom:0!important;height:100dvh!important;z-index:200;width:280px!important;transform:translateX(-100%);transition:transform .28s cubic-bezier(.4,0,.2,1);overflow-y:auto;-webkit-overflow-scrolling:touch}
      aside.mob-open{transform:translateX(0);box-shadow:8px 0 40px rgba(15,23,42,.4)}
      main{min-width:0!important}
      .hbg-btn{display:inline-flex!important}
      .sidebar-close-btn{display:inline-flex!important}
      .hdr-desktop{display:none!important}
      header{height:52px!important;padding:0 12px!important}
      #main-content{padding:14px 12px 72px 12px!important}
      #mob-bottom-nav{display:block!important}
      .scroll-card,.scroll-card-lg{overflow-x:auto!important;-webkit-overflow-scrolling:touch}
      .scroll-card table,.scroll-card-lg table{min-width:520px}
      .nav-item{padding:12px 16px!important;min-height:48px}
      .grid.grid-cols-2.md\\:grid-cols-4{grid-template-columns:repeat(2,1fr)!important}
      .grid.grid-cols-1.md\\:grid-cols-3{grid-template-columns:1fr!important}
      .grid.grid-cols-1.lg\\:grid-cols-3{grid-template-columns:1fr!important}
      .grid.grid-cols-1.lg\\:grid-cols-2{grid-template-columns:1fr!important}
      .grid.grid-cols-4{grid-template-columns:repeat(2,1fr)!important}
      .card .grid.grid-cols-2:not([class*="md:"]):not([class*="lg:"]){grid-template-columns:1fr!important}
      .doc-stage{padding:8px!important}
      .doc-page{width:100%!important;min-height:auto!important;padding:8mm 5mm!important}
      .doc-meta-grid{grid-template-columns:1fr!important}
      .doc-title{font-size:18px!important}
      .label-sheet{width:88%!important}
      .card-header{flex-wrap:wrap;gap:6px}
      /* 알림은 하단 메뉴에 가리지 않게 화면 위쪽 (2026-11-19) */
      #toast-container{top:60px!important;bottom:auto!important;left:12px!important;right:12px!important;max-width:none}
      #toast-container > *{font-size:15px!important}
      h2.text-lg{font-size:18px!important}
      .page-section h2{font-size:18px!important}

      /* ── 1단계 (2026-11-19): 휴대폰 글씨 최소 13~14px, 버튼 44px ──
         인쇄용 문서 미리보기(doc-page·라벨)는 A4 배치가 깨지므로 제외 */
      body{font-size:15px}
      :is(.text-\\[9px\\],.text-\\[10px\\],.text-\\[11px\\]):not(.doc-page *):not(.bt-doc-page *):not(.label-sheet *){font-size:13px!important;line-height:1.45!important}
      .text-xs:not(.doc-page *):not(.bt-doc-page *):not(.label-sheet *){font-size:14px!important;line-height:1.5!important}
      .text-sm:not(.doc-page *):not(.bt-doc-page *):not(.label-sheet *){font-size:15px!important}
      :is([style*="font-size:9px"],[style*="font-size:9.5px"],[style*="font-size:10px"],[style*="font-size:10.5px"],[style*="font-size:11px"],[style*="font-size:11.5px"],[style*="font-size: 10px"],[style*="font-size: 11px"]):not(.doc-page *):not(.bt-doc-page *):not(.label-sheet *){font-size:13px!important}
      :is([style*="font-size:12px"],[style*="font-size:12.5px"],[style*="font-size: 12px"]):not(.doc-page *):not(.bt-doc-page *):not(.label-sheet *){font-size:14px!important}
      #main-content table:not(.doc-page *) :is(td,th){font-size:14px!important}
      .btn{min-height:44px!important;font-size:15px!important}
      .btn-sm{min-height:40px!important;font-size:14px!important;padding-left:12px!important;padding-right:12px!important}
      .nav-item{font-size:15px!important}
      #main-content{padding-bottom:88px!important}
      #mob-bottom-nav{height:64px}
      .mbn-btn{font-size:12px;letter-spacing:0;text-transform:none;min-width:58px}
      .mbn-icon{font-size:22px}

      /* 휴대폰 머리글: 로고(누르면 홈) + 연결 상태만 한 줄로 (2026-11-19) */
      header > div.text-sm{display:none!important}
      #hdr-today{display:none!important}
      #cloud-status{white-space:nowrap!important;font-size:12px!important;max-width:46vw;overflow:hidden;text-overflow:ellipsis}
      #mob-brand{display:inline-flex!important}

      /* ── 2단계: 모바일 홈 「오늘 할 일」 (대시보드에서만) ── */
      body.on-dashboard #mob-home{display:block}
    }
    #mob-brand{display:none;align-items:center;gap:6px;border:none;background:transparent;padding:4px 6px;margin-right:auto;cursor:pointer;font-size:16px;font-weight:900;color:#0f172a;-webkit-tap-highlight-color:transparent}
    #mob-brand img{height:20px;width:auto;display:block}
    #mob-home{display:none;margin:0 0 16px}
    #mob-home .mh-title{font-size:18px;font-weight:900;color:#0f172a;margin:2px 2px 10px}
    #mob-home .mh-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
    #mob-home button{display:flex;flex-direction:column;align-items:flex-start;gap:4px;min-height:104px;padding:14px;border-radius:14px;border:1.5px solid #cbe3dc;background:#f0fdf9;text-align:left;-webkit-tap-highlight-color:transparent}
    #mob-home button:active{transform:scale(.97);background:#ccfbf1}
    #mob-home .mh-ico{font-size:28px;line-height:1}
    #mob-home b{font-size:17px;color:#0f172a}
    #mob-home small{font-size:13px;color:#475569;line-height:1.35}

    @media(min-width:768px) and (max-width:1023px){
      aside{width:52px!important;overflow:hidden;transition:width .22s ease}
      aside:hover{width:220px!important;box-shadow:4px 0 20px rgba(15,23,42,.25);z-index:150}
      .nav-label{display:none}
      aside:hover .nav-label{display:block}
      .nav-item{padding:9px 14px;justify-content:center;overflow:hidden}
      aside:hover .nav-item{justify-content:flex-start}
      .nav-item .nav-item-text{display:none;white-space:nowrap}
      aside:hover .nav-item .nav-item-text{display:inline}
      aside .p-3{padding:6px!important}
      aside .p-3 .text-xs{font-size:0}
      aside:hover .p-3 .text-xs{font-size:.75rem}
      aside .p-3 button{justify-content:center;padding:6px!important}
      aside:hover .p-3 button{justify-content:flex-start;padding:4px 10px!important}
      aside .h-14 > div > div:last-child{display:none}
      aside:hover .h-14 > div > div:last-child{display:block}
      #main-content{padding:16px}
      .scroll-card,.scroll-card-lg{overflow-x:auto;-webkit-overflow-scrolling:touch}
    }

    @media(hover:none) and (pointer:coarse){
      .input-field{min-height:40px;font-size:16px!important}
      select.input-field{font-size:16px!important}
      textarea.input-field{font-size:16px!important}
      .btn{min-height:44px}
      .btn-sm{min-height:40px}
    }
  `;

  const style = document.createElement('style');
  style.id = 'erp-responsive-css';
  style.textContent = css;
  document.head.appendChild(style);

  /* ── 2. DOM Injections (run after load) ── */
  function injectDOM() {
    // Overlay
    if (!document.getElementById('mob-overlay')) {
      const overlay = document.createElement('div');
      overlay.id = 'mob-overlay';
      overlay.addEventListener('click', closeSidebar);
      document.body.insertBefore(overlay, document.body.firstChild);
    }

    // Sidebar close button
    const aside = document.querySelector('aside');
    const asideHeader = aside ? aside.querySelector('.h-14') : null;
    if (asideHeader && !asideHeader.querySelector('.sidebar-close-btn')) {
      const closeBtn = document.createElement('button');
      closeBtn.className = 'sidebar-close-btn';
      closeBtn.title = '닫기';
      closeBtn.innerHTML = '✕';
      closeBtn.style.cssText = 'margin-left:auto;font-size:16px;font-weight:bold';
      closeBtn.addEventListener('click', closeSidebar);
      asideHeader.appendChild(closeBtn);
    }

    // Hamburger in header
    const header = document.querySelector('header');
    if (header && !header.querySelector('.hbg-btn')) {
      const hamburger = document.createElement('button');
      hamburger.className = 'hbg-btn';
      hamburger.title = '메뉴';
      hamburger.innerHTML = '☰';
      hamburger.style.fontSize = '20px';
      hamburger.addEventListener('click', toggleSidebar);
      header.insertBefore(hamburger, header.firstChild);

      // 휴대폰 머리글 로고: 누르면 홈(대시보드)
      const brand = document.createElement('button');
      brand.id = 'mob-brand'; brand.type = 'button'; brand.title = '홈(대시보드)으로'; brand.setAttribute('aria-label', '홈(대시보드)으로 이동');
      brand.innerHTML = window.MDS_LOGO ? '<img alt="MEDISCENT" src="' + window.MDS_LOGO + '" style="filter:invert(1) brightness(.2)">' : 'SHIFTI ERP';
      brand.addEventListener('click', () => window.mobGo('home'));
      hamburger.insertAdjacentElement('afterend', brand);

      // Wrap desktop buttons
      const desktopBtns = Array.from(header.querySelectorAll('button[onclick*="cloudLogin"], button[onclick*="cloudLogout"], button[onclick*="exportJSON"], button[onclick*="import-file"]'));
      if (desktopBtns.length && !header.querySelector('.hdr-desktop')) {
        const wrap = document.createElement('div');
        wrap.className = 'hdr-desktop flex items-center gap-1';
        const parent = desktopBtns[0].parentNode;
        parent.insertBefore(wrap, desktopBtns[0]);
        desktopBtns.forEach(btn => wrap.appendChild(btn));
      }
    }

    // Nav item text spans (for tablet icon-only mode)
    if (aside) {
      aside.querySelectorAll('.nav-item').forEach(item => {
        // Already has icon + text node, wrap text in span if needed
        item.childNodes.forEach(node => {
          if (node.nodeType === 3 && node.textContent.trim()) {
            const span = document.createElement('span');
            span.className = 'nav-item-text';
            span.textContent = node.textContent;
            item.replaceChild(span, node);
          }
        });
      });
    }

    // Mobile bottom nav
    if (!document.getElementById('mob-bottom-nav')) {
      const nav = document.createElement('div');
      nav.id = 'mob-bottom-nav';
      nav.innerHTML = `
        <div class="mbn-inner">
          <button class="mbn-btn mbn-active" id="mbn-dashboard" onclick="mobGo('home')"><span class="mbn-icon">🏠</span>홈</button>
          <button class="mbn-btn" id="mbn-sale" onclick="mobGo('sale')"><span class="mbn-icon">💰</span>판매</button>
          <button class="mbn-btn" id="mbn-stock" onclick="mobGo('stock')"><span class="mbn-icon">📦</span>재고</button>
          <button class="mbn-btn" id="mbn-qc" onclick="mobGo('qc')"><span class="mbn-icon">✅</span>검사</button>
          <button class="mbn-btn" id="mbn-menu" onclick="toggleSidebar()"><span class="mbn-icon">☰</span>더보기</button>
        </div>`;
      document.body.appendChild(nav);
    }

    // 모바일 홈 「오늘 할 일」: 매장에서 휴대폰으로 하는 일 4가지 (2026-11-19)
    const main = document.getElementById('main-content');
    if (main && !document.getElementById('mob-home')) {
      const home = document.createElement('div');
      home.id = 'mob-home';
      home.innerHTML = `
        <div class="mh-title">오늘 할 일</div>
        <div class="mh-grid">
          <button onclick="mobGo('sale')"><span class="mh-ico">💰</span><b>판매 기록</b><small>매장·택배 판매 수량 입력</small></button>
          <button onclick="mobGo('stock')"><span class="mh-ico">📦</span><b>재고 보기</b><small>공장·물류·매장 재고</small></button>
          <button onclick="mobGo('week')"><span class="mh-ico">📅</span><b>주간정산</b><small>한 주 생산·이관·판매 한번에</small></button>
          <button onclick="mobGo('qc')"><span class="mh-ico">✅</span><b>검사(QC)</b><small>완제품 합격·불합격 판정</small></button>
        </div>`;
      main.insertBefore(home, main.firstChild);
    }
    document.body.classList.toggle('on-dashboard', !!document.querySelector('#page-dashboard.active'));
  }

  /* 휴대폰 글씨 하한선 (2026-11-19): 모듈마다 10~12px 클래스가 따로 있어 CSS로 다 잡을 수 없다.
     지금 보이는 화면에서 13px 미만 글자만 13px로 올리고, 화면 폭이 넓어지면 원래대로 돌린다.
     인쇄 문서 미리보기(doc-page·라벨)와 하단 메뉴는 제외 */
  const FLOOR = 13, SKIP = '.doc-page, .bt-doc-page, .label-sheet, #mob-bottom-nav, svg, canvas';
  let floorTimer = null;
  function applyFontFloor() {
    const mobile = window.innerWidth < 768;
    document.querySelectorAll('[data-ff]').forEach(e => { if (!mobile) { e.style.removeProperty('font-size'); e.removeAttribute('data-ff'); } });
    if (!mobile) return;
    const scope = document.querySelector('.page-section.active') || document.getElementById('main-content');
    if (!scope) return;
    [scope, document.getElementById('mob-home')].filter(Boolean).forEach(root => root.querySelectorAll('*').forEach(e => {
      if (e.hasAttribute('data-ff') || e.closest(SKIP) || !e.offsetParent) return;
      if (![...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) return;
      if (parseFloat(getComputedStyle(e).fontSize) < FLOOR) { e.style.setProperty('font-size', FLOOR + 'px', 'important'); e.setAttribute('data-ff', '1'); }
    }));
  }
  function scheduleFloor() { clearTimeout(floorTimer); floorTimer = setTimeout(applyFontFloor, 120); }
  window.addEventListener('resize', scheduleFloor);
  document.addEventListener('DOMContentLoaded', () => {
    const mc = document.getElementById('main-content');
    if (mc && 'MutationObserver' in window) new MutationObserver(scheduleFloor).observe(mc, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    scheduleFloor();
  });

  /* 모바일 바로가기: 화면이 아직 없으면 가까운 기존 화면으로 */
  window.mobGo = function(key) {
    const has = id => !!document.getElementById('page-' + id);
    const go = id => { if (typeof window.goPage === 'function') window.goPage(id); };
    const tab = t => setTimeout(() => { if (typeof window.qlTab === 'function') window.qlTab(t); }, 60);
    if (key === 'home') go('dashboard');
    else if (key === 'sale') { if (has('quick-log')) { go('quick-log'); tab('sale'); } else go('t-sale'); }
    else if (key === 'week') { if (has('quick-log')) { go('quick-log'); tab('week'); } else go('dashboard'); }
    else if (key === 'stock') go(has('loc-stock') ? 'loc-stock' : 'stock');
    else if (key === 'qc') go('qc-prod');
    window.scrollTo(0, 0);
    const mc = document.getElementById('main-content'); if (mc) mc.scrollTop = 0;
  };

  /* ── 3. Sidebar toggle functions ── */
  window.toggleSidebar = function() {
    const a = document.querySelector('aside');
    const o = document.getElementById('mob-overlay');
    if (!a || !o) return;
    const open = a.classList.contains('mob-open');
    if (open) { a.classList.remove('mob-open'); o.classList.remove('show'); }
    else { a.classList.add('mob-open'); o.classList.add('show'); }
  };

  window.closeSidebar = function() {
    const a = document.querySelector('aside');
    const o = document.getElementById('mob-overlay');
    if (a) a.classList.remove('mob-open');
    if (o) o.classList.remove('show');
  };

  /* ── 4. Patch goPage ── */
  const MBN_MAP = { dashboard:'mbn-dashboard', stock:'mbn-stock', 'loc-stock':'mbn-stock', 'quick-log':'mbn-sale', 't-sale':'mbn-sale', 'qc-prod':'mbn-qc', 't-qc':'mbn-qc' };

  function patchGoPage() {
    const orig = window.goPage;
    if (!orig || orig._mobilePatchApplied) return;
    window.goPage = function(pageId) {
      if (window.innerWidth < 768) closeSidebar();
      // Update bottom nav active
      document.querySelectorAll('.mbn-btn').forEach(b => b.classList.remove('mbn-active'));
      const btnId = MBN_MAP[pageId];
      if (btnId) { const b = document.getElementById(btnId); if (b) b.classList.add('mbn-active'); }
      document.body.classList.toggle('on-dashboard', pageId === 'dashboard');
      const r = orig.apply(this, arguments);
      scheduleFloor();
      return r;
    };
    window.goPage._mobilePatchApplied = true;
  }

  /* ── 5. Swipe gesture ── */
  let swipeStartX = 0;
  document.addEventListener('touchstart', e => { swipeStartX = e.touches[0].clientX; }, { passive: true });
  document.addEventListener('touchend', e => {
    const dx = e.changedTouches[0].clientX - swipeStartX;
    const a = document.querySelector('aside');
    // Swipe right from left edge: open
    if (swipeStartX < 24 && dx > 50) { if (a) { a.classList.add('mob-open'); document.getElementById('mob-overlay')?.classList.add('show'); } }
    // Swipe left: close
    if (a && a.classList.contains('mob-open') && dx < -60) closeSidebar();
  }, { passive: true });

  /* ── 6. Table overflow: ensure all tables scroll ── */
  function fixTableOverflow() {
    if (window.innerWidth >= 768) return;
    document.querySelectorAll('.scroll-card, .scroll-card-lg').forEach(el => {
      el.style.overflowX = 'auto';
      el.style.webkitOverflowScrolling = 'touch';
    });
  }

  /* ── 7. Init ── */
  function init() {
    injectDOM();
    patchGoPage();
    fixTableOverflow();
    scheduleFloor();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
  window.addEventListener('load', () => { init(); fixTableOverflow(); });
  window.addEventListener('resize', fixTableOverflow);
  window.addEventListener('load', patchGoPage);

  // Re-patch after all scripts load (since goPage gets reassigned multiple times)
  setTimeout(patchGoPage, 500);
  setTimeout(patchGoPage, 1500);
  setTimeout(patchGoPage, 3000);

})();
