/**
 * ReefDeck — Coral Growth Tracker (pure data module)
 * Phase 4: per-colony growth-over-time tracking.
 *
 * OBSERVATIONAL ONLY. This module records and returns what the user logged.
 * It NEVER produces coral-care advice (no "needs more light", "move it",
 * "dip it", no recommendations, no guidance). It only stores and orders
 * dated growth entries and computes derived facts (day counts, ordering).
 *
 * A coral:
 *   { id, tankId, name, species, source, dateAdded, placement,
 *     photos: [], growth: [ { date, note, photoId } ] }
 *
 * Growth entry: { date: 'YYYY-MM-DD', note: string, photoId: string|null }
 *
 * Reuses the app's local-date convention: dates are 'YYYY-MM-DD' strings and
 * day math uses noon local time to avoid DST/off-by-one issues (same as
 * todayStr()/daysBetween()/addDays() in app.js).
 *
 * Pure, no DOM. Node-guarded export so coral.test.js can require it.
 */
(function (exports) {
  'use strict';

  // ---- internal day math (local, noon-anchored — mirrors app.js) ----
  function parseLocalDate(s) {
    return new Date(s + 'T12:00:00');
  }
  function daysBetween(a, b) {
    return Math.round((parseLocalDate(b) - parseLocalDate(a)) / 86400000);
  }

  /**
   * Return a NEW coral with a growth entry added. The input coral is not
   * mutated (immutable update). Entries are kept date-sorted ascending
   * (oldest first). A missing/blank date is treated as today via the app's
   * local-date helper when called from the UI; here we default to '' which
   * the caller is expected to fill, but if blank we coerce to today so the
   * sort is always well-defined.
   *
   * The entry gets a stable id so the UI can key on it; photoId is optional
   * and references an id in the shared reefdeck_photos store.
   */
  function addGrowthEntry(coral, entry) {
    if (!coral || typeof coral !== 'object') {
      throw new Error('addGrowthEntry: coral is required');
    }
    if (!entry || typeof entry !== 'object') {
      throw new Error('addGrowthEntry: entry is required');
    }
    var date = (entry.date && String(entry.date).trim()) || todayStrLocal();
    var note = entry.note != null ? String(entry.note) : '';
    var photoId = entry.photoId != null ? String(entry.photoId) : null;

    var newEntry = {
      id: uidLocal(),
      date: date,
      note: note,
      photoId: photoId,
    };

    var growth = Array.isArray(coral.growth) ? coral.growth.slice() : [];
    growth.push(newEntry);
    // date-sorted ascending (oldest first); stable on equal dates by insertion
    growth.sort(function (a, b) {
      if (a.date < b.date) return -1;
      if (a.date > b.date) return 1;
      return 0;
    });

    var photos = Array.isArray(coral.photos) ? coral.photos.slice() : [];
    if (photoId && photos.indexOf(photoId) === -1) photos.push(photoId);

    return Object.assign({}, coral, { growth: growth, photos: photos });
  }

  /**
   * Ordered array of growth entries oldest -> newest, each enriched with
   * `daysSinceAdded` (whole days from the coral's dateAdded to the entry's
   * date, using local noon-anchored math — never negative: if an entry is
   * dated before dateAdded, 0 is returned). Returns a new array; the coral
   * is not mutated. Entries with no note and no photo are still included
   * (the user may log a date-only marker).
   */
  function growthTimeline(coral) {
    if (!coral || !Array.isArray(coral.growth)) return [];
    var added = coral.dateAdded || null;
    return coral.growth.slice().sort(function (a, b) {
      if (a.date < b.date) return -1;
      if (a.date > b.date) return 1;
      return 0;
    }).map(function (e) {
      var d = added ? daysBetween(added, e.date) : 0;
      return {
        id: e.id,
        date: e.date,
        note: e.note || '',
        photoId: e.photoId || null,
        daysSinceAdded: d < 0 ? 0 : d,
      };
    });
  }

  /**
   * Summary of a coral's growth tracking.
   *   entryCount  — number of growth entries
   *   daysTracked — whole days from the first entry to the latest entry
   *                 (0 when fewer than 2 entries)
   *   firstEntry  — oldest entry object (or null when none)
   *   latestEntry — newest entry object (or null when none)
   * Entries are returned as-is (no daysSinceAdded enrichment here — that's
   * growthTimeline's job); callers wanting enriched entries should use
   * growthTimeline(). first/latest are references into the sorted timeline.
   */
  function coralSummary(coral) {
    var timeline = growthTimeline(coral);
    var n = timeline.length;
    var daysTracked = 0;
    if (n >= 2) {
      daysTracked = daysBetween(timeline[0].date, timeline[n - 1].date);
      if (daysTracked < 0) daysTracked = 0;
    }
    return {
      entryCount: n,
      daysTracked: daysTracked,
      firstEntry: n > 0 ? timeline[0] : null,
      latestEntry: n > 0 ? timeline[n - 1] : null,
    };
  }

  // ---- local helpers (self-contained so this module is pure/testable) ----
  function todayStrLocal() {
    var d = new Date();
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }
  function uidLocal() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  // ---- exports (node-guarded) ----
  exports.addGrowthEntry = addGrowthEntry;
  exports.growthTimeline = growthTimeline;
  exports.coralSummary = coralSummary;
})(typeof module !== 'undefined' && module.exports ? module.exports : (window.CoralLib = window.CoralLib || {}));