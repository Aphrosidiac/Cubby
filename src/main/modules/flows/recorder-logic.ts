// Recorder, the pure half: the script injected into brand pages (as a plain string, so no bundler
// helper can leak into it) and the raw-event → FlowStep[] conversion. Unit-tested; the Playwright
// wiring lives in ./recorder.
import type { FlowStep } from '@shared/types'

/** What the page script (and the navigation listener) report. ts = Date.now() in either process. */
export type RawEvent =
  | { kind: 'click'; selector: string; label?: string; ts: number }
  | { kind: 'type'; selector: string; value: string; secret?: boolean; ts: number }
  | { kind: 'press'; key: string; ts: number }
  | { kind: 'upload'; selector: string; count: number; ts: number }
  | { kind: 'nav'; url: string; ts: number }

/** A navigation this soon after a click / key press was caused by it and is not its own step. */
export const NAV_AFTER_ACTION_MS = 1500

const SKIP_URL = /^(about:|chrome:|chrome-extension:|devtools:|data:|blob:|edge:)/i

/**
 * Turn raw events into steps: consecutive typing in one field becomes one `type` (last value wins),
 * navigations caused by a click / Enter are dropped, other top-frame navigations become `open_url`,
 * secret fields record no text, uploads record no paths.
 */
export function eventsToSteps(events: RawEvent[], newId: () => string, startUrl?: string | null): FlowStep[] {
  const steps: FlowStep[] = []
  const sorted = [...events].sort((a, b) => a.ts - b.ts)
  let lastActionTs = -Infinity
  let lastUrl = startUrl ?? null
  if (startUrl && !SKIP_URL.test(startUrl)) steps.push({ id: newId(), type: 'open_url', url: startUrl })
  for (const e of sorted) {
    const prev = steps[steps.length - 1]
    switch (e.kind) {
      case 'type': {
        const text = e.secret ? '' : e.value
        if (prev && prev.type === 'type' && prev.selector === e.selector) {
          prev.text = text
          break
        }
        steps.push({ id: newId(), type: 'type', selector: e.selector, text, clear: true, ...(e.secret ? { note: 'secret field — use Fill login' } : {}) })
        break
      }
      case 'click':
        steps.push({ id: newId(), type: 'click', selector: e.selector, ...(e.label ? { note: e.label } : {}) })
        lastActionTs = e.ts
        break
      case 'press':
        steps.push({ id: newId(), type: 'press', key: e.key })
        lastActionTs = e.ts
        break
      case 'upload':
        steps.push({ id: newId(), type: 'upload', selector: e.selector, files: [], note: `recorded uploads keep no file paths — pick the file${e.count === 1 ? '' : 's'}` })
        break
      case 'nav': {
        if (SKIP_URL.test(e.url) || e.url === lastUrl) break
        lastUrl = e.url
        if (e.ts - lastActionTs <= NAV_AFTER_ACTION_MS) break
        steps.push({ id: newId(), type: 'open_url', url: e.url })
        break
      }
    }
  }
  return steps
}

/**
 * Injected into every top-level brand page (init script + evaluate into open pages). Idempotent.
 * Reports through the exposed binding `__cubbyRecord`; `window.__cubbyRecOn` gates reporting so a
 * stopped recording goes quiet (bindings cannot be removed) and a new one can start again.
 * Selector order: data-testid-like attributes → aria-label → role + name → visible text → id →
 * name / placeholder → short CSS path. Password and one-time-code fields never send their value.
 */
