/**
 * ReefDeck Charts — lightweight canvas charting (no deps).
 * Smooth Catmull-Rom lines, gradient fills, glowing endpoints,
 * threshold bands, and an interactive hover tooltip + crosshair.
 */
window.ReefCharts = (function () {

  var FONT = "11px Inter, system-ui, sans-serif";

  function drawLineChart(canvas, opts) {
    var dpr = window.devicePixelRatio || 1;
    var rect = canvas.parentElement.getBoundingClientRect();
    var W = Math.max(rect.width - 32 || 600, 220);
    var H = 248;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';

    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    var PAD = { top: 22, right: 18, bottom: 46, left: 52 };
    var plotW = W - PAD.left - PAD.right;
    var plotH = H - PAD.top - PAD.bottom;

    var data = opts.data || [];
    if (data.length < 1) return;

    var vals = data.map(function (d) { return d.value; });
    var minV = Math.min.apply(null, vals);
    var maxV = Math.max.apply(null, vals);
    if (opts.thresholdMin != null) minV = Math.min(minV, opts.thresholdMin);
    if (opts.thresholdMax != null) maxV = Math.max(maxV, opts.thresholdMax);
    var range = maxV - minV || 1;
    minV -= range * 0.14; maxV += range * 0.14;
    var vRange = maxV - minV;

    var xScale = function (i) { return PAD.left + (data.length <= 1 ? plotW / 2 : (i / (data.length - 1)) * plotW); };
    var yScale = function (v) { return PAD.top + plotH - ((v - minV) / vRange) * plotH; };
    var color = opts.color || '#46d6e6';

    // threshold band
    if (opts.thresholdMin != null || opts.thresholdMax != null) {
      var tMin = opts.thresholdMin != null ? yScale(opts.thresholdMin) : PAD.top + plotH;
      var tMax = opts.thresholdMax != null ? yScale(opts.thresholdMax) : PAD.top;
      ctx.fillStyle = 'rgba(45, 212, 167, 0.06)';
      ctx.fillRect(PAD.left, tMax, plotW, tMin - tMax);
      ctx.setLineDash([3, 5]);
      ctx.strokeStyle = 'rgba(45, 212, 167, 0.30)';
      ctx.lineWidth = 1;
      [opts.thresholdMin, opts.thresholdMax].forEach(function (t, k) {
        if (t == null) return;
        var y = yScale(t);
        ctx.beginPath(); ctx.moveTo(PAD.left, y); ctx.lineTo(PAD.left + plotW, y); ctx.stroke();
      });
      ctx.setLineDash([]);
    }

    // horizontal grid + y labels
    var grid = 4;
    ctx.strokeStyle = 'rgba(150,184,214,0.07)';
    ctx.fillStyle = 'rgba(150,184,214,0.55)';
    ctx.font = FONT; ctx.textAlign = 'right';
    for (var g = 0; g <= grid; g++) {
      var gv = minV + (vRange * g / grid);
      var gy = yScale(gv);
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(PAD.left, gy); ctx.lineTo(PAD.left + plotW, gy); ctx.stroke();
      ctx.fillText(fmtNum(gv), PAD.left - 8, gy + 3.5);
    }

    // build points
    var pts = data.map(function (d, i) { return { x: xScale(i), y: yScale(d.value), date: d.date, value: d.value }; });

    // area fill (smooth)
    var grad = ctx.createLinearGradient(0, PAD.top, 0, PAD.top + plotH);
    grad.addColorStop(0, hexToRgba(color, 0.34));
    grad.addColorStop(1, hexToRgba(color, 0.01));
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    smooth(ctx, pts);
    ctx.lineTo(pts[pts.length - 1].x, PAD.top + plotH);
    ctx.lineTo(pts[0].x, PAD.top + plotH);
    ctx.closePath();
    ctx.fillStyle = grad; ctx.fill();

    // line with glow
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    smooth(ctx, pts);
    ctx.strokeStyle = color; ctx.lineWidth = 2.5; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.shadowColor = hexToRgba(color, 0.5); ctx.shadowBlur = 10;
    ctx.stroke();
    ctx.shadowBlur = 0;

    // points + out-of-range markers
    var photoDatesSet = opts.photoDates ? new Set(opts.photoDates) : null;
    pts.forEach(function (p, i) {
      var isOut = (opts.thresholdMin != null && p.value < opts.thresholdMin) ||
                  (opts.thresholdMax != null && p.value > opts.thresholdMax);
      var last = i === pts.length - 1;
      if (last) {
        ctx.beginPath(); ctx.arc(p.x, p.y, 9, 0, Math.PI * 2);
        ctx.fillStyle = hexToRgba(isOut ? '#ff5d6c' : color, 0.18); ctx.fill();
      }
      ctx.beginPath(); ctx.arc(p.x, p.y, last ? 4.5 : (isOut ? 4 : 3), 0, Math.PI * 2);
      ctx.fillStyle = isOut ? '#ff5d6c' : color; ctx.fill();
      if (last) { ctx.lineWidth = 2; ctx.strokeStyle = '#07101e'; ctx.stroke(); }

      // Photo marker: small camera dot above the data point
      if (photoDatesSet && photoDatesSet.has(data[i].date)) {
        ctx.beginPath(); ctx.arc(p.x, p.y - 12, 4, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(70,214,230,0.22)'; ctx.fill();
        ctx.beginPath(); ctx.arc(p.x, p.y - 12, 4, 0, Math.PI * 2);
        ctx.strokeStyle = '#46d6e6'; ctx.lineWidth = 1.5; ctx.stroke();
      }
    });

    // Dose markers — vertical dashed amber lines with ml label
    if (opts.doseDates && opts.doseDates.length > 0 && data.length >= 2) {
      var firstT = new Date(data[0].date + 'T12:00:00').getTime();
      var lastT = new Date(data[data.length - 1].date + 'T12:00:00').getTime();
      var tRange = lastT - firstT || 1;
      opts.doseDates.forEach(function(dm) {
        var t = new Date(dm.date + 'T12:00:00').getTime();
        if (t < firstT || t > lastT) return;
        var frac = (t - firstT) / tRange;
        var x = PAD.left + frac * plotW;
        var mlMatch = dm.text ? dm.text.match(/added ([\d.]+) mL/) : null;
        var doseLabel = mlMatch ? '+' + parseFloat(mlMatch[1]).toFixed(0) + ' mL' : 'Dose';
        ctx.save();
        // amber dashed line
        ctx.strokeStyle = 'rgba(245,158,11,0.9)';
        ctx.lineWidth = 2.5;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.moveTo(x, PAD.top);
        ctx.lineTo(x, PAD.top + plotH);
        ctx.stroke();
        ctx.setLineDash([]);
        // label background pill
        ctx.font = 'bold 9px Inter, system-ui, sans-serif';
        var lw = ctx.measureText(doseLabel).width + 8;
        ctx.fillStyle = 'rgba(245,158,11,0.18)';
        ctx.fillRect(x - lw / 2, PAD.top + 2, lw, 13);
        ctx.fillStyle = 'rgba(245,158,11,1.0)';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(doseLabel, x, PAD.top + 4);
        ctx.textBaseline = 'alphabetic';
        ctx.restore();
      });
    }

    // x labels — width-aware so they never collide on narrow (mobile) canvases.
    // Budget ~58px per "Jun 28" label; always show first & last, edge-align them.
    ctx.fillStyle = 'rgba(150,184,214,0.55)'; ctx.font = FONT;
    var fitLabels = Math.max(2, Math.floor(plotW / 58));
    var maxLabels = Math.min(data.length, fitLabels);
    var step = data.length <= maxLabels ? 1 : (data.length - 1) / (maxLabels - 1);
    var shown = {};
    for (var k2 = 0; k2 < maxLabels; k2++) {
      var i2 = Math.round(k2 * step);
      if (i2 > data.length - 1) i2 = data.length - 1;
      if (shown[i2]) continue;
      shown[i2] = 1;
      ctx.textAlign = i2 === 0 ? 'left' : (i2 === data.length - 1 ? 'right' : 'center');
      ctx.fillText(formatDateShort(data[i2].date), xScale(i2), H - 14);
    }

    attachHover(canvas, pts, { unit: opts.unit || '', plotTop: PAD.top, plotH: plotH, color: color, photosMap: opts.photosMap || null });
  }

  function smooth(ctx, pts) {
    if (pts.length < 3) {
      for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      return;
    }
    for (var j = 0; j < pts.length - 1; j++) {
      var p0 = pts[j - 1] || pts[j], p1 = pts[j], p2 = pts[j + 1], p3 = pts[j + 2] || p2;
      var c1x = p1.x + (p2.x - p0.x) / 6, c1y = p1.y + (p2.y - p0.y) / 6;
      var c2x = p2.x - (p3.x - p1.x) / 6, c2y = p2.y - (p3.y - p1.y) / 6;
      ctx.bezierCurveTo(c1x, c1y, c2x, c2y, p2.x, p2.y);
    }
  }

  function attachHover(canvas, pts, meta) {
    var wrap = canvas.parentElement;
    if (getComputedStyle(wrap).position === 'static') wrap.style.position = 'relative';
    var tip = wrap.querySelector('.chart-tooltip');
    var cross = wrap.querySelector('.chart-crosshair');
    if (!tip) { tip = document.createElement('div'); tip.className = 'chart-tooltip'; wrap.appendChild(tip); }
    if (!cross) { cross = document.createElement('div'); cross.className = 'chart-crosshair'; wrap.appendChild(cross); }

    canvas.onmousemove = function (e) {
      var rect = canvas.getBoundingClientRect();
      var mx = e.clientX - rect.left;
      var best = pts[0], bd = Infinity;
      pts.forEach(function (p) { var d = Math.abs(p.x - mx); if (d < bd) { bd = d; best = p; } });
      var offX = canvas.offsetLeft, offY = canvas.offsetTop;
      cross.style.left = (offX + best.x) + 'px';
      cross.style.top = (offY + meta.plotTop) + 'px';
      cross.style.height = meta.plotH + 'px';
      cross.style.opacity = '1';
      tip.style.left = (offX + best.x) + 'px';
      tip.style.top = (offY + best.y) + 'px';
      tip.style.opacity = '1';
      var photoHtml = '';
      if (meta.photosMap && meta.photosMap[best.date]) {
        photoHtml = '<img src="' + meta.photosMap[best.date] + '" class="chart-photo-tip-img" alt="log photo">';
      }
      tip.innerHTML = '<div class="tt-val" style="color:' + meta.color + '">' + best.value + ' ' + meta.unit +
        '</div><div class="tt-date">' + formatDateLong(best.date) + '</div>' + photoHtml;
    };
    canvas.onmouseleave = function () { tip.style.opacity = '0'; cross.style.opacity = '0'; };
  }

  function drawSparkline(canvas, data, color) {
    if (!data || data.length < 2) return;
    var dpr = window.devicePixelRatio || 1;
    var W = canvas.clientWidth || canvas.parentElement.offsetWidth || 80;
    var H = canvas.clientHeight || 28;
    canvas.width = W * dpr; canvas.height = H * dpr;
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    var vals = data.map(function (d) { return d.value; });
    var minV = Math.min.apply(null, vals), maxV = Math.max.apply(null, vals);
    var range = maxV - minV || 1; minV -= range * 0.18; maxV += range * 0.18;
    var vRange = maxV - minV;
    var pad = 3;
    var xS = function (i) { return (i / (data.length - 1)) * W; };
    var yS = function (v) { return pad + (H - pad * 2) - ((v - minV) / vRange) * (H - pad * 2); };

    var pts = vals.map(function (v, i) { return { x: xS(i), y: yS(v) }; });

    // area
    var grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, hexToRgba(color || '#46d6e6', 0.30));
    grad.addColorStop(1, hexToRgba(color || '#46d6e6', 0));
    ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y); smooth(ctx, pts);
    ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.closePath();
    ctx.fillStyle = grad; ctx.fill();

    // line
    ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y); smooth(ctx, pts);
    ctx.strokeStyle = color || '#46d6e6'; ctx.lineWidth = 1.75; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.stroke();

    // endpoint dot
    var lp = pts[pts.length - 1];
    ctx.beginPath(); ctx.arc(lp.x - 1, lp.y, 2.2, 0, Math.PI * 2);
    ctx.fillStyle = color || '#46d6e6'; ctx.fill();
  }

  function hexToRgba(hex, a) {
    var r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
  }
  function fmtNum(v) {
    var a = Math.abs(v);
    if (a >= 1000) return v.toFixed(0);
    if (a >= 10) return v.toFixed(1);
    return v.toFixed(2);
  }
  function formatDateShort(s) {
    try { var d = new Date(s + 'T12:00:00'); return ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()] + ' ' + d.getDate(); }
    catch (e) { return s ? s.slice(5, 10) : ''; }
  }
  function formatDateLong(s) {
    try { var d = new Date(s + 'T12:00:00'); return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }); }
    catch (e) { return s; }
  }

  // ---- Dual-Y-axis line chart (primary = gradient fill, secondary = dashed) ----
  function drawDualLineChart(canvas, opts) {
    var dpr = window.devicePixelRatio || 1;
    var rect = canvas.parentElement.getBoundingClientRect();
    var W = Math.max(rect.width - 32 || 600, 220);
    var H = 248;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';

    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    var PAD = { top: 28, right: 58, bottom: 46, left: 52 };
    var plotW = W - PAD.left - PAD.right;
    var plotH = H - PAD.top - PAD.bottom;

    var data = opts.data || [];
    var data2 = opts.data2 || [];
    if (data.length < 1) return;

    // Primary Y scale
    var vals = data.map(function(d) { return d.value; });
    var minV = Math.min.apply(null, vals);
    var maxV = Math.max.apply(null, vals);
    if (opts.thresholdMin != null) minV = Math.min(minV, opts.thresholdMin);
    if (opts.thresholdMax != null) maxV = Math.max(maxV, opts.thresholdMax);
    var range = maxV - minV || 1;
    minV -= range * 0.14; maxV += range * 0.14;
    var vRange = maxV - minV;
    var yScale1 = function(v) { return PAD.top + plotH - ((v - minV) / vRange) * plotH; };

    // Secondary Y scale
    var vals2 = data2.length > 0 ? data2.map(function(d) { return d.value; }) : [0];
    var minV2 = Math.min.apply(null, vals2);
    var maxV2 = Math.max.apply(null, vals2);
    var range2 = maxV2 - minV2 || 1;
    minV2 -= range2 * 0.14; maxV2 += range2 * 0.14;
    var vRange2 = maxV2 - minV2;
    var yScale2 = function(v) { return PAD.top + plotH - ((v - minV2) / vRange2) * plotH; };

    // X scale — union of both series dates (index-based for smooth curves)
    var dateMap = {};
    data.forEach(function(d) { dateMap[d.date] = 1; });
    data2.forEach(function(d) { dateMap[d.date] = 1; });
    var allDates = Object.keys(dateMap).sort();
    var xFromDate = function(dateStr) {
      var i = allDates.indexOf(dateStr);
      return PAD.left + (allDates.length <= 1 ? plotW / 2 : (i / (allDates.length - 1)) * plotW);
    };

    var color1 = opts.color || '#46d6e6';
    var color2 = opts.color2 || '#f59e0b';

    // Threshold band (primary only)
    if (opts.thresholdMin != null || opts.thresholdMax != null) {
      var tMin = opts.thresholdMin != null ? yScale1(opts.thresholdMin) : PAD.top + plotH;
      var tMax = opts.thresholdMax != null ? yScale1(opts.thresholdMax) : PAD.top;
      ctx.fillStyle = 'rgba(45, 212, 167, 0.06)';
      ctx.fillRect(PAD.left, tMax, plotW, tMin - tMax);
      ctx.setLineDash([3, 5]);
      ctx.strokeStyle = 'rgba(45, 212, 167, 0.30)';
      ctx.lineWidth = 1;
      [opts.thresholdMin, opts.thresholdMax].forEach(function(t) {
        if (t == null) return;
        var y = yScale1(t);
        ctx.beginPath(); ctx.moveTo(PAD.left, y); ctx.lineTo(PAD.left + plotW, y); ctx.stroke();
      });
      ctx.setLineDash([]);
    }

    // Horizontal grid + left Y labels (primary)
    var grid = 4;
    ctx.strokeStyle = 'rgba(150,184,214,0.07)';
    ctx.fillStyle = 'rgba(150,184,214,0.55)';
    ctx.font = FONT; ctx.textAlign = 'right';
    for (var g = 0; g <= grid; g++) {
      var gv = minV + (vRange * g / grid);
      var gy = yScale1(gv);
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(PAD.left, gy); ctx.lineTo(PAD.left + plotW, gy); ctx.stroke();
      ctx.fillText(fmtNum(gv), PAD.left - 8, gy + 3.5);
    }
    // Right Y labels (secondary)
    ctx.fillStyle = hexToRgba(color2, 0.70); ctx.textAlign = 'left';
    for (var g2 = 0; g2 <= grid; g2++) {
      var gv2 = minV2 + (vRange2 * g2 / grid);
      ctx.fillText(fmtNum(gv2), PAD.left + plotW + 8, yScale2(gv2) + 3.5);
    }

    // Primary series: gradient fill + solid line
    var pts1 = data.map(function(d) { return { x: xFromDate(d.date), y: yScale1(d.value), date: d.date, value: d.value }; });
    var grad = ctx.createLinearGradient(0, PAD.top, 0, PAD.top + plotH);
    grad.addColorStop(0, hexToRgba(color1, 0.34));
    grad.addColorStop(1, hexToRgba(color1, 0.01));
    ctx.beginPath();
    ctx.moveTo(pts1[0].x, pts1[0].y);
    smooth(ctx, pts1);
    ctx.lineTo(pts1[pts1.length - 1].x, PAD.top + plotH);
    ctx.lineTo(pts1[0].x, PAD.top + plotH);
    ctx.closePath();
    ctx.fillStyle = grad; ctx.fill();

    ctx.beginPath(); ctx.moveTo(pts1[0].x, pts1[0].y); smooth(ctx, pts1);
    ctx.strokeStyle = color1; ctx.lineWidth = 2.5; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.shadowColor = hexToRgba(color1, 0.5); ctx.shadowBlur = 10;
    ctx.stroke(); ctx.shadowBlur = 0;

    // Primary endpoint dot
    pts1.forEach(function(p, i) {
      var last = i === pts1.length - 1;
      if (last) {
        ctx.beginPath(); ctx.arc(p.x, p.y, 9, 0, Math.PI * 2);
        ctx.fillStyle = hexToRgba(color1, 0.18); ctx.fill();
      }
      ctx.beginPath(); ctx.arc(p.x, p.y, last ? 4.5 : 3, 0, Math.PI * 2);
      ctx.fillStyle = color1; ctx.fill();
      if (last) { ctx.lineWidth = 2; ctx.strokeStyle = '#07101e'; ctx.stroke(); }
    });

    // Secondary series: dashed line (no fill)
    if (data2.length >= 1) {
      var pts2 = data2.map(function(d) { return { x: xFromDate(d.date), y: yScale2(d.value), date: d.date, value: d.value }; });
      ctx.setLineDash([7, 4]);
      ctx.beginPath(); ctx.moveTo(pts2[0].x, pts2[0].y); smooth(ctx, pts2);
      ctx.strokeStyle = color2; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.shadowColor = hexToRgba(color2, 0.4); ctx.shadowBlur = 8;
      ctx.stroke(); ctx.shadowBlur = 0; ctx.setLineDash([]);
      // Endpoint dot
      var lp2 = pts2[pts2.length - 1];
      ctx.beginPath(); ctx.arc(lp2.x, lp2.y, 4, 0, Math.PI * 2);
      ctx.fillStyle = color2; ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = '#07101e'; ctx.stroke();
    }

    // Dose markers on dual chart
    if (opts.doseDates && opts.doseDates.length > 0 && allDates.length >= 2) {
      var firstDT = new Date(allDates[0] + 'T12:00:00').getTime();
      var lastDT = new Date(allDates[allDates.length - 1] + 'T12:00:00').getTime();
      var dtRange = lastDT - firstDT || 1;
      opts.doseDates.forEach(function(dm) {
        var t2 = new Date(dm.date + 'T12:00:00').getTime();
        if (t2 < firstDT || t2 > lastDT) return;
        var xd = PAD.left + ((t2 - firstDT) / dtRange) * plotW;
        var mlM = dm.text ? dm.text.match(/added ([\d.]+) mL/) : null;
        var dlabel = mlM ? '+' + parseFloat(mlM[1]).toFixed(0) + ' ml' : 'Dose';
        ctx.save();
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = 'rgba(245,158,11,0.70)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(xd, PAD.top + 14);
        ctx.lineTo(xd, PAD.top + plotH);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.font = '9px Inter, system-ui, sans-serif';
        ctx.fillStyle = 'rgba(245,158,11,0.90)';
        ctx.textAlign = 'center';
        ctx.fillText(dlabel, xd, PAD.top + 11);
        ctx.restore();
      });
    }

    // X labels
    ctx.fillStyle = 'rgba(150,184,214,0.55)'; ctx.font = FONT; ctx.setLineDash([]);
    var fitLabels = Math.max(2, Math.floor(plotW / 58));
    var maxLbls = Math.min(allDates.length, fitLabels);
    var step = allDates.length <= maxLbls ? 1 : (allDates.length - 1) / (maxLbls - 1);
    var shown = {};
    for (var k2 = 0; k2 < maxLbls; k2++) {
      var i2 = Math.round(k2 * step);
      if (i2 > allDates.length - 1) i2 = allDates.length - 1;
      if (shown[i2]) continue; shown[i2] = 1;
      ctx.textAlign = i2 === 0 ? 'left' : (i2 === allDates.length - 1 ? 'right' : 'center');
      ctx.fillText(formatDateShort(allDates[i2]), xFromDate(allDates[i2]), H - 14);
    }

    // Legend strip at top
    var legFont = '10px Inter, system-ui, sans-serif';
    ctx.font = legFont;
    ctx.setLineDash([]);
    ctx.fillStyle = color1; ctx.textAlign = 'left';
    ctx.fillRect(PAD.left, 9, 14, 3);
    ctx.fillText((opts.label || '') + (opts.unit ? ' (' + opts.unit + ')' : ''), PAD.left + 18, 14);
    var legend2X = PAD.left + 130;
    ctx.setLineDash([6, 3]);
    ctx.beginPath(); ctx.moveTo(legend2X, 11); ctx.lineTo(legend2X + 14, 11);
    ctx.strokeStyle = color2; ctx.lineWidth = 2; ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = color2;
    ctx.fillText((opts.label2 || '') + (opts.unit2 ? ' (' + opts.unit2 + ')' : ''), legend2X + 18, 14);

    attachHover(canvas, pts1, { unit: opts.unit || '', plotTop: PAD.top, plotH: plotH, color: color1 });
  }

  return { drawLineChart: drawLineChart, drawDualLineChart: drawDualLineChart, drawSparkline: drawSparkline };
})();
