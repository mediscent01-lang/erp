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
      #toast-container{bottom:68px!important;right:12px!important;max-width:calc(100vw - 24px)}
      h2.text-lg{font-size:14px!important}
      .page-section h2{font-size:14px!important}
    }

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
      .btn{min-height:38px}
      .btn-sm{min-height:34px}
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
          <button class="mbn-btn mbn-active" id="mbn-dashboard" onclick="goPage('dashboard')"><span class="mbn-icon">📊</span>대시보드</button>
          <button class="mbn-btn" id="mbn-stock" onclick="goPage('stock')"><span class="mbn-icon">📦</span>재고</button>
          <button class="mbn-btn" id="mbn-goodsin" onclick="goPage('t-goods-in')"><span class="mbn-icon">📥</span>입고</button>
          <button class="mbn-btn" id="mbn-sale" onclick="goPage('t-sale')"><span class="mbn-icon">🚚</span>출고</button>
          <button class="mbn-btn" id="mbn-menu" onclick="toggleSidebar()"><span class="mbn-icon">☰</span>메뉴</button>
        </div>`;
      document.body.appendChild(nav);
    }
  }

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
  const MBN_MAP = { dashboard:'mbn-dashboard', stock:'mbn-stock', 't-goods-in':'mbn-goodsin', 't-sale':'mbn-sale' };

  function patchGoPage() {
    const orig = window.goPage;
    if (!orig || orig._mobilePatchApplied) return;
    window.goPage = function(pageId) {
      if (window.innerWidth < 768) closeSidebar();
      // Update bottom nav active
      document.querySelectorAll('.mbn-btn').forEach(b => b.classList.remove('mbn-active'));
      const btnId = MBN_MAP[pageId];
      if (btnId) { const b = document.getElementById(btnId); if (b) b.classList.add('mbn-active'); }
      return orig.apply(this, arguments);
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
