/* MEDISCENT ERP — 그래프 모션 (Core 테마 v2.1, 2026-11-20)
 * 데이터·계산은 건드리지 않고 Chart.js 그리기 애니메이션만 바꾼다.
 * - 막대·점이 왼쪽부터 차례로 자라남
 * - 화면을 열 때마다 그 화면의 그래프를 다시 그림
 * 동작 줄이기 설정이면 애니메이션을 끈다. 오류가 나도 ERP 동작에는 영향 없음. */
(function () {
  'use strict';
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function setupDefaults() {
    if (!window.Chart || !Chart.defaults) return false;
    try {
      if (reduce) { Chart.defaults.animation = false; return true; }
      Chart.defaults.animation = Object.assign({}, Chart.defaults.animation, {
        duration: 900,
        easing: 'easeOutQuart',
        delay: function (ctx) {
          if (ctx.type !== 'data' || ctx.mode !== 'default') return 0;
          return ctx.dataIndex * 70 + ctx.datasetIndex * 120;
        }
      });
      // 막대는 바닥에서 위로 자라도록
      Chart.defaults.animations = Object.assign({}, Chart.defaults.animations, {
        y: { from: function (ctx) { var s = ctx.chart.scales && ctx.chart.scales.y; return s ? s.getPixelForValue(0) : undefined; } }
      });
      Chart.defaults.transitions = Chart.defaults.transitions || {};
      Chart.defaults.transitions.active = { animation: { duration: 250 } };
    } catch (e) { /* 그래프 기본값 설정 실패는 무시 */ }
    return true;
  }

  function replay(section) {
    if (reduce || !window.Chart || !Chart.getChart) return;
    var canvases = section.querySelectorAll('canvas');
    for (var i = 0; i < canvases.length; i++) {
      try {
        var chart = Chart.getChart(canvases[i]);
        if (chart) { chart.reset(); chart.update(); }
      } catch (e) { /* 개별 그래프 실패는 무시 */ }
    }
  }

  function watchPages() {
    if (!window.MutationObserver) return;
    var obs = new MutationObserver(function (list) {
      for (var i = 0; i < list.length; i++) {
        var el = list[i].target;
        if (el.classList && el.classList.contains('page-section') && el.classList.contains('active') &&
            list[i].oldValue && list[i].oldValue.indexOf('active') === -1) {
          setTimeout(replay.bind(null, el), 120);
        }
      }
    });
    var sections = document.querySelectorAll('.page-section');
    for (var j = 0; j < sections.length; j++) {
      obs.observe(sections[j], { attributes: true, attributeFilter: ['class'], attributeOldValue: true });
    }
  }

  if (!setupDefaults()) window.addEventListener('load', setupDefaults);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watchPages);
  else watchPages();
})();