export const RECORDER_SCRIPT = String.raw`(() => {
  if (window.top !== window) return;
  if (window.__cubbyRecInstalled) return;
  window.__cubbyRecInstalled = true;
  if (window.__cubbyRecOn === undefined) window.__cubbyRecOn = false;
  var send = function (e) {
    if (!window.__cubbyRecOn || typeof window.__cubbyRecord !== 'function') return;
    e.ts = Date.now();
    try { window.__cubbyRecord(e); } catch (_) {}
  };
  try {
    if (typeof window.__cubbyRecord === 'function') {
      window.__cubbyRecord({ kind: 'state' }).then(function (on) { if (typeof on === 'boolean') window.__cubbyRecOn = on; }, function () {});
    }
  } catch (_) {}

  var q = function (s) { return JSON.stringify(s); };
  var unique = function (sel) { try { return document.querySelectorAll(sel).length === 1; } catch (_) { return false; } };
  var clean = function (s) { return (s || '').replace(/\s+/g, ' ').trim(); };
  var TEST_ATTRS = ['data-testid', 'data-test-id', 'data-test', 'data-e2e', 'data-qa', 'data-cy'];
  var INTERACTIVE = 'a[href],button,input,select,textarea,summary,label,[role=button],[role=link],[role=tab],[role=menuitem],[role=menuitemradio],[role=option],[role=checkbox],[role=radio],[role=switch],[role=textbox],[role=combobox],[contenteditable=""],[contenteditable=true],[onclick]';

  var implicitRole = function (el) {
    var r = el.getAttribute('role');
    if (r) return r.split(' ')[0];
    var t = el.tagName.toLowerCase();
    if (t === 'a' && el.hasAttribute('href')) return 'link';
    if (t === 'button' || t === 'summary') return 'button';
    if (t === 'select') return 'combobox';
    if (t === 'textarea') return 'textbox';
    if (/^h[1-6]$/.test(t)) return 'heading';
    if (t === 'img' && el.getAttribute('alt')) return 'img';
    if (t === 'input') {
      var ty = (el.getAttribute('type') || 'text').toLowerCase();
      if (ty === 'button' || ty === 'submit' || ty === 'reset' || ty === 'image') return 'button';
      if (ty === 'checkbox') return 'checkbox';
      if (ty === 'radio') return 'radio';
      if (ty === 'range') return 'slider';
      if (ty === 'search') return 'searchbox';
      if (ty === 'email' || ty === 'tel' || ty === 'text' || ty === 'url' || ty === 'password' || ty === 'number') return 'textbox';
    }
    if (el.isContentEditable) return 'textbox';
    return null;
  };
  var accName = function (el) {
    var a = el.getAttribute('aria-label');
    if (a && clean(a)) return clean(a);
    var lb = el.getAttribute('aria-labelledby');
    if (lb) {
      var txt = lb.split(/\s+/).map(function (id) { var x = document.getElementById(id); return x ? x.innerText : ''; }).join(' ');
      if (clean(txt)) return clean(txt);
    }
    if (el.labels && el.labels.length) { var l = clean(el.labels[0].innerText); if (l) return l; }
    var t = el.tagName.toLowerCase();
    if (t === 'input' || t === 'textarea') {
      var ty = (el.getAttribute('type') || '').toLowerCase();
      if ((ty === 'submit' || ty === 'button') && el.value) return clean(el.value);
      return clean(el.getAttribute('placeholder') || el.getAttribute('title') || '');
    }
    var inner = clean(el.innerText || '');
    if (inner) return inner;
    var img = el.querySelector && el.querySelector('img[alt],svg[aria-label]');
    if (img) return clean(img.getAttribute('alt') || img.getAttribute('aria-label') || '');
    return clean(el.getAttribute('title') || '');
  };
  var cssPath = function (el) {
    var parts = [];
    var cur = el;
    for (var depth = 0; cur && cur.nodeType === 1 && depth < 5; depth++) {
      var t = cur.tagName.toLowerCase();
      if (cur.id && /^[A-Za-z][\w-]{0,40}$/.test(cur.id) && !/\d{3,}/.test(cur.id)) { parts.unshift('#' + CSS.escape(cur.id)); break; }
      var p = cur.parentElement;
      if (p) {
        var same = Array.prototype.filter.call(p.children, function (c) { return c.tagName === cur.tagName; });
        if (same.length > 1) t += ':nth-of-type(' + (same.indexOf(cur) + 1) + ')';
      }
      parts.unshift(t);
      var sel = parts.join(' > ');
      if (unique(sel)) return sel;
      cur = p;
      if (cur === document.body) { parts.unshift('body'); break; }
    }
    return parts.join(' > ');
  };
  var best = function (el) {
    var tag = el.tagName.toLowerCase();
    for (var i = 0; i < TEST_ATTRS.length; i++) {
      var v = el.getAttribute(TEST_ATTRS[i]);
      if (v) {
        var s1 = '[' + TEST_ATTRS[i] + '=' + q(v) + ']';
        if (unique(s1)) return s1;
        var s2 = tag + s1;
        if (unique(s2)) return s2;
      }
    }
    var aria = el.getAttribute('aria-label');
    if (aria && clean(aria)) {
      var s3 = tag + '[aria-label=' + q(aria) + ']';
      if (unique(s3)) return s3;
    }
    var role = implicitRole(el);
    var name = accName(el);
    if (role && name && name.length <= 80 && role !== 'textbox' && role !== 'searchbox') return 'role=' + role + '[name=' + q(name) + ' s]';
    var text = clean(el.innerText || '');
    if (text && text.length <= 60 && tag !== 'input' && tag !== 'textarea') return 'text=' + q(text);
    if (el.id && /^[A-Za-z][\w-]{0,60}$/.test(el.id) && !/\d{3,}/.test(el.id) && unique('#' + CSS.escape(el.id))) return '#' + CSS.escape(el.id);
    var nm = el.getAttribute('name');
    if (nm && unique(tag + '[name=' + q(nm) + ']')) return tag + '[name=' + q(nm) + ']';
    var ph = el.getAttribute('placeholder');
    if (ph && unique(tag + '[placeholder=' + q(ph) + ']')) return tag + '[placeholder=' + q(ph) + ']';
    if (role && name && name.length <= 80) return 'role=' + role + '[name=' + q(name) + ' s]';
    return cssPath(el);
  };
  var isTextField = function (el) {
    if (!el || el.nodeType !== 1) return false;
    var t = el.tagName.toLowerCase();
    if (t === 'textarea') return true;
    if (t === 'input') return !/^(button|submit|reset|checkbox|radio|file|image|range|color|hidden)$/i.test(el.getAttribute('type') || 'text');
    return !!el.isContentEditable;
  };
  var isSecret = function (el) {
    var ty = (el.getAttribute('type') || '').toLowerCase();
    var ac = (el.getAttribute('autocomplete') || '').toLowerCase();
    var hint = ((el.getAttribute('name') || '') + ' ' + (el.id || '')).toLowerCase();
    return ty === 'password' || ac.indexOf('one-time-code') >= 0 || ac.indexOf('current-password') >= 0 || ac.indexOf('new-password') >= 0 || /(otp|totp|2fa|passcode|password|verification.?code)/.test(hint);
  };
  var editableRoot = function (el) {
    var cur = el;
    while (cur && cur.parentElement && cur.parentElement.isContentEditable) cur = cur.parentElement;
    return cur;
  };

  document.addEventListener('click', function (ev) {
    if (!window.__cubbyRecOn || !ev.isTrusted) return;
    var t = ev.target && ev.target.nodeType === 1 ? ev.target : ev.target && ev.target.parentElement;
    if (!t) return;
    var el = t.closest(INTERACTIVE) || t;
    if (el.tagName.toLowerCase() === 'input' && (el.getAttribute('type') || '').toLowerCase() === 'file') return;
    if (isTextField(el) || el.tagName.toLowerCase() === 'select') return;
    var label = clean(el.innerText || el.getAttribute('aria-label') || '').slice(0, 60);
    send({ kind: 'click', selector: best(el), label: label || undefined });
  }, true);

  document.addEventListener('input', function (ev) {
    if (!window.__cubbyRecOn || !ev.isTrusted) return;
    var el = ev.target;
    if (!el || el.nodeType !== 1) return;
    if (el.isContentEditable) el = editableRoot(el);
    if (!isTextField(el)) return;
    var secret = isSecret(el);
    var value = secret ? '' : (el.isContentEditable ? (el.innerText || '') : (el.value || ''));
    send({ kind: 'type', selector: best(el), value: value, secret: secret || undefined });
  }, true);

  document.addEventListener('change', function (ev) {
    if (!window.__cubbyRecOn) return;
    var el = ev.target;
    if (el && el.tagName && el.tagName.toLowerCase() === 'input' && (el.getAttribute('type') || '').toLowerCase() === 'file') {
      send({ kind: 'upload', selector: best(el), count: el.files ? el.files.length : 0 });
    }
  }, true);

  document.addEventListener('keydown', function (ev) {
    if (!window.__cubbyRecOn || !ev.isTrusted) return;
    var tg = ev.target;
    // Enter inside a multi-line field is a newline (already in the typed text), not a submit
    if (tg && tg.nodeType === 1 && (tg.tagName.toLowerCase() === 'textarea' || tg.isContentEditable)) return;
    if (ev.key === 'Enter' && !ev.shiftKey && !ev.isComposing) send({ kind: 'press', key: 'Enter' });
  }, true);
})();`
