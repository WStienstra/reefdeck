/**
 * ReefDeck — Consumption & Forecast insight
 * Pure vanilla JS, zero dependencies.
 *
 * Two exports:
 *   computeForecast(logs, paramDefs, thresholds) -> Array<ForecastResult>
 *   renderForecastCard(results, paramDefs)        -> htmlString
 *
 * Observational only. No dosing advice, no recommendations. ReefDeck shows
 * you trends — it does not give dosing advice. You decide what to do.
 *
 * Exported via a guarded module.exports so the test harness can require it
 * from Node; in the browser the functions attach to window.ReefForecast.
 */
(function (exports) {
  'use strict';

  // ---- Date helpers (mirror app.js: local-day based, no time component) ----
  function parseDateMs(dateStr) {
    return new Date(dateStr + 'T12:00:00').getTime();
  }
  function daysBetweenMs(aMs, bMs) {
    return Math.round((bMs - aMs) / 86400000);
  }

  // ---- Stats helpers (self-contained; no deps) ----
  function mean(a) { return a.reduce(function (s, x) { return s + x; }, 0) / a.length; }

  // Least-squares slope of value vs day-offset -> units per day.
  // Returns { slope, r2 } where r2 is the coefficient of determination.
  function linRegress(points) {
    var n = points.length;
    if (n < 2) return { slope: 0, r2: 0 };
    var t0 = points[0].t;
    var xs = points.map(function (p) { return daysBetweenMs(t0, p.t); });
    var ys = points.map(function (p) { return p.v; });
    var mx = mean(xs), my = mean(ys);
    var num = 0, den = 0;
    for (var i = 0; i < n; i++) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) * (xs[i] - mx); }
    var slope = den === 0 ? 0 : num / den;

    // R^2 = 1 - SSres/SStot. If SStot == 0 (all y equal), define R^2 = 0
    // (no variance to explain) — callers treat low R^2 as "stable".
    var ssRes = 0, ssTot = 0;
    for (var j = 0; j < n; j++) {
      var pred = my + slope * (xs[j] - mx);
      ssRes += (ys[j] - pred) * (ys[j] - pred);
      ssTot += (ys[j] - my) * (ys[j] - my);
    }
    var r2 = ssTot === 0 ? 0 : Math.max(0, 1 - ssRes / ssTot);
    return { slope: slope, r2: r2 };
  }

  // ---- Threshold resolution ----
  // thresholds shape from app.js: { [paramKey]: { min, max } } OR nested
  // { [tankId]: { [paramKey]: { min, max } } }. We accept the flat form
  // documented in the brief; callers pass getThresholds(tankId) output.
  function resolveThreshold(thresholds, key, paramDef) {
    var t = thresholds && thresholds[key];
    var min = (t && t.min != null) ? t.min : paramDef.defaultMin;
    var max = (t && t.max != null) ? t.max : paramDef.defaultMax;
    return { min: min, max: max };
  }

  /**
   * @typedef {Object} ForecastResult
   * @property {string} key              - param key (alk, ca, ...)
   * @property {string} status            - 'insufficient' | 'stable' | 'trending'
   * @property {string} [direction]       - 'down' | 'up'  (trending only)
   * @property {number} [ratePerDay]      - units/day       (trending only)
   * @property {number} [r2]              - 0..1 confidence  (trending & stable)
   * @property {number} [latestValue]    - last reading     (trending only)
   * @property {number} [thresholdValue] - min or max edge  (trending only)
   * @property {string} [thresholdEdge]  - 'min' | 'max'   (trending only)
   * @property {number} [daysToThreshold] - rounded days    (trending only)
   * @property {number} [pointCount]     - # distinct-day points (non-insufficient)
   * @property {number} [spanDays]       - days spanned    (non-insufficient)
   */

  /**
   * Compute consumption/forecast results for every param definition.
   *
   * @param {Array} logs        - [{ id, tankId, date:'YYYY-MM-DD', params:{alk:.., ca:.., ...}, notes }]
   *                             Sparse params: a reading may include only some keys.
   * @param {Array} paramDefs   - [{ key, label, unit, defaultMin, defaultMax, step, color }, ...]
   * @param {Object} thresholds - { [paramKey]: { min, max } } (flat; pass getThresholds(tankId) result)
   * @returns {Array<ForecastResult>}
   */
  function computeForecast(logs, paramDefs, thresholds) {
    thresholds = thresholds || {};
    return paramDefs.map(function (p) {
      // 1. Collect (date, value) points where params[key] != null, sorted ascending.
      var pts = [];
      for (var i = 0; i < logs.length; i++) {
        var v = logs[i].params && logs[i].params[p.key];
        if (v != null && !isNaN(+v)) {
          pts.push({ t: parseDateMs(logs[i].date), v: +v, date: logs[i].date });
        }
      }
      pts.sort(function (a, b) { return a.t - b.t; });

      // Deduplicate by day — keep the last value on a given day (same convention
      // as a logbook: the most recent entry for a day wins).
      var dedup = [];
      for (var k = 0; k < pts.length; k++) {
        if (dedup.length === 0 || dedup[dedup.length - 1].t !== pts[k].t) {
          dedup.push(pts[k]);
        } else {
          dedup[dedup.length - 1] = pts[k];
        }
      }

      // 2. Need >= 4 distinct-day points spanning >= 3 days.
      if (dedup.length < 4) return { key: p.key, status: 'insufficient' };
      var spanDays = daysBetweenMs(dedup[0].t, dedup[dedup.length - 1].t);
      if (spanDays < 3) return { key: p.key, status: 'insufficient' };

      // 3. Linear regression of value over days-since-first-reading.
      var fit = linRegress(dedup);
      var slope = fit.slope;   // units/day
      var r2 = fit.r2;

      var latestValue = dedup[dedup.length - 1].v;
      var th = resolveThreshold(thresholds, p.key, p);
      var bandWidth = Math.abs(th.max - th.min);

      // 4. Confidence / stable guards:
      //    - |slope| tiny relative to band (would take > 90 days to cross band) -> stable
      //    - R^2 < 0.4 -> stable
      var absSlope = Math.abs(slope);
      var daysToCrossBand = bandWidth > 0 ? bandWidth / (absSlope || 1e-12) : Infinity;
      if (r2 < 0.4 || daysToCrossBand > 90) {
        return {
          key: p.key,
          status: 'stable',
          ratePerDay: slope,
          r2: r2,
          latestValue: latestValue,
          pointCount: dedup.length,
          spanDays: spanDays
        };
      }

      // 5/6. Determine if trending toward a band edge.
      //    - slope < 0 -> heading down toward min (if latestValue > min)
      //    - slope > 0 -> heading up   toward max (if latestValue < max)
      var direction = slope < 0 ? 'down' : 'up';
      var thresholdEdge = direction === 'down' ? 'min' : 'max';
      var thresholdValue = thresholdEdge === 'min' ? th.min : th.max;

      // Trending AWAY from both edges -> stable.
      if (direction === 'down' && latestValue <= th.min) {
        return {
          key: p.key, status: 'stable', ratePerDay: slope, r2: r2,
          latestValue: latestValue, pointCount: dedup.length, spanDays: spanDays
        };
      }
      if (direction === 'up' && latestValue >= th.max) {
        return {
          key: p.key, status: 'stable', ratePerDay: slope, r2: r2,
          latestValue: latestValue, pointCount: dedup.length, spanDays: spanDays
        };
      }

      // daysToThreshold = (threshold - latestValue) / slope, rounded, only if positive.
      var raw = (thresholdValue - latestValue) / slope;
      if (raw <= 0) {
        // Already past the threshold in the trending direction (slope sign
        // disagrees with direction): treat as stable, no actionable trend.
        return {
          key: p.key, status: 'stable', ratePerDay: slope, r2: r2,
          latestValue: latestValue, pointCount: dedup.length, spanDays: spanDays
        };
      }
      var daysToThreshold = Math.round(raw);

      return {
        key: p.key,
        status: 'trending',
        direction: direction,
        ratePerDay: slope,
        r2: r2,
        latestValue: latestValue,
        thresholdValue: thresholdValue,
        thresholdEdge: thresholdEdge,
        daysToThreshold: daysToThreshold,
        pointCount: dedup.length,
        spanDays: spanDays
      };
    });
  }

  // ---- Rendering helpers ----
  function escHtml(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // Format a value to match the app's per-param step precision.
  function fmtValue(v, paramDef) {
    if (v == null || isNaN(v)) return '–';
    var step = paramDef.step;
    if (step && step < 1) {
      if (step < 0.01) return (+v).toFixed(3);
      if (step < 0.1)  return (+v).toFixed(2);
      return (+v).toFixed(1);
    }
    return Math.round(+v).toString();
  }

  // Format a per-day rate with a sign, e.g. "-0.4" / "+1.2".
  function fmtRate(v, paramDef) {
    var s = fmtValue(Math.abs(v), paramDef);
    var sign = v < 0 ? '-' : '+';
    return sign + s;
  }

  function paramByKey(paramDefs, key) {
    for (var i = 0; i < paramDefs.length; i++) {
      if (paramDefs[i].key === key) return paramDefs[i];
    }
    return { key: key, label: key, unit: '', color: '#888' };
  }

  /**
   * Render a Consumption & Forecast card matching the app's existing .card styling.
   * @param {Array<ForecastResult>} results
   * @param {Array} paramDefs  - same DEFAULT_PARAMS array passed to computeForecast
   * @returns {string} htmlString
   */
  function renderForecastCard(results, paramDefs) {
    paramDefs = paramDefs || [];
    var trending = [];
    var stable = [];
    var insufficient = [];
    for (var i = 0; i < results.length; i++) {
      var r = results[i];
      if (r.status === 'trending') trending.push(r);
      else if (r.status === 'stable') stable.push(r);
      else insufficient.push(r);
    }

    var trendingHtml = trending.map(function (r) {
      var p = paramByKey(paramDefs, r.key);
      var color = p.color || 'var(--text)';
      var rateAbs = fmtValue(Math.abs(r.ratePerDay), p);
      var dirWord = r.direction; // 'down' | 'up'
      var thresholdLabel = r.thresholdEdge === 'min' ? 'low threshold' : 'high threshold';
      var thresholdVal = fmtValue(r.thresholdValue, p);
      var unit = p.unit ? ' ' + p.unit : '';
      var latest = fmtValue(r.latestValue, p);

      // "Alkalinity is trending down at the observed rate of ~0.4 dKH/day.
      //  At this rate it would reach your low threshold (7.5 dKH) in about 6 days."
      return [
        '<div class="forecast-row forecast-trending">',
          '<span class="forecast-param" style="color:' + color + '">' + escHtml(p.label) + '</span>',
          '<div class="forecast-desc">',
            '<strong>' + escHtml(p.label) + '</strong> is trending <strong>' + dirWord + '</strong> ',
            'at the observed rate of ~' + rateAbs + unit + '/day. ',
            'Latest reading: ' + latest + unit + '. ',
            'At this rate it would reach your ' + thresholdLabel + ' (' + thresholdVal + unit + ') ',
            'in about <strong>' + r.daysToThreshold + ' day' + (r.daysToThreshold === 1 ? '' : 's') + '</strong>.',
          '</div>',
        '</div>'
      ].join('');
    }).join('');

    var stableHtml = '';
    if (stable.length > 0) {
      stableHtml = stable.map(function (r) {
        var p = paramByKey(paramDefs, r.key);
        var color = p.color || 'var(--text)';
        return [
          '<div class="forecast-row forecast-stable">',
            '<span class="forecast-param" style="color:' + color + '">' + escHtml(p.label) + '</span>',
            '<span class="forecast-desc forecast-dim">No actionable trend over ' + r.spanDays + ' days (' + r.pointCount + ' readings).</span>',
          '</div>'
        ].join('');
      }).join('');
    }

    var insufficientHtml = '';
    if (insufficient.length > 0) {
      insufficientHtml = insufficient.map(function (r) {
        var p = paramByKey(paramDefs, r.key);
        var color = p.color || 'var(--text)';
        return [
          '<div class="forecast-row forecast-insufficient">',
            '<span class="forecast-param" style="color:' + color + '">' + escHtml(p.label) + '</span>',
            '<span class="forecast-desc forecast-dim">Not enough data yet.</span>',
          '</div>'
        ].join('');
      }).join('');
    }

    var trendingNote = trending.length > 0
      ? '<div class="forecast-list">' + trendingHtml + '</div>'
      : '<p class="forecast-empty">No parameters are trending toward a threshold edge right now.</p>';

    return [
      '<div class="card forecast-card">',
        '<div class="card-title">Consumption &amp; Forecast</div>',
        trendingNote,
        stableHtml ? ('<div class="forecast-sub-list">' + stableHtml + '</div>') : '',
        insufficientHtml ? ('<div class="forecast-sub-list">' + insufficientHtml + '</div>') : '',
        '<p class="forecast-note">ReefDeck shows you trends — it does not give dosing advice. You decide what to do.</p>',
      '</div>'
    ].join('');
  }

  // ---- Exports ----
  exports.computeForecast = computeForecast;
  exports.renderForecastCard = renderForecastCard;
  // expose stats helpers for testing
  exports._linRegress = linRegress;
  exports._mean = mean;

})(typeof module !== 'undefined' && module.exports
    ? module.exports
    : (typeof window !== 'undefined' ? (window.ReefForecast = {}) : this));