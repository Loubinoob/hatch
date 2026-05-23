/**
 * Hatch SDK v3.4.0
 * Contextual paywall SDK — quiz, segmentation, 6 templates, auto-triggers, chameleon mode
 * Load via: <script async src="YOUR_HATCH_URL/sdk/sdk.js" data-key="pk_..."></script>
 */
;(function (global, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory()
  } else {
    global.hatch = factory()
  }
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this, function () {

  // Auto-detect the origin from the <script> tag that loaded this SDK.
  // Falls back to current page origin if detection fails.
  // This makes the SDK work on any deployment without hardcoding.
  var API_BASE = (function () {
    try {
      var self = document.currentScript
      if (!self) {
        var scripts = document.getElementsByTagName('script')
        for (var i = scripts.length - 1; i >= 0; i--) {
          if (scripts[i].src && scripts[i].src.indexOf('/sdk/sdk.js') !== -1) {
            self = scripts[i]; break
          }
        }
      }
      if (self && self.src) {
        var u = new URL(self.src)
        return u.origin + '/api'
      }
    } catch (e) {}
    return window.location.origin + '/api'
  })()
  var SESSION_KEY = 'hatch_session'
  var USER_KEY = 'hatch_user'
  var SHOWN_PREFIX = 'hatch_shown_'
  var VISIT_KEY = 'hatch_visits'

  var CURRENCY_SYMBOLS = { USD: '$', EUR: '€', GBP: '£', CAD: 'C$', AUD: 'A$', JPY: '¥', CHF: 'CHF ', BRL: 'R$' }
  var FONTS = {
    system: '-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
    serif: 'Georgia,"Times New Roman",serif',
    mono: 'ui-monospace,"Cascadia Code","Courier New",monospace',
  }

  var CHECKOUT_PENDING_KEY = 'hatch_checkout_pending'
  var SESSION_COUNT_KEY = 'hatch_session_count'
  var LANDING_PAGE_KEY = 'hatch_landing_page'

  var state = {
    apiKey: null,
    userId: null,
    userTraits: {},
    sessionId: null,
    subscription: null,
    activePaywall: null,
    activeQuiz: null,
    initialized: false,
    variantId: null,
    segmentHash: null,
    paywallShownAt: null,   // timestamp (ms) set at paywall_shown, used for dwell_ms
    hoverTimers: {},        // debounce timers for plan_hovered
    triggerCleanups: [],
    // Full context — built once at init, attached to every event
    context: null,
    landingPage: null,
    priceShownCents: null,  // set when paywall shown with dynamic pricing
    intervalShown: null,    // 'monthly' | 'yearly'
  }

  // ─── Utils ─────────────────────────────────────────────────────────────────

  function uid() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
    })
  }

  function esc(str) {
    return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  }

  function getSession() {
    try {
      var s = sessionStorage.getItem(SESSION_KEY)
      if (s) return JSON.parse(s)
    } catch (e) {}
    var id = uid()
    try { sessionStorage.setItem(SESSION_KEY, JSON.stringify({ id: id })) } catch (e) {}
    return { id: id }
  }

  function getStoredUser() {
    try {
      var u = localStorage.getItem(USER_KEY)
      return u ? JSON.parse(u) : null
    } catch (e) { return null }
  }

  function storeUser(userData) {
    try { localStorage.setItem(USER_KEY, JSON.stringify(userData)) } catch (e) {}
  }

  // ─── Segment signal helpers ─────────────────────────────────────────────────

  function getDevice() {
    var w = window.innerWidth
    if (w <= 768) return 'mobile'
    if (w <= 1024) return 'tablet'
    return 'desktop'
  }

  function getUtm(param) {
    try {
      return new URLSearchParams(window.location.search).get(param) || ''
    } catch (e) { return '' }
  }

  function getAllUtms() {
    try {
      var p = new URLSearchParams(window.location.search)
      return {
        utm_source:   p.get('utm_source')   || undefined,
        utm_medium:   p.get('utm_medium')   || undefined,
        utm_campaign: p.get('utm_campaign') || undefined,
        utm_content:  p.get('utm_content')  || undefined,
        utm_term:     p.get('utm_term')     || undefined,
      }
    } catch (e) { return {} }
  }

  function getReferrerDomain() {
    try {
      var ref = document.referrer
      if (!ref) return undefined
      return new URL(ref).hostname || undefined
    } catch (e) { return undefined }
  }

  function parseUserAgent() {
    var ua = (navigator.userAgent || '')
    var os = 'unknown', browser = 'unknown'
    // OS detection
    if (/iPhone|iPad|iPod/.test(ua)) os = 'iOS'
    else if (/Android/.test(ua)) os = 'Android'
    else if (/Windows/.test(ua)) os = 'Windows'
    else if (/Mac OS X/.test(ua)) os = 'macOS'
    else if (/Linux/.test(ua)) os = 'Linux'
    else if (/CrOS/.test(ua)) os = 'ChromeOS'
    // Browser detection (order matters)
    if (/Edg\//.test(ua)) browser = 'Edge'
    else if (/OPR\/|Opera/.test(ua)) browser = 'Opera'
    else if (/SamsungBrowser/.test(ua)) browser = 'Samsung'
    else if (/Chrome\//.test(ua) && !/Chromium/.test(ua)) browser = 'Chrome'
    else if (/Firefox\//.test(ua)) browser = 'Firefox'
    else if (/Safari\//.test(ua) && !/Chrome/.test(ua)) browser = 'Safari'
    else if (/MSIE|Trident/.test(ua)) browser = 'IE'
    return { os: os, browser: browser }
  }

  function getSessionCount() {
    try {
      var raw = localStorage.getItem(SESSION_COUNT_KEY)
      var n = raw ? (parseInt(raw, 10) || 0) : 0
      n++
      localStorage.setItem(SESSION_COUNT_KEY, String(n))
      return n
    } catch (e) { return 1 }
  }

  function hasReturned() {
    try {
      var raw = localStorage.getItem(VISIT_KEY)
      var data = raw ? JSON.parse(raw) : { count: 0 }
      data.count = (data.count || 0) + 1
      localStorage.setItem(VISIT_KEY, JSON.stringify(data))
      return data.count > 1
    } catch (e) { return false }
  }

  function getHourBucket() {
    var h = new Date().getHours()
    if (h < 6)  return 'night'
    if (h < 12) return 'morning'
    if (h < 18) return 'afternoon'
    return 'evening'
  }

  function buildContext(isReturning, sessionCount) {
    var now = new Date()
    var utms = getAllUtms()
    var uaParsed = parseUserAgent()
    return Object.assign({}, utms, {
      device_type:      getDevice(),
      os:               uaParsed.os,
      browser:          uaParsed.browser,
      viewport_w:       window.innerWidth,
      viewport_h:       window.innerHeight,
      referrer:         document.referrer || undefined,
      referrer_domain:  getReferrerDomain(),
      landing_page:     state.landingPage || window.location.href,
      language:         (navigator.language || 'en').slice(0, 5),
      hour_of_day:      now.getHours(),
      day_of_week:      now.getDay(),
      is_weekend:       now.getDay() === 0 || now.getDay() === 6,
      hour_bucket:      getHourBucket(),
      is_returning:     isReturning,
      returning:        isReturning,  // legacy alias
      session_count:    sessionCount,
    })
  }

  function buildSegmentQueryParams() {
    return '&device=' + getDevice() +
           '&utm_source=' + encodeURIComponent(getUtm('utm_source')) +
           '&returning=' + (getIsReturning() ? '1' : '0') +
           '&hour=' + getHourBucket()
  }

  // ─── Frequency / cooldown ──────────────────────────────────────────────────

  function canShowPaywall(config) {
    var tc = config.trigger_config || {}
    var freq = tc.frequency || 'once'
    if (freq === 'always') return true
    var key = SHOWN_PREFIX + config.id
    var raw = null
    try { raw = localStorage.getItem(key) } catch (e) {}
    if (!raw) return true
    var data = null
    try { data = JSON.parse(raw) } catch (e) { return true }
    var now = Date.now()
    if (freq === 'once') return false
    if (freq === 'daily')   return now - (data.lastShown || 0) >= 86400000
    if (freq === 'weekly')  return now - (data.lastShown || 0) >= 604800000
    if (freq === 'monthly') return now - (data.lastShown || 0) >= 2592000000
    var cooldownMs = ((tc.cooldown_hours || 24) * 3600000)
    return now - (data.lastShown || 0) >= cooldownMs
  }

  function markShown(paywallId) {
    var key = SHOWN_PREFIX + paywallId
    try {
      var raw = localStorage.getItem(key)
      var data = raw ? JSON.parse(raw) : { count: 0 }
      data.count = (data.count || 0) + 1
      data.lastShown = Date.now()
      localStorage.setItem(key, JSON.stringify(data))
    } catch (e) {}
  }

  function getPageCount(paywallId) {
    var key = SHOWN_PREFIX + 'pages_' + paywallId
    try {
      var raw = localStorage.getItem(key)
      var data = raw ? JSON.parse(raw) : { count: 0 }
      data.count = (data.count || 0) + 1
      localStorage.setItem(key, JSON.stringify(data))
      return data.count
    } catch (e) { return 1 }
  }

  // ─── Locale resolution ─────────────────────────────────────────────────────

  function applyLocale(config) {
    if (!config.auto_detect_locale) return config
    var lang = (navigator.language || 'en').slice(0, 2).toLowerCase()
    var locs = config.localizations || {}
    var overrides = locs[lang] || {}
    if (!Object.keys(overrides).length) return config
    var merged = {}
    for (var k in config) merged[k] = config[k]
    for (var k in overrides) if (overrides[k]) merged[k] = overrides[k]
    return merged
  }

  // ─── Triggers ──────────────────────────────────────────────────────────────

  function cleanupTriggers() {
    state.triggerCleanups.forEach(function(fn) { try { fn() } catch (e) {} })
    state.triggerCleanups = []
  }

  function setupTriggers(config, plans) {
    var tc = config.trigger_config || {}
    cleanupTriggers()

    if (tc.page_count > 0) {
      var count = getPageCount(config.id)
      if (count >= tc.page_count && canShowPaywall(config)) {
        setTimeout(function() { triggerAutoShow(config, plans) }, 500)
        return
      }
    }

    if (tc.exit_intent) {
      var onExit = function(e) {
        if (e.clientY <= 5 && canShowPaywall(config) && !state.activePaywall) {
          triggerAutoShow(config, plans)
        }
      }
      document.addEventListener('mouseleave', onExit)
      state.triggerCleanups.push(function() { document.removeEventListener('mouseleave', onExit) })
    }

    if (tc.time_delay > 0) {
      var timer = setTimeout(function() {
        if (canShowPaywall(config) && !state.activePaywall) triggerAutoShow(config, plans)
      }, tc.time_delay * 1000)
      state.triggerCleanups.push(function() { clearTimeout(timer) })
    }

    if (tc.scroll_depth > 0) {
      var onScroll = function() {
        var scrolled = window.scrollY || window.pageYOffset
        var docH = document.documentElement.scrollHeight - window.innerHeight
        var pct = docH > 0 ? (scrolled / docH) * 100 : 0
        if (pct >= tc.scroll_depth && canShowPaywall(config) && !state.activePaywall) {
          window.removeEventListener('scroll', onScroll)
          triggerAutoShow(config, plans)
        }
      }
      window.addEventListener('scroll', onScroll, { passive: true })
      state.triggerCleanups.push(function() { window.removeEventListener('scroll', onScroll) })
    }
  }

  function triggerAutoShow(config, plans) {
    if (state.activePaywall || state.activeQuiz) return
    var localizedConfig = applyLocale(config)
    renderPaywall(localizedConfig, plans)
  }

  // ─── Quiz rendering ────────────────────────────────────────────────────────

  function injectQuizStyles() {
    if (document.getElementById('hatch-quiz-styles')) return
    var style = document.createElement('style')
    style.id = 'hatch-quiz-styles'
    style.textContent = [
      '@keyframes hatchQuizIn{from{opacity:0;transform:translateY(20px) scale(0.97)}to{opacity:1;transform:translateY(0) scale(1)}}',
      '#hatch-quiz-overlay{position:fixed;inset:0;z-index:999999;background:rgba(0,0,0,0.7);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box}',
      '#hatch-quiz-modal{background:#0F0F12;border:1px solid rgba(255,255,255,0.1);border-radius:20px;max-width:440px;width:100%;padding:28px;box-shadow:0 25px 50px rgba(0,0,0,0.8);animation:hatchQuizIn 0.35s cubic-bezier(0.34,1.56,0.64,1);position:relative;box-sizing:border-box}',
      '.hatch-quiz-progress{display:flex;gap:4px;margin-bottom:20px}',
      '.hatch-quiz-dot{flex:1;height:3px;border-radius:2px;background:rgba(255,255,255,0.1);transition:background 0.3s}',
      '.hatch-quiz-dot.done{background:var(--hatch-accent,#6366F1)}',
      '.hatch-quiz-dot.active{background:rgba(99,102,241,0.5)}',
      '.hatch-quiz-q{font-size:18px;font-weight:700;color:#fff;margin:0 0 20px;line-height:1.35}',
      '.hatch-quiz-opts{display:flex;flex-direction:column;gap:8px}',
      '.hatch-quiz-opt{background:rgba(255,255,255,0.05);border:1.5px solid rgba(255,255,255,0.08);border-radius:12px;padding:12px 16px;text-align:left;color:rgba(255,255,255,0.75);font-size:14px;font-weight:500;cursor:pointer;transition:all 0.15s;width:100%}',
      '.hatch-quiz-opt:hover{border-color:var(--hatch-accent,#6366F1);background:rgba(99,102,241,0.1);color:#fff}',
      '.hatch-quiz-completion{text-align:center;padding:12px 0}',
      '.hatch-quiz-completion p{color:rgba(255,255,255,0.6);font-size:14px;margin:8px 0 0}',
      '.hatch-quiz-spinner{width:36px;height:36px;border:3px solid rgba(255,255,255,0.1);border-top-color:var(--hatch-accent,#6366F1);border-radius:50%;animation:hatchSpin 0.8s linear infinite;margin:0 auto 12px}',
      '@keyframes hatchSpin{to{transform:rotate(360deg)}}',
    ].join('')
    document.head.appendChild(style)
  }

  function renderQuiz(quiz, accentColor, onComplete) {
    injectQuizStyles()
    var questions = quiz.questions || []
    var currentIdx = 0
    var answers = {}

    var overlay = document.createElement('div')
    overlay.id = 'hatch-quiz-overlay'

    var modal = document.createElement('div')
    modal.id = 'hatch-quiz-modal'
    modal.style.setProperty('--hatch-accent', accentColor || '#6366F1')

    // Close button for quiz (tracks abandonment)
    var closeBtn = document.createElement('button')
    closeBtn.id = 'hatch-close'
    closeBtn.textContent = '✕'
    modal.appendChild(closeBtn)

    overlay.appendChild(modal)
    document.body.appendChild(overlay)
    state.activeQuiz = overlay

    track('quiz_started', { question_count: questions.length })

    // Allow closing the quiz
    overlay.addEventListener('click', function(e) {
      var t = e.target
      if (t.id === 'hatch-close' || (t.closest && t.closest('#hatch-close'))) {
        var lastQ = questions[currentIdx] || questions[questions.length - 1]
        track('quiz_abandoned', { last_question_id: lastQ ? lastQ.id : null, answered_count: currentIdx })
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay)
        state.activeQuiz = null
      }
    })

    function showQuestion(idx) {
      var q = questions[idx]
      if (!q) {
        showCompletion()
        return
      }

      var progressHtml = '<div class="hatch-quiz-progress">'
      for (var i = 0; i < questions.length; i++) {
        var cls = i < idx ? 'done' : (i === idx ? 'active' : '')
        progressHtml += '<div class="hatch-quiz-dot ' + cls + '"></div>'
      }
      progressHtml += '</div>'

      var optsHtml = '<div class="hatch-quiz-opts">'
      ;(q.options || []).forEach(function(opt) {
        optsHtml += '<button class="hatch-quiz-opt" data-value="' + esc(opt.value) + '">' + esc(opt.label) + '</button>'
      })
      optsHtml += '</div>'

      modal.innerHTML = progressHtml +
        '<p class="hatch-quiz-q">' + esc(q.question) + '</p>' +
        optsHtml

      modal.querySelectorAll('.hatch-quiz-opt').forEach(function(btn) {
        btn.addEventListener('click', function() {
          var answer = btn.getAttribute('data-value')
          answers[q.id] = answer
          track('quiz_question_answered', { question_id: q.id, answer: answer, question_index: idx })
          currentIdx++
          showQuestion(currentIdx)
        })
      })
    }

    function showCompletion() {
      track('quiz_completed', { answer_count: Object.keys(answers).length })
      var msg = quiz.completion_message || 'Finding the best plan for you…'
      modal.innerHTML = '<div class="hatch-quiz-completion">' +
        '<div class="hatch-quiz-spinner"></div>' +
        '<p class="hatch-quiz-q" style="padding-right:0">' + esc(msg) + '</p>' +
        '</div>'
      setTimeout(function() {
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay)
        state.activeQuiz = null
        onComplete(answers)
      }, 1200)
    }

    showQuestion(0)
  }

  // ─── Chameleon: host app theme detection ──────────────────────────────────

  function getEffectiveBackground(el) {
    var node = el
    while (node && node !== document.documentElement) {
      var bg = window.getComputedStyle(node).backgroundColor
      if (bg && bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)') return bg
      node = node.parentElement
    }
    return 'rgb(255,255,255)'
  }

  function relativeLuminance(rgbStr) {
    var m = (rgbStr || '').match(/[\d.]+/g)
    if (!m || m.length < 3) return 1
    var r = +m[0] / 255, g = +m[1] / 255, b = +m[2] / 255
    var f = function (c) { return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4) }
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
  }

  function rgbToHsl(rgbStr) {
    var m = (rgbStr || '').match(/[\d.]+/g)
    if (!m || m.length < 3) return [0, 0, 50]
    var r = +m[0] / 255, g = +m[1] / 255, b = +m[2] / 255
    var max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, s = 0, h = 0
    if (max !== min) {
      s = l > 0.5 ? (max - min) / (2 - max - min) : (max - min) / (max + min)
      switch (max) {
        case r: h = ((g - b) / (max - min) + (g < b ? 6 : 0)) / 6; break
        case g: h = ((b - r) / (max - min) + 2) / 6; break
        case b: h = ((r - g) / (max - min) + 4) / 6; break
      }
    }
    return [h * 360, s * 100, l * 100]
  }

  function isColorful(c) {
    if (!c || c === 'transparent' || c === 'rgba(0, 0, 0, 0)') return false
    var hsl = rgbToHsl(c)
    return hsl[1] > 20 && hsl[2] > 15 && hsl[2] < 90
  }

  function detectAccentColor() {
    try {
      var root = window.getComputedStyle(document.documentElement)
      var cssVars = ['--primary', '--accent', '--brand', '--color-primary', '--primary-color', '--theme-primary']
      for (var i = 0; i < cssVars.length; i++) {
        var v = root.getPropertyValue(cssVars[i]).trim()
        if (v && isColorful(normalizeColor(v))) return normalizeColor(v)
      }
      var els = document.querySelectorAll('button, a[href], [role="button"], .btn, [class*="btn"]')
      var counts = {}
      for (var j = 0; j < Math.min(els.length, 60); j++) {
        var s = window.getComputedStyle(els[j])
        var candidates = [s.backgroundColor, s.color, s.borderColor]
        for (var k = 0; k < candidates.length; k++) {
          var c = candidates[k]
          if (isColorful(c)) { counts[c] = (counts[c] || 0) + 1 }
        }
      }
      var best = null, bestScore = 0
      for (var col in counts) {
        var hsl = rgbToHsl(col)
        var score = counts[col] * (hsl[1] / 100)
        if (score > bestScore) { bestScore = score; best = col }
      }
      return best
    } catch (e) { return null }
  }

  function normalizeColor(c) {
    if (!c) return null
    // If already rgb()/rgba() string, return as-is
    if (/^rgb/.test(c)) return c
    // hex or named — create temp element to resolve
    try {
      var tmp = document.createElement('div')
      tmp.style.color = c
      document.body.appendChild(tmp)
      var computed = window.getComputedStyle(tmp).color
      document.body.removeChild(tmp)
      return computed
    } catch (e) { return null }
  }

  function detectBorderRadius() {
    try {
      var els = document.querySelectorAll('button, [role="button"], .btn, input[type="submit"]')
      var radii = []
      for (var i = 0; i < Math.min(els.length, 20); i++) {
        var r = parseFloat(window.getComputedStyle(els[i]).borderRadius)
        if (!isNaN(r)) radii.push(r)
      }
      if (!radii.length) return null
      radii.sort(function (a, b) { return a - b })
      var median = radii[Math.floor(radii.length / 2)]
      return Math.min(24, Math.max(4, median)) + 'px'
    } catch (e) { return null }
  }

  function detectHostTheme() {
    var theme = { isDark: false, font: null, accent: null, radius: null, surfaceBg: null, textColor: null }
    try {
      var bodyStyle = window.getComputedStyle(document.body)
      theme.font = bodyStyle.fontFamily || null
      var bg = getEffectiveBackground(document.body)
      var lum = relativeLuminance(bg)
      theme.isDark = lum < 0.4
      theme.surfaceBg = bg
      theme.textColor = theme.isDark ? '#FFFFFF' : '#0A0A0B'
      theme.accent = detectAccentColor()
      theme.radius = detectBorderRadius()
    } catch (e) {}
    return theme
  }

  // Ensure WCAG AA contrast ratio >= 4.5 between text and background
  function contrastRatio(lum1, lum2) {
    var l1 = Math.max(lum1, lum2), l2 = Math.min(lum1, lum2)
    return (l1 + 0.05) / (l2 + 0.05)
  }

  // Apply chameleon overrides to a config object (returns new config, never mutates)
  function applyChameleon(config) {
    try {
      var theme = detectHostTheme()
      var c = Object.assign({}, config)

      if (config.adapt_font !== false && theme.font) {
        c._chameleon_font = theme.font
      }

      if (config.adapt_colors !== false) {
        if (theme.accent) {
          // Validate contrast against modal surface
          var surfaceLum = relativeLuminance(theme.isDark ? 'rgb(30,30,35)' : 'rgb(255,255,255)')
          var accentLum = relativeLuminance(theme.accent)
          if (contrastRatio(accentLum, surfaceLum) >= 2.5) {
            c._chameleon_accent = theme.accent
          }
        }
        c._chameleon_dark = theme.isDark
        c._chameleon_surface = theme.surfaceBg
        c._chameleon_text = theme.textColor
      }

      if (config.adapt_radius !== false && theme.radius) {
        c._chameleon_radius = theme.radius
      }

      return c
    } catch (e) {
      return config // graceful degradation
    }
  }

  // ─── Style injection ────────────────────────────────────────────────────────

  function injectStyles() {
    if (document.getElementById('hatch-styles')) return
    var style = document.createElement('style')
    style.id = 'hatch-styles'
    style.textContent = [
      '@keyframes hatchFadeIn{from{opacity:0}to{opacity:1}}',
      '@keyframes hatchSlideUp{from{opacity:0;transform:translateY(32px) scale(0.96)}to{opacity:1;transform:translateY(0) scale(1)}}',
      '@keyframes hatchSlideRight{from{opacity:0;transform:translateX(100%)}to{opacity:1;transform:translateX(0)}}',
      '@keyframes hatchSlideUpSheet{from{opacity:0;transform:translateY(100%)}to{opacity:1;transform:translateY(0)}}',
      '@keyframes hatchSlideInCorner{from{opacity:0;transform:translateY(16px) scale(0.95)}to{opacity:1;transform:translateY(0) scale(1)}}',
      '@keyframes hatchZoomIn{from{opacity:0;transform:scale(0.9)}to{opacity:1;transform:scale(1)}}',
      '#hatch-overlay{position:fixed;inset:0;z-index:999998;display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box;animation:hatchFadeIn 0.2s ease}',
      '#hatch-modal{background:#0F0F12;border:1px solid rgba(255,255,255,0.1);border-radius:20px;max-width:480px;width:100%;max-height:90vh;overflow-y:auto;box-shadow:0 25px 50px -12px rgba(0,0,0,0.8);position:relative;box-sizing:border-box;padding:28px}',
      '.hatch-fullscreen{width:100%;height:100%;border-radius:0;max-width:none;max-height:none;display:flex;flex-direction:row;padding:0;overflow:hidden}',
      '.hatch-fs-left{flex:1;padding:48px 40px;overflow-y:auto;display:flex;flex-direction:column;justify-content:center;border-right:1px solid rgba(255,255,255,0.06)}',
      '.hatch-fs-right{width:360px;flex-shrink:0;padding:40px 32px;overflow-y:auto;background:rgba(255,255,255,0.02);display:flex;flex-direction:column;justify-content:center}',
      '.hatch-slide-in{position:fixed;bottom:20px;right:20px;width:288px;background:#0F0F12;border:1px solid rgba(255,255,255,0.12);border-radius:16px;padding:20px;box-shadow:0 16px 40px rgba(0,0,0,0.6);animation:hatchSlideInCorner 0.35s cubic-bezier(0.34,1.56,0.64,1);box-sizing:border-box;max-height:85vh;overflow-y:auto}',
      '.hatch-bottom-sheet{position:fixed;bottom:0;left:0;right:0;background:#0F0F12;border-radius:20px 20px 0 0;border:1px solid rgba(255,255,255,0.1);border-bottom:none;padding:24px 24px 32px;box-shadow:0 -16px 40px rgba(0,0,0,0.5);animation:hatchSlideUpSheet 0.35s cubic-bezier(0.34,1.56,0.64,1);max-height:80vh;overflow-y:auto;box-sizing:border-box}',
      '.hatch-sheet-handle{width:36px;height:4px;border-radius:2px;background:rgba(255,255,255,0.12);margin:0 auto 20px}',
      '.hatch-minimal{background:#0F0F12;border:1px solid rgba(255,255,255,0.08);border-radius:16px;max-width:360px;width:100%;padding:28px 24px;text-align:center;box-shadow:0 20px 40px rgba(0,0,0,0.7)}',
      '.hatch-side-panel{position:fixed;top:0;right:0;bottom:0;width:360px;background:#0F0F12;border-left:1px solid rgba(255,255,255,0.1);padding:28px 24px;overflow-y:auto;animation:hatchSlideRight 0.3s ease;box-shadow:-16px 0 40px rgba(0,0,0,0.4);box-sizing:border-box}',
      '#hatch-close{position:absolute;top:14px;right:14px;background:rgba(255,255,255,0.07);border:none;border-radius:50%;width:30px;height:30px;cursor:pointer;display:flex;align-items:center;justify-content:center;color:rgba(255,255,255,0.4);font-size:14px;transition:background 0.15s;z-index:1}',
      '#hatch-close:hover{background:rgba(255,255,255,0.12);color:rgba(255,255,255,0.7)}',
      '.hatch-headline{font-size:22px;font-weight:700;color:#fff;margin:0 0 8px;line-height:1.3;padding-right:32px}',
      '.hatch-headline.lg{font-size:28px}.hatch-headline.sm{font-size:18px;padding-right:0}',
      '.hatch-sub{font-size:14px;color:rgba(255,255,255,0.5);margin:0 0 14px;line-height:1.5}',
      '.hatch-body{font-size:13px;color:rgba(255,255,255,0.45);margin:0 0 16px;line-height:1.7;white-space:pre-line}',
      '.hatch-social{font-size:12px;color:rgba(255,255,255,0.35);margin-bottom:14px}',
      '.hatch-urgency{font-size:12px;font-weight:600;color:#F59E0B;background:rgba(245,158,11,0.1);border:1px solid rgba(245,158,11,0.2);border-radius:8px;padding:8px 12px;margin-bottom:14px;text-align:center}',
      '.hatch-countdown{display:flex;gap:8px;justify-content:center;margin-bottom:14px}',
      '.hatch-cd-unit{display:flex;flex-direction:column;align-items:center;gap:2px}',
      '.hatch-cd-num{font-family:ui-monospace,monospace;font-size:22px;font-weight:700;color:#fff;background:rgba(255,255,255,0.07);border-radius:8px;width:42px;text-align:center;line-height:1.5}',
      '.hatch-cd-label{font-size:9px;text-transform:uppercase;letter-spacing:0.08em;color:rgba(255,255,255,0.3)}',
      '.hatch-trust{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:14px}',
      '.hatch-trust-badge{font-size:10px;font-weight:500;color:rgba(255,255,255,0.4);background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.08);border-radius:100px;padding:3px 10px}',
      '.hatch-guarantee{font-size:11px;color:rgba(255,255,255,0.35);text-align:center;margin-bottom:12px}',
      '.hatch-toggle{display:flex;align-items:center;justify-content:center;gap:10px;margin-bottom:18px}',
      '.hatch-toggle-label{font-size:13px;color:rgba(255,255,255,0.5);cursor:pointer}',
      '.hatch-toggle-label.active{color:#fff;font-weight:600}',
      '.hatch-switch{width:40px;height:22px;border-radius:11px;background:rgba(255,255,255,0.12);border:none;cursor:pointer;position:relative;transition:background 0.2s;padding:0;outline:none}',
      '.hatch-switch.on{background:var(--hatch-accent,#6366F1)}',
      '.hatch-switch-thumb{position:absolute;top:3px;left:3px;width:16px;height:16px;border-radius:50%;background:#fff;transition:transform 0.2s}',
      '.hatch-switch.on .hatch-switch-thumb{transform:translateX(18px)}',
      '.hatch-badge{font-size:10px;font-weight:600;padding:2px 8px;border-radius:100px;background:rgba(99,102,241,0.15);color:#818CF8}',
      '.hatch-plans{display:grid;gap:10px;margin-bottom:14px}',
      '.hatch-plans.multi{grid-template-columns:repeat(auto-fit,minmax(130px,1fr))}',
      '.hatch-plan{background:rgba(255,255,255,0.04);border:1.5px solid rgba(255,255,255,0.08);border-radius:14px;padding:16px;cursor:pointer;transition:all 0.15s;box-sizing:border-box;position:relative}',
      '.hatch-plan:hover{border-color:rgba(255,255,255,0.15);background:rgba(255,255,255,0.06)}',
      '.hatch-plan.popular{border-color:var(--hatch-accent,rgba(99,102,241,0.5));background:rgba(99,102,241,0.08)}',
      '.hatch-popular-badge{font-size:9px;font-weight:700;text-transform:uppercase;color:var(--hatch-accent,#818CF8);margin-bottom:8px}',
      '.hatch-plan-name{font-size:13px;font-weight:600;color:#fff;margin-bottom:6px}',
      '.hatch-price{font-family:ui-monospace,monospace;font-size:26px;font-weight:700;color:#fff;line-height:1}',
      '.hatch-price-period{font-size:12px;color:rgba(255,255,255,0.4)}',
      '.hatch-features{list-style:none;padding:0;margin:10px 0 0;display:flex;flex-direction:column;gap:5px}',
      '.hatch-feature{display:flex;align-items:flex-start;gap:6px;font-size:11px;color:rgba(255,255,255,0.5);line-height:1.4}',
      '.hatch-cta{width:100%;padding:11px;border-radius:var(--hatch-btn-radius,10px);border:none;cursor:pointer;font-size:13px;font-weight:600;margin-top:8px;transition:opacity 0.15s}',
      '.hatch-cta.primary{background:var(--hatch-accent,#6366F1);color:#fff}',
      '.hatch-cta.secondary{background:rgba(255,255,255,0.08);color:rgba(255,255,255,0.7)}',
      '.hatch-cta:hover{opacity:0.88}',
      '.hatch-footer{font-size:11px;color:rgba(255,255,255,0.2);text-align:center;margin-top:12px}',
      '.hatch-powered{font-size:10px;color:rgba(255,255,255,0.1);text-align:center;margin-top:8px}',
    ].join('')
    document.head.appendChild(style)
  }

  // ─── Content builders ───────────────────────────────────────────────────────

  function buildSocialProof(config) {
    var type = config.social_proof_type || 'text'
    var text = config.social_proof || ''
    if (!text || type === 'none') return ''
    if (type === 'stars') return '<p class="hatch-social">★★★★★ ' + esc(text) + '</p>'
    if (type === 'user_count') return '<p class="hatch-social">👥 ' + esc(text) + '</p>'
    return '<p class="hatch-social">✦ ' + esc(text) + '</p>'
  }

  function buildUrgency(config) {
    return config.urgency_text ? '<div class="hatch-urgency">' + esc(config.urgency_text) + '</div>' : ''
  }

  function buildCountdown(config) {
    if (!config.show_countdown || !config.urgency_end_date) return ''
    var cdId = 'hatch-cd-' + uid().slice(0, 8)
    setTimeout(function() {
      var container = document.getElementById(cdId)
      if (!container) return
      var end = new Date(config.urgency_end_date).getTime()
      function tick() {
        var now = Date.now(), diff = Math.max(0, end - now)
        var d = Math.floor(diff / 86400000)
        var h = Math.floor((diff % 86400000) / 3600000)
        var m = Math.floor((diff % 3600000) / 60000)
        var s = Math.floor((diff % 60000) / 1000)
        var el = document.getElementById(cdId)
        if (!el) return
        el.innerHTML = (d > 0 ? unit(d, 'd') : '') + unit(h, 'h') + unit(m, 'm') + unit(s, 's')
        if (diff > 0) setTimeout(tick, 1000)
      }
      function unit(n, l) {
        return '<span class="hatch-cd-unit"><span class="hatch-cd-num">' + (n < 10 ? '0' + n : n) + '</span><span class="hatch-cd-label">' + l + '</span></span>'
      }
      tick()
    }, 50)
    return '<div class="hatch-countdown" id="' + cdId + '"></div>'
  }

  function buildTrustBadges(config) {
    var badges = config.trust_badges || []
    if (!badges.length) return ''
    return '<div class="hatch-trust">' + badges.map(function(b) { return '<span class="hatch-trust-badge">✓ ' + esc(b) + '</span>' }).join('') + '</div>'
  }

  function buildGuarantee(config) {
    return config.guarantee_text ? '<p class="hatch-guarantee">🛡 ' + esc(config.guarantee_text) + '</p>' : ''
  }

  function buildPlan(plan, config, accentColor, currentYearly) {
    var sym = CURRENCY_SYMBOLS[config.currency || 'USD'] || '$'
    var price = currentYearly && plan.price_yearly > 0 ? Math.round(plan.price_yearly / 12 / 100) : Math.round(plan.price_monthly / 100)
    var btnText = config.show_trial_in_cta ? 'Start free trial' : (config.cta_copy || 'Get started')
    var isPopular = plan.is_popular
    var html = '<div class="hatch-plan' + (isPopular ? ' popular' : '') + '" data-plan-id="' + plan.id + '">'
    if (isPopular) html += '<div class="hatch-popular-badge" style="color:' + accentColor + '">★ Most Popular</div>'
    html += '<div class="hatch-plan-name">' + esc(plan.name) + '</div>'
    html += '<div><span class="hatch-price">' + esc(sym) + price + '</span><span class="hatch-price-period">/mo</span></div>'
    if (plan.features && plan.features.length) {
      html += '<ul class="hatch-features">'
      plan.features.slice(0, 4).forEach(function(f) {
        html += '<li class="hatch-feature"><svg width="11" height="11" viewBox="0 0 12 12" fill="none"><circle cx="6" cy="6" r="6" fill="' + accentColor + '" opacity="0.2"/><path d="M3.5 6L5.5 8L8.5 4.5" stroke="' + accentColor + '" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>' + esc(f) + '</li>'
      })
      html += '</ul>'
    }
    html += '<button class="hatch-cta ' + (isPopular ? 'primary' : 'secondary') + '" style="' + (isPopular ? 'background:' + accentColor + ';' : '') + '" data-checkout="' + plan.id + '">' + esc(btnText) + '</button>'
    html += '</div>'
    return html
  }

  function buildPlans(plans, config, accentColor, yearly) {
    return '<div class="hatch-plans' + (plans.length > 1 ? ' multi' : '') + '">' +
      plans.map(function(p) { return buildPlan(p, config, accentColor, yearly) }).join('') + '</div>'
  }

  function buildYearlyToggle(yearly, pct) {
    return '<div class="hatch-toggle">' +
      '<span class="hatch-toggle-label' + (!yearly ? ' active' : '') + '" id="hatch-label-monthly">Monthly</span>' +
      '<button class="hatch-switch' + (yearly ? ' on' : '') + '" id="hatch-yearly-toggle" type="button"><div class="hatch-switch-thumb"></div></button>' +
      '<span class="hatch-toggle-label' + (yearly ? ' active' : '') + '" id="hatch-label-yearly">Yearly</span>' +
      '<span class="hatch-badge" style="' + (!yearly ? 'display:none' : '') + '" id="hatch-save-badge">Save ' + (pct || 20) + '%</span>' +
      '</div>'
  }

  function buildFooter(config) {
    var footer = config.footer_text || 'Cancel anytime · No hidden fees'
    return '<p class="hatch-footer">' + esc(footer) + '</p>' +
      (!config.hide_powered_by ? '<p class="hatch-powered">⚡ Powered by Hatch</p>' : '')
  }

  function btnRadius(shape) {
    return shape === 'pill' ? '999px' : shape === 'square' ? '4px' : '10px'
  }

  // ─── Template renderers ────────────────────────────────────────────────────

  function buildModalBase(config, accentColor) {
    var el = document.createElement('div')
    el.id = 'hatch-modal'

    // Chameleon overrides take priority when theme_mode === 'auto'
    var effectiveAccent = (config._chameleon_accent || accentColor)
    el.style.setProperty('--hatch-accent', effectiveAccent)
    el.style.setProperty('--hatch-btn-radius', config._chameleon_radius || btnRadius(config.button_shape))

    // Font
    var effectiveFont = config._chameleon_font || FONTS[config.font_family] || FONTS.system
    el.style.fontFamily = effectiveFont

    // Dark/light surface
    if (config._chameleon_dark !== undefined) {
      if (config._chameleon_dark) {
        el.style.background = 'rgba(18,18,22,0.97)'
        el.style.color = '#FFFFFF'
        el.style.setProperty('--hatch-text', '#FFFFFF')
        el.style.setProperty('--hatch-sub-text', 'rgba(255,255,255,0.65)')
        el.style.setProperty('--hatch-border', 'rgba(255,255,255,0.1)')
      } else {
        el.style.background = '#FFFFFF'
        el.style.color = '#0A0A0B'
        el.style.setProperty('--hatch-text', '#0A0A0B')
        el.style.setProperty('--hatch-sub-text', 'rgba(10,10,11,0.6)')
        el.style.setProperty('--hatch-border', 'rgba(0,0,0,0.1)')
      }
    }
    var anim = config.animation_style || 'slide'
    if (anim === 'fade') el.style.animation = 'hatchFadeIn 0.3s ease'
    else if (anim === 'zoom') el.style.animation = 'hatchZoomIn 0.3s cubic-bezier(0.34,1.56,0.64,1)'
    else if (anim === 'none') el.style.animation = 'none'
    else el.style.animation = 'hatchSlideUp 0.35s cubic-bezier(0.34,1.56,0.64,1)'
    return el
  }

  function renderClassicModal(config, plans, overlay, yearly) {
    var acc = (config.design && config.design.accentColor) || '#6366F1'
    var yEnabled = config.show_yearly_toggle && plans.some(function(p) { return p.price_yearly > 0 })
    overlay.style.background = 'rgba(0,0,0,' + ((config.overlay_opacity != null ? config.overlay_opacity : 65) / 100) + ')'
    overlay.style.backdropFilter = 'blur(6px)'
    var modal = buildModalBase(config, acc)
    var html = (config.closeable !== false ? '<button id="hatch-close">✕</button>' : '') +
      buildUrgency(config) + buildCountdown(config) +
      '<h2 class="hatch-headline">' + esc(config.headline || 'Unlock full access') + '</h2>' +
      (config.subheadline ? '<p class="hatch-sub">' + esc(config.subheadline) + '</p>' : '') +
      (config.body_copy ? '<p class="hatch-body">' + esc(config.body_copy) + '</p>' : '') +
      buildSocialProof(config) + buildTrustBadges(config) +
      (yEnabled ? buildYearlyToggle(yearly, config.yearly_discount_percent) : '') +
      buildPlans(plans, config, acc, yearly) + buildGuarantee(config) + buildFooter(config)
    modal.innerHTML = html
    overlay.appendChild(modal)
    return modal
  }

  function renderFullscreen(config, plans, overlay, yearly) {
    var acc = (config.design && config.design.accentColor) || '#6366F1'
    var yEnabled = config.show_yearly_toggle && plans.some(function(p) { return p.price_yearly > 0 })
    overlay.style.padding = '0'
    overlay.style.background = 'rgba(0,0,0,' + ((config.overlay_opacity != null ? config.overlay_opacity : 65) / 100) + ')'
    var modal = buildModalBase(config, acc)
    modal.className = 'hatch-fullscreen'
    var leftHtml = (config.closeable !== false ? '<button id="hatch-close" style="top:16px;right:16px">✕</button>' : '') +
      buildUrgency(config) + buildCountdown(config) +
      '<h2 class="hatch-headline lg">' + esc(config.headline || 'Unlock full access') + '</h2>' +
      (config.subheadline ? '<p class="hatch-sub">' + esc(config.subheadline) + '</p>' : '') +
      (config.body_copy ? '<p class="hatch-body">' + esc(config.body_copy) + '</p>' : '') +
      buildSocialProof(config) + buildTrustBadges(config) + buildGuarantee(config)
    var rightHtml = (yEnabled ? buildYearlyToggle(yearly, config.yearly_discount_percent) : '') +
      buildPlans(plans, config, acc, yearly) + buildFooter(config)
    modal.innerHTML = '<div class="hatch-fs-left" style="position:relative">' + leftHtml + '</div>' +
      '<div class="hatch-fs-right">' + rightHtml + '</div>'
    overlay.appendChild(modal)
    return modal
  }

  function renderSlideIn(config, plans, overlay) {
    var acc = (config.design && config.design.accentColor) || '#6366F1'
    overlay.style.cssText = 'position:fixed;inset:0;z-index:999998;background:transparent;pointer-events:none'
    var modal = document.createElement('div')
    modal.id = 'hatch-modal'
    modal.className = 'hatch-slide-in'
    modal.style.setProperty('--hatch-accent', acc)
    modal.style.setProperty('--hatch-btn-radius', btnRadius(config.button_shape))
    modal.style.fontFamily = FONTS[config.font_family] || FONTS.system
    modal.style.pointerEvents = 'all'
    var featured = plans.find(function(p) { return p.is_popular }) || plans[0]
    var sym = CURRENCY_SYMBOLS[config.currency || 'USD'] || '$'
    var price = featured ? Math.round(featured.price_monthly / 100) : 0
    modal.innerHTML = (config.closeable !== false ? '<button id="hatch-close">✕</button>' : '') +
      buildUrgency(config) +
      '<h2 class="hatch-headline sm">' + esc(config.headline || 'Unlock full access') + '</h2>' +
      (config.subheadline ? '<p class="hatch-sub" style="font-size:12px">' + esc(config.subheadline) + '</p>' : '') +
      buildSocialProof(config) +
      (featured ? '<div style="margin:10px 0"><div style="font-size:12px;font-weight:600;color:#fff;margin-bottom:4px">' + esc(featured.name) + '</div><div><span class="hatch-price" style="font-size:20px">' + esc(sym) + price + '</span><span class="hatch-price-period">/mo</span></div><button class="hatch-cta primary" style="background:' + acc + ';margin-top:10px" data-checkout="' + featured.id + '">' + esc(config.cta_copy || 'Get started') + '</button></div>' : '') +
      buildGuarantee(config) +
      '<p class="hatch-footer" style="font-size:10px">' + esc(config.footer_text || 'Cancel anytime') + '</p>'
    overlay.appendChild(modal)
    return modal
  }

  function renderBottomSheet(config, plans, overlay, yearly) {
    var acc = (config.design && config.design.accentColor) || '#6366F1'
    var yEnabled = config.show_yearly_toggle && plans.some(function(p) { return p.price_yearly > 0 })
    overlay.style.alignItems = 'flex-end'
    overlay.style.padding = '0'
    overlay.style.background = 'rgba(0,0,0,' + ((config.overlay_opacity != null ? config.overlay_opacity : 65) / 100) + ')'
    overlay.style.backdropFilter = 'blur(6px)'
    var modal = buildModalBase(config, acc)
    modal.className = 'hatch-bottom-sheet'
    modal.innerHTML = '<div class="hatch-sheet-handle"></div>' +
      (config.closeable !== false ? '<button id="hatch-close" style="top:10px">✕</button>' : '') +
      buildUrgency(config) + buildCountdown(config) +
      '<h2 class="hatch-headline">' + esc(config.headline || 'Unlock full access') + '</h2>' +
      (config.subheadline ? '<p class="hatch-sub">' + esc(config.subheadline) + '</p>' : '') +
      buildSocialProof(config) +
      (yEnabled ? buildYearlyToggle(yearly, config.yearly_discount_percent) : '') +
      buildPlans(plans, config, acc, yearly) + buildGuarantee(config) + buildFooter(config)
    overlay.appendChild(modal)
    return modal
  }

  function renderMinimal(config, plans, overlay) {
    var acc = (config.design && config.design.accentColor) || '#6366F1'
    overlay.style.background = 'rgba(0,0,0,' + ((config.overlay_opacity != null ? config.overlay_opacity : 65) / 100) + ')'
    overlay.style.backdropFilter = 'blur(6px)'
    var modal = buildModalBase(config, acc)
    modal.className = 'hatch-minimal'
    var featured = plans.find(function(p) { return p.is_popular }) || plans[0]
    var sym = CURRENCY_SYMBOLS[config.currency || 'USD'] || '$'
    var price = featured ? Math.round(featured.price_monthly / 100) : 0
    modal.innerHTML = (config.closeable !== false ? '<button id="hatch-close" style="top:10px;right:10px">✕</button>' : '') +
      buildUrgency(config) +
      '<h2 class="hatch-headline sm" style="text-align:center;padding-right:0">' + esc(config.headline || 'Unlock full access') + '</h2>' +
      (config.subheadline ? '<p class="hatch-sub" style="text-align:center">' + esc(config.subheadline) + '</p>' : '') +
      buildSocialProof(config) +
      (featured ? '<div style="text-align:center;margin:16px 0"><span class="hatch-price">' + esc(sym) + price + '</span><span class="hatch-price-period">/mo</span></div><button class="hatch-cta primary" style="background:' + acc + '" data-checkout="' + featured.id + '">' + esc(config.cta_copy || 'Get started') + '</button>' : '') +
      buildGuarantee(config) +
      '<p class="hatch-footer">' + esc(config.footer_text || 'Cancel anytime · No hidden fees') + '</p>'
    overlay.appendChild(modal)
    return modal
  }

  function renderSidePanel(config, plans, overlay, yearly) {
    var acc = config._chameleon_accent || (config.design && config.design.accentColor) || '#6366F1'
    var yEnabled = config.show_yearly_toggle && plans.some(function(p) { return p.price_yearly > 0 })
    overlay.style.justifyContent = 'flex-end'
    overlay.style.padding = '0'
    overlay.style.background = 'rgba(0,0,0,' + (config._chameleon_dark ? '0.6' : '0.45') + ')'
    overlay.style.backdropFilter = 'blur(4px)'
    var modal = document.createElement('div')
    modal.id = 'hatch-modal'
    modal.className = 'hatch-side-panel'
    modal.style.setProperty('--hatch-accent', acc)
    modal.style.setProperty('--hatch-btn-radius', config._chameleon_radius || btnRadius(config.button_shape))
    modal.style.fontFamily = config._chameleon_font || FONTS[config.font_family] || FONTS.system
    if (config._chameleon_dark !== undefined) {
      modal.style.background = config._chameleon_dark ? 'rgba(18,18,22,0.98)' : '#FFFFFF'
      modal.style.color = config._chameleon_dark ? '#FFFFFF' : '#0A0A0B'
      modal.style.setProperty('--hatch-text', config._chameleon_dark ? '#FFFFFF' : '#0A0A0B')
      modal.style.setProperty('--hatch-sub-text', config._chameleon_dark ? 'rgba(255,255,255,0.65)' : 'rgba(10,10,11,0.6)')
      modal.style.setProperty('--hatch-border', config._chameleon_dark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)')
    }
    modal.innerHTML = (config.closeable !== false ? '<button id="hatch-close" style="top:16px;right:16px">✕</button>' : '') +
      buildUrgency(config) + buildCountdown(config) +
      '<h2 class="hatch-headline" style="font-size:20px">' + esc(config.headline || 'Unlock full access') + '</h2>' +
      (config.subheadline ? '<p class="hatch-sub">' + esc(config.subheadline) + '</p>' : '') +
      (config.body_copy ? '<p class="hatch-body">' + esc(config.body_copy) + '</p>' : '') +
      buildSocialProof(config) + buildTrustBadges(config) +
      (yEnabled ? buildYearlyToggle(yearly, config.yearly_discount_percent) : '') +
      buildPlans(plans, config, acc, yearly) + buildGuarantee(config) + buildFooter(config)
    overlay.appendChild(modal)
    return modal
  }

  // ─── Main renderPaywall ────────────────────────────────────────────────────

  function renderPaywall(config, plans) {
    if (state.activePaywall) return

    // Apply chameleon theme detection when auto mode is active (default)
    var effectiveConfig = (config.theme_mode !== 'manual') ? applyChameleon(config) : config

    if (effectiveConfig.custom_css && !document.getElementById('hatch-custom-css-' + effectiveConfig.id)) {
      var cs = document.createElement('style')
      cs.id = 'hatch-custom-css-' + effectiveConfig.id
      cs.textContent = effectiveConfig.custom_css
      document.head.appendChild(cs)
    }

    config = effectiveConfig  // use chameleon-enhanced config for all downstream rendering
    var template = config.template || 'classic-modal'
    var yearly = false
    var overlay = document.createElement('div')
    overlay.id = 'hatch-overlay'
    overlay.style.animation = 'hatchFadeIn 0.2s ease'

    function buildAndMount() {
      while (overlay.firstChild) overlay.removeChild(overlay.firstChild)
      overlay.style.cssText = 'position:fixed;inset:0;z-index:999998;display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box;animation:hatchFadeIn 0.2s ease'
      var modal
      if (template === 'fullscreen') modal = renderFullscreen(config, plans, overlay, yearly)
      else if (template === 'slide-in') modal = renderSlideIn(config, plans, overlay)
      else if (template === 'bottom-sheet') modal = renderBottomSheet(config, plans, overlay, yearly)
      else if (template === 'minimal') modal = renderMinimal(config, plans, overlay)
      else if (template === 'side-panel') modal = renderSidePanel(config, plans, overlay, yearly)
      else modal = renderClassicModal(config, plans, overlay, yearly)
      return modal
    }

    buildAndMount()
    document.body.appendChild(overlay)
    markShown(config.id)
    state.paywallShownAt = Date.now()
    state.intervalShown = 'monthly'  // reset to default; updated on toggle/CTA
    track('paywall_shown', { paywall_id: config.id, trigger_type: config._trigger_type || 'manual' })

    // Attach hover listeners for plan cards (debounced 300ms, max 1 per plan)
    var hoveredPlans = {}
    function attachHoverListeners() {
      overlay.querySelectorAll('.hatch-plan[data-plan-id]').forEach(function(el) {
        var pid = el.getAttribute('data-plan-id')
        if (!pid || hoveredPlans[pid]) return
        el.addEventListener('mouseenter', function() {
          state.hoverTimers[pid] = setTimeout(function() {
            if (!hoveredPlans[pid]) {
              hoveredPlans[pid] = true
              track('plan_hovered', { plan_id: pid })
            }
            delete state.hoverTimers[pid]
          }, 300)
        })
        el.addEventListener('mouseleave', function() {
          if (state.hoverTimers[pid]) { clearTimeout(state.hoverTimers[pid]); delete state.hoverTimers[pid] }
        })
      })
    }
    attachHoverListeners()

    // Scroll depth for templates with vertical scroll (fullscreen right panel, bottom-sheet)
    var scrollDepthFired = {}
    function attachScrollDepth(el) {
      if (!el) return
      el.addEventListener('scroll', function() {
        var h = el.scrollHeight - el.clientHeight
        if (h <= 0) return
        var pct = Math.round((el.scrollTop / h) * 100)
        ;[25, 50, 75, 100].forEach(function(thr) {
          if (pct >= thr && !scrollDepthFired[thr]) {
            scrollDepthFired[thr] = true
            track('scroll_depth', { percent: thr, paywall_id: config.id })
          }
        })
      }, { passive: true })
    }
    if (template === 'fullscreen') attachScrollDepth(overlay.querySelector('.hatch-fs-right'))
    else if (template === 'bottom-sheet') attachScrollDepth(overlay.querySelector('.hatch-bottom-sheet'))

    // ESC key to dismiss
    var onKeyDown = function(e) {
      if (e.key === 'Escape' && config.closeable !== false) closePaywall('esc')
    }
    document.addEventListener('keydown', onKeyDown)

    // Back-button dismiss (browser history back while paywall is open)
    var onPopState = function() {
      if (state.activePaywall && config.closeable !== false) {
        closePaywall('back_button')
        // Prevent navigating away — push state back so the page stays
        history.pushState(null, '', window.location.href)
      }
    }
    history.pushState(null, '', window.location.href)  // push so back triggers popstate
    window.addEventListener('popstate', onPopState)

    // Exit-intent dismiss (mouse leaves viewport toward top while paywall is open)
    var onExitIntent = function(e) {
      if (e.clientY <= 5 && state.activePaywall && config.closeable !== false) {
        closePaywall('exit_intent')
      }
    }
    document.addEventListener('mouseleave', onExitIntent)

    overlay.addEventListener('click', function(e) {
      var t = e.target
      if (t.id === 'hatch-close' || (t.closest && t.closest('#hatch-close'))) { closePaywall('close_button'); return }
      if (t === overlay && config.closeable !== false) { closePaywall('overlay'); return }
      if (t.id === 'hatch-yearly-toggle' || (t.closest && t.closest('#hatch-yearly-toggle'))) {
        yearly = !yearly
        track('billing_toggle_changed', { to: yearly ? 'yearly' : 'monthly' })
        buildAndMount()
        attachHoverListeners()
        return
      }
      var btn = (t.dataset && t.dataset.checkout) ? t : (t.closest && t.closest('[data-checkout]'))
      if (btn && btn.dataset) {
        var planId = btn.dataset.checkout
        // Find the price shown for this plan (read from rendered element)
        var planEl = btn.closest ? btn.closest('.hatch-plan') : null
        var priceEl = planEl ? planEl.querySelector('.hatch-price') : null
        var priceText = priceEl ? priceEl.textContent.replace(/[^0-9.]/g, '') : ''
        var priceShownCents = priceText ? Math.round(parseFloat(priceText) * 100) : null
        var chosenInterval = yearly ? 'yearly' : 'monthly'
        // Store for context enrichment
        state.priceShownCents = priceShownCents
        state.intervalShown   = chosenInterval
        track('plan_selected', { plan_id: planId, yearly: yearly })
        track('cta_clicked', { plan_id: planId, price_shown_cents: priceShownCents, interval: chosenInterval })
        startCheckout(config, planId, yearly)
      }
    })

    state.activePaywall = { overlay: overlay, config: config, keyHandler: onKeyDown, popHandler: onPopState, exitHandler: onExitIntent }
  }

  function closePaywall(method) {
    if (state.activePaywall) {
      var overlay      = state.activePaywall.overlay
      var keyHandler   = state.activePaywall.keyHandler
      var popHandler   = state.activePaywall.popHandler
      var exitHandler  = state.activePaywall.exitHandler
      var dwellMs = state.paywallShownAt ? (Date.now() - state.paywallShownAt) : null

      // Remove listeners
      if (keyHandler)  document.removeEventListener('keydown',  keyHandler)
      if (popHandler)  window.removeEventListener('popstate',   popHandler)
      if (exitHandler) document.removeEventListener('mouseleave', exitHandler)

      // Clear any pending hover timers
      for (var pid in state.hoverTimers) { clearTimeout(state.hoverTimers[pid]) }
      state.hoverTimers = {}

      // Emit behavioural events if this is a dismissal (not a checkout redirect)
      if (method) {
        track('paywall_dismissed', { method: method, dwell_ms: dwellMs })
      }
      if (dwellMs !== null) {
        track('paywall_dwell', { dwell_ms: dwellMs })
      }

      state.paywallShownAt = null
      state.priceShownCents = null
      state.intervalShown = null
      overlay.style.animation = 'hatchFadeIn 0.15s ease reverse'
      setTimeout(function() { if (overlay.parentNode) overlay.parentNode.removeChild(overlay) }, 150)
      state.activePaywall = null
    }
  }

  async function startCheckout(config, planId, yearly) {
    console.log('[Hatch] CTA clicked — plan:', planId, '| yearly:', !!yearly)
    track('checkout_started', { plan_id: planId })
    var successUrl = config.success_redirect_url ||
      (window.location.href + (window.location.href.includes('?') ? '&' : '?') + 'hatch_success=1')

    // Persist pending checkout so we can detect abandonment on return
    try {
      sessionStorage.setItem(CHECKOUT_PENDING_KEY, JSON.stringify({
        planId: planId,
        paywallId: config.id,
        startedAt: Date.now(),
      }))
    } catch (e) {}

    try {
      var res = await fetch(API_BASE + '/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paywallId: config.id, planId: planId, userId: state.userId, email: state.userTraits.email, successUrl: successUrl, cancelUrl: window.location.href, yearly: !!yearly }),
      })
      var data = await res.json()
      if (data.url) {
        console.log('[Hatch] Redirecting to Stripe Checkout…')
        window.location.href = data.url
      } else {
        console.error('[Hatch] Checkout failed — no redirect URL returned.', data.error || data)
        try { sessionStorage.removeItem(CHECKOUT_PENDING_KEY) } catch (e) {}
      }
    } catch (e) {
      console.error('[Hatch] Checkout network error:', e)
      try { sessionStorage.removeItem(CHECKOUT_PENDING_KEY) } catch (e) {}
    }
  }

  // ─── Heartbeat ─────────────────────────────────────────────────────────────

  function sendHeartbeat() {
    if (!state.apiKey) return
    fetch(API_BASE + '/sdk/heartbeat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: state.apiKey }),
    }).catch(function() {})
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  function init(apiKey) {
    if (state.initialized) return
    if (!apiKey || typeof apiKey !== 'string' || apiKey.length < 8) {
      console.warn('[Hatch] init() called with an invalid or missing API key. Check your data-key attribute.')
      return
    }
    state.apiKey = apiKey
    state.sessionId = getSession().id
    var storedUser = getStoredUser()
    if (storedUser) { state.userId = storedUser.id; state.userTraits = storedUser.traits || {} }

    // Build full context once — will be attached to every track() call
    state.landingPage = window.location.href
    var isReturning = hasReturned()  // also increments visit count
    var sessionCount = getSessionCount()
    state.context = buildContext(isReturning, sessionCount)

    console.log('[Hatch] SDK loaded — API base:', API_BASE, '| key:', apiKey.slice(0, 8) + '...')
    injectStyles()
    track('page_view', { url: window.location.href })

    // Detect checkout abandonment: user started checkout but returned without paying
    try {
      var pendingRaw = sessionStorage.getItem(CHECKOUT_PENDING_KEY)
      if (pendingRaw) {
        if (window.location.search.includes('hatch_success=1')) {
          // Successful payment — clear flag, do not fire abandoned
          sessionStorage.removeItem(CHECKOUT_PENDING_KEY)
        } else {
          // Returned without paying
          sessionStorage.removeItem(CHECKOUT_PENDING_KEY)
          var pending = JSON.parse(pendingRaw)
          track('checkout_abandoned', {
            plan_id: pending.planId,
            paywall_id: pending.paywallId,
            time_away_ms: Date.now() - (pending.startedAt || 0),
          })
        }
      }
    } catch (e) {}

    if (window.location.search.includes('hatch_success=1')) fetchSubscription()
    state.initialized = true
    // Heartbeat: signal SDK presence to the dashboard immediately and every 60s
    sendHeartbeat()
    setInterval(sendHeartbeat, 60000)
  }

  function identify(userId, traits) {
    state.userId = userId
    state.userTraits = traits || {}
    storeUser({ id: userId, traits: traits || {} })
    track('identify', { user_id: userId })
    fetchSubscription()
  }

  function getIsReturning() {
    try {
      var raw = localStorage.getItem(VISIT_KEY)
      return raw ? JSON.parse(raw).count > 1 : false
    } catch (e) { return false }
  }

  function track(eventName, properties) {
    if (!state.apiKey) return
    // Enrich every event with full context (built once at init, stays current)
    var enriched = Object.assign(
      {},
      state.context || {},
      {
        segment_hash:       state.segmentHash || undefined,
        variant_id:         state.variantId   || undefined,
        price_shown_cents:  state.priceShownCents || undefined,
        interval_shown:     state.intervalShown   || undefined,
      },
      properties || {}
    )

    var payload = {
      apiKey: state.apiKey,
      event: eventName,
      userId: state.userId,
      sessionId: state.sessionId,
      paywallId: state.activePaywall ? state.activePaywall.config.id : (properties && properties.paywall_id) || null,
      variantId: state.variantId || null,
      properties: enriched,
    }
    if (navigator.sendBeacon) {
      navigator.sendBeacon(API_BASE + '/sdk/events', new Blob([JSON.stringify(payload)], { type: 'application/json' }))
    } else {
      fetch(API_BASE + '/sdk/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), keepalive: true }).catch(function() {})
    }
  }

  async function show(paywallId) {
    if (!state.apiKey) { console.warn('[Hatch] Not initialized — call hatch.init() or set data-key on the script tag'); return }
    if (state.activePaywall || state.activeQuiz) return

    // Skip if user already has an active subscription
    if (state.subscription && state.subscription.status === 'active') {
      console.log('[Hatch] User already subscribed — paywall skipped')
      return
    }

    var url = API_BASE + '/sdk/config?key=' + state.apiKey +
      (paywallId ? '&paywall=' + paywallId : '') +
      '&session=' + state.sessionId +
      buildSegmentQueryParams()

    try {
      var res = await fetch(url)
      if (!res.ok) {
        console.error('[Hatch] Cannot reach Hatch API at', API_BASE, '— HTTP', res.status, '(possible CORS or network issue)')
        return
      }
      var data = await res.json()
      var config = data.paywall || (data.paywalls && data.paywalls[0])
      if (!config) {
        var hint = paywallId
          ? 'Paywall "' + paywallId + '" not found or not published — is it Live in the Hatch dashboard?'
          : 'No live paywalls found for this account — publish one at ' + API_BASE.replace('/api', '') + '/paywalls'
        console.warn('[Hatch]', hint)
        return
      }

      if (config._variant_id) state.variantId = config._variant_id
      if (data.segment_hash) state.segmentHash = data.segment_hash

      var plans = config.plan_ids && config.plan_ids.length > 0
        ? (config.plans || []).filter(function(p) { return config.plan_ids.includes(p.id) })
        : (config.plans || [])

      var localizedConfig = applyLocale(config)
      var segmentHash = data.segment_hash || null

      // Setup auto-triggers for subsequent navigation (not for this manual show)
      setupTriggers(localizedConfig, plans)

      // If quiz exists and is active, show it first
      if (data.quiz && data.quiz.questions && data.quiz.questions.length > 0 && data.quiz.trigger_mode !== 'disabled') {
        var acc = (config.design && config.design.accentColor) || '#6366F1'
        renderQuiz(data.quiz, acc, function(answers) {
          // Re-fetch config with quiz answers as additional segment signals
          refetchWithQuizAnswers(paywallId, answers, data.quiz, segmentHash)
        })
      } else {
        renderPaywall(localizedConfig, plans)
      }
    } catch (e) {
      if (e instanceof TypeError && String(e).toLowerCase().includes('fetch')) {
        console.error('[Hatch] Network error — cannot reach Hatch API at', API_BASE, '. Check CORS or your network.', e)
      } else {
        console.error('[Hatch] Failed to load paywall:', e)
      }
    }
  }

  async function refetchWithQuizAnswers(paywallId, quizAnswers, quiz, prevSegmentHash) {
    var url = API_BASE + '/sdk/config?key=' + state.apiKey +
      (paywallId ? '&paywall=' + paywallId : '') +
      '&session=' + state.sessionId +
      buildSegmentQueryParams() +
      '&quiz_answers=' + encodeURIComponent(JSON.stringify(quizAnswers))

    // Persist quiz response asynchronously
    fetch(API_BASE + '/sdk/quiz-response', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apiKey: state.apiKey,
        paywallId: paywallId,
        quizId: quiz ? quiz.id : null,
        sessionId: state.sessionId,
        userIdExternal: state.userId,
        answers: quizAnswers,
        segmentHash: prevSegmentHash,
        device: getDevice(),
        utmSource: getUtm('utm_source'),
        returning: hasReturned(),
      })
    }).catch(function() {})

    try {
      var res = await fetch(url)
      var data = await res.json()
      var config = data.paywall || (data.paywalls && data.paywalls[0])
      if (!config) return

      if (config._variant_id) state.variantId = config._variant_id

      var plans = config.plan_ids && config.plan_ids.length > 0
        ? (config.plans || []).filter(function(p) { return config.plan_ids.includes(p.id) })
        : (config.plans || [])

      renderPaywall(applyLocale(config), plans)
    } catch (e) {
      console.error('[Hatch] Failed to refetch paywall after quiz:', e)
    }
  }

  function hide() { closePaywall() }

  function reset() {
    state.userId = null
    state.userTraits = {}
    state.subscription = null
    try { localStorage.removeItem(USER_KEY) } catch (e) {}
  }

  async function isSubscribed() {
    var sub = await getSubscription()
    return !!(sub && sub.status === 'active')
  }

  function debug() {
    console.group('[Hatch Debug]')
    console.log('SDK version : 3.4.0')
    console.log('API Base    :', API_BASE)
    console.log('API Key     :', state.apiKey ? state.apiKey.slice(0, 8) + '...' : 'NOT SET')
    console.log('Initialized :', state.initialized)
    console.log('Session     :', state.sessionId)
    console.log('User ID     :', state.userId || '(none)')
    console.log('User traits :', state.userTraits)
    console.log('Active paywall:', state.activePaywall ? 'yes' : 'none')
    console.log('Active quiz :', state.activeQuiz ? 'yes' : 'none')
    console.groupEnd()
    return {
      version: '3.4.0',
      apiBase: API_BASE,
      apiKey: state.apiKey,
      initialized: state.initialized,
      sessionId: state.sessionId,
      userId: state.userId,
    }
  }

  async function getSubscription() {
    if (state.subscription) return state.subscription
    return fetchSubscription()
  }

  async function fetchSubscription() {
    if (!state.apiKey) return null
    var url = API_BASE + '/sdk/subscription?key=' + state.apiKey
    if (state.userId) url += '&userId=' + encodeURIComponent(state.userId)
    else if (state.userTraits.email) url += '&email=' + encodeURIComponent(state.userTraits.email)
    else return null
    try {
      var res = await fetch(url)
      var data = await res.json()
      state.subscription = data.subscription
      return data.subscription
    } catch (e) { return null }
  }

  // ─── Auto-init from script tag ────────────────────────────────────────────

  var currentScript = document.currentScript || (function() {
    var scripts = document.getElementsByTagName('script')
    return scripts[scripts.length - 1]
  })()

  if (currentScript) {
    var autoKey = currentScript.getAttribute('data-key')
    if (autoKey) {
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() { init(autoKey) })
      } else {
        init(autoKey)
      }
    }
  }

  var api = {
    init: init,
    identify: identify,
    track: track,
    show: show,
    hide: hide,
    reset: reset,
    isSubscribed: isSubscribed,
    getSubscription: getSubscription,
    debug: debug,
  }

  // Expose a sentinel on window so integration tools can detect SDK presence
  try { window.__hatch = { ready: true, version: '3.3.0' } } catch (e) {}

  return api
})
