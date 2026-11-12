// Response validation ("custom requirements") and the "Other" option for form questions.
// One file, two users: the Worker bundles it (CommonJS export) and the web pages load it as a plain <script> (global FormRules),
// so the browser shows the same errors the API enforces.
(function (root) {
  'use strict';

  // rule id -> [label, group, question types it applies to, how many values it takes]
  const RULES = {
    gt: ['Greater than', 'Number', ['short'], 1],
    gte: ['Greater than or equal to', 'Number', ['short'], 1],
    lt: ['Less than', 'Number', ['short'], 1],
    lte: ['Less than or equal to', 'Number', ['short'], 1],
    eq: ['Equal to', 'Number', ['short'], 1],
    neq: ['Not equal to', 'Number', ['short'], 1],
    between: ['Between', 'Number', ['short'], 2],
    notBetween: ['Not between', 'Number', ['short'], 2],
    isNumber: ['Is a number', 'Number', ['short'], 0],
    isWhole: ['Whole number', 'Number', ['short'], 0],
    contains: ['Contains', 'Text', ['short'], 1],
    notContains: ['Doesn’t contain', 'Text', ['short'], 1],
    email: ['Email address', 'Text', ['short'], 0],
    url: ['URL', 'Text', ['short'], 0],
    minLen: ['Minimum character count', 'Length', ['short', 'paragraph'], 1],
    maxLen: ['Maximum character count', 'Length', ['short', 'paragraph'], 1],
    matches: ['Matches pattern', 'Regular expression', ['short', 'paragraph'], 1],
    notMatches: ['Doesn’t match pattern', 'Regular expression', ['short', 'paragraph'], 1],
    atLeast: ['Select at least', 'Selections', ['checkboxes'], 1],
    atMost: ['Select at most', 'Selections', ['checkboxes'], 1],
    exactly: ['Select exactly', 'Selections', ['checkboxes'], 1],
  };
  const NUMERIC = ['gt', 'gte', 'lt', 'lte', 'eq', 'neq', 'between', 'notBetween'];
  const COUNTS = ['minLen', 'maxLen', 'atLeast', 'atMost', 'exactly'];
  const OTHER = '__other__';          // value the forms send for the "Other" choice before the typed text replaces it
  const OTHER_PREFIX = 'Other: ';     // how an "Other" answer is stored
  const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const URL_RE = /^https?:\/\/[^\s/$.?#][^\s]*$/i;

  /** Rules that make sense for a question type, for the editor's dropdown. */
  const rulesFor = (type) => Object.entries(RULES).filter(([, r]) => r[2].includes(type));

  /** Checks and normalises a rule from the editor. Returns null for "no rule"; throws Error with a readable message. */
  function clean(type, v) {
    if (!v || !v.rule) return null;
    const def = RULES[v.rule];
    if (!def || !def[2].includes(type)) return null; // a rule left over from another type is dropped
    const out = { rule: v.rule };
    const num = (x, what) => { const n = Number(String(x ?? '').trim()); if (String(x ?? '').trim() === '' || !Number.isFinite(n)) throw new Error(`${what} must be a number`); return n; };
    if (NUMERIC.includes(v.rule)) {
      out.a = num(v.a, def[3] === 2 ? 'The first value' : 'The value');
      if (def[3] === 2) { out.b = num(v.b, 'The second value'); if (out.b < out.a) [out.a, out.b] = [out.b, out.a]; }
    } else if (COUNTS.includes(v.rule)) {
      const n = num(v.a, 'The count');
      if (!Number.isInteger(n) || n < (v.rule.endsWith('Len') ? 1 : 0) || n > 4000) throw new Error('The count must be a whole number');
      out.a = n;
    } else if (v.rule === 'contains' || v.rule === 'notContains') {
      out.a = String(v.a ?? '').trim().slice(0, 100);
      if (!out.a) throw new Error('Enter the text to look for');
    } else if (v.rule === 'matches' || v.rule === 'notMatches') {
      out.a = String(v.a ?? '').trim().slice(0, 200);
      if (!out.a) throw new Error('Enter a pattern');
      try { new RegExp(out.a); } catch { throw new Error('The pattern is not a valid regular expression'); }
    }
    const msg = String(v.message ?? '').trim().slice(0, 200);
    if (msg) out.message = msg;
    return out;
  }

  /** The default error for a rule (used when the form author didn't write one). */
  function message(r) {
    switch (r.rule) {
      case 'gt': return `Must be a number greater than ${r.a}`;
      case 'gte': return `Must be a number greater than or equal to ${r.a}`;
      case 'lt': return `Must be a number less than ${r.a}`;
      case 'lte': return `Must be a number less than or equal to ${r.a}`;
      case 'eq': return `Must be ${r.a}`;
      case 'neq': return `Must be a number other than ${r.a}`;
      case 'between': return `Must be a number between ${r.a} and ${r.b}`;
      case 'notBetween': return `Must be a number outside ${r.a}–${r.b}`;
      case 'isNumber': return 'Must be a number';
      case 'isWhole': return 'Must be a whole number';
      case 'contains': return `Must contain “${r.a}”`;
      case 'notContains': return `Must not contain “${r.a}”`;
      case 'email': return 'Must be an email address';
      case 'url': return 'Must be a link starting with http:// or https://';
      case 'minLen': return `Must be at least ${r.a} characters`;
      case 'maxLen': return `Must be at most ${r.a} characters`;
      case 'matches': case 'notMatches': return 'Answer is not in the expected format';
      case 'atLeast': return `Select at least ${r.a}`;
      case 'atMost': return `Select at most ${r.a}`;
      case 'exactly': return `Select exactly ${r.a}`;
    }
    return 'Invalid answer';
  }

  /** null when the answer passes, otherwise the message to show. Only call for answered questions. */
  function check(q, value) {
    const r = q && q.validation;
    if (!r || !RULES[r.rule]) return null;
    const fail = r.message || message(r);
    const s = Array.isArray(value) ? '' : String(value ?? '').trim();
    if (NUMERIC.includes(r.rule) || r.rule === 'isNumber' || r.rule === 'isWhole') {
      const n = Number(s);
      if (s === '' || !Number.isFinite(n)) return fail;
      const ok = { gt: n > r.a, gte: n >= r.a, lt: n < r.a, lte: n <= r.a, eq: n === r.a, neq: n !== r.a, between: n >= r.a && n <= r.b, notBetween: n < r.a || n > r.b, isNumber: true, isWhole: Number.isInteger(n) }[r.rule];
      return ok ? null : fail;
    }
    switch (r.rule) {
      case 'contains': return s.toLowerCase().includes(String(r.a).toLowerCase()) ? null : fail;
      case 'notContains': return s.toLowerCase().includes(String(r.a).toLowerCase()) ? fail : null;
      case 'email': return EMAIL.test(s) ? null : fail;
      case 'url': return URL_RE.test(s) ? null : fail;
      case 'minLen': return s.length >= r.a ? null : fail;
      case 'maxLen': return s.length <= r.a ? null : fail;
      case 'matches': case 'notMatches': {
        let hit = false;
        try { hit = new RegExp(`^(?:${r.a})$`).test(s); } catch { return null; }
        return hit === (r.rule === 'matches') ? null : fail;
      }
      case 'atLeast': return (value || []).length >= r.a ? null : fail;
      case 'atMost': return (value || []).length <= r.a ? null : fail;
      case 'exactly': return (value || []).length === r.a ? null : fail;
    }
    return null;
  }

  const api = { RULES, rulesFor, clean, check, message, OTHER, OTHER_PREFIX };
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  else root.FormRules = api;
})(typeof self !== 'undefined' ? self : this);
