/**
 * Hatch SDK v2.0.0
 * Paywall SDK for AI-built apps
 * https://hatch.io
 */
;(function (global, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory()
  } else {
    global.hatch = factory()
  }
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this, function () {

  var API_BASE = 'https://app.hatch.io/api'
  var SESSION_KEY = 'hatch_session'
  var USER_KEY = 'hatch_user'
  var SHOWN_PREFIX = 'hatch_shown_'

  var CURRENCY_SYMBOLS = { USD: '$', EUR: '€', GBP: '£', CAD: 'C$', AUD: 'A$', JPY: '¥', CHF: 'CHF ', BRL: 'R$' }
  var FONTS = {
    system: '-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
    serif: 'Georgia,"Times New Roman",serif',
    mono: 'ui-monospace,"Cascadia Code","Courier New",monospace',
  }

  var state = {
    apiKey: null,
    userId: null,
    userTraits: {},
    sessionId: null,
    subscription: null,
    config: null,
    activePaywall: null,
    initialized: false,
    variantId: null,
    triggerCleanups: [],
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

  function currencySymbol(currency) {
    return CURRENCY_SYMBOLS[currency] || '$'
  }

  function fontFamily(fontKey) {
    return FONTS[fontKey] || FONTS.system
  }

  function btnRadius(shape) {
    if (shape === 'pill') return '999px'
    if (shape === 'square') return '4px'
    return '10px'
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
    var cooldownMs = (tc.cooldown_hours || 24) * 3600 * 1000
    var lastShown = data.lastShown || 0

    if (freq === 'once') return false
    if (freq === 'daily') return now - lastShown >= 86400000
    if (freq === 'weekly') return now - lastShown >= 604800000
    if (freq === 'monthly') return now - lastShown >= 2592000000
    if (cooldownMs > 0) return now - lastShown >= cooldownMs
    return true
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

  function setupTriggers(config) {
    var tc = config.trigger_config || {}
    cleanupTriggers()

    // Page view count trigger
    if (tc.page_count > 0) {
      var count = getPageCount(config.id)
      if (count >= tc.page_count && canShowPaywall(config)) {
        setTimeout(function() { triggerShow(config) }, 500)
        return
      }
    }

    // Exit intent
    if (tc.exit_intent) {
      var onExit = function(e) {
        if (e.clientY <= 5 && canShowPaywall(config)) {
          triggerShow(config)
        }
      }
      document.addEventListener('mouseleave', onExit)
      state.triggerCleanups.push(function() { document.removeEventListener('mouseleave', onExit) })
    }

    // Time delay
    if (tc.time_delay > 0) {
      var timer = setTimeout(function() {
        if (canShowPaywall(config) && !state.activePaywall) triggerShow(config)
      }, tc.time_delay * 1000)
      state.triggerCleanups.push(function() { clearTimeout(timer) })
    }

    // Scroll depth
    if (tc.scroll_depth > 0) {
      var onScroll = function() {
        var scrolled = (window.scrollY || window.pageYOffset)
        var docH = document.documentElement.scrollHeight - window.innerHeight
        var pct = docH > 0 ? (scrolled / docH) * 100 : 0
        if (pct >= tc.scroll_depth && canShowPaywall(config) && !state.activePaywall) {
          window.removeEventListener('scroll', onScroll)
          triggerShow(config)
        }
      }
      window.addEventListener('scroll', onScroll, { passive: true })
      state.triggerCleanups.push(function() { window.removeEventListener('scroll', onScroll) })
    }
  }

  async function triggerShow(config) {
    if (state.activePaywall) return
    var plans = config.plan_ids && config.plan_ids.length > 0
      ? (config.plans || []).filter(function(p) { return config.plan_ids.includes(p.id) })
      : (config.plans || [])
    renderPaywall(applyLocale(config), plans)
  }

  // ─── Countdown ─────────────────────────────────────────────────────────────

  function startCountdown(endDate, containerId) {
    var container = document.getElementById(containerId)
    if (!container) return
    var end = new Date(endDate).getTime()
    function tick() {
      var now = Date.now()
      var diff = Math.max(0, end - now)
      var d = Math.floor(diff / 86400000)
      var h = Math.floor((diff % 86400000) / 3600000)
      var m = Math.floor((diff % 3600000) / 60000)
      var s = Math.floor((diff % 60000) / 1000)
      if (!document.getElementById(containerId)) return
      container.innerHTML =
        (d > 0 ? '<span class="hatch-cd-unit"><span class="hatch-cd-num">' + d + '</span><span class="hatch-cd-label">d</span></span>' : '') +
        '<span class="hatch-cd-unit"><span class="hatch-cd-num">' + pad(h) + '</span><span class="hatch-cd-label">h</span></span>' +
        '<span class="hatch-cd-unit"><span class="hatch-cd-num">' + pad(m) + '</span><span class="hatch-cd-label">m</span></span>' +
        '<span class="hatch-cd-unit"><span class="hatch-cd-num">' + pad(s) + '</span><span class="hatch-cd-label">s</span></span>'
      if (diff > 0) setTimeout(tick, 1000)
    }
    tick()
  }

  function pad(n) { return n < 10 ? '0' + n : '' + n }

  // ─── Style injection ────────────────────────────────────────────────────────

  function injectStyles() {
    if (document.getElementById('hatch-styles')) return
    var style = document.createElement('style')
    style.id = 'hatch-styles'
    style.textContent = [
      // Animations
      '@keyframes hatchFadeIn{from{opacity:0}to{opacity:1}}',
      '@keyframes hatchSlideUp{from{opacity:0;transform:translateY(32px) scale(0.96)}to{opacity:1;transform:translateY(0) scale(1)}}',
      '@keyframes hatchSlideRight{from{opacity:0;transform:translateX(100%)}to{opacity:1;transform:translateX(0)}}',
      '@keyframes hatchSlideUpSheet{from{opacity:0;transform:translateY(100%)}to{opacity:1;transform:translateY(0)}}',
      '@keyframes hatchSlideInCorner{from{opacity:0;transform:translateY(16px) scale(0.95)}to{opacity:1;transform:translateY(0) scale(1)}}',
      '@keyframes hatchZoomIn{from{opacity:0;transform:scale(0.9)}to{opacity:1;transform:scale(1)}}',
      // Overlay base
      '#hatch-overlay{position:fixed;inset:0;z-index:999998;display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box;animation:hatchFadeIn 0.2s ease}',
      '#hatch-overlay.hatch-dimmed{background:rgba(0,0,0,0.65);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px)}',
      '#hatch-overlay.hatch-no-dim{background:transparent;pointer-events:none}',
      '#hatch-overlay.hatch-no-dim #hatch-modal,#hatch-overlay.hatch-no-dim .hatch-slide-in,#hatch-overlay.hatch-no-dim .hatch-side-panel{pointer-events:all}',
      // Classic modal
      '#hatch-modal{background:#0F0F12;border:1px solid rgba(255,255,255,0.1);border-radius:20px;max-width:480px;width:100%;max-height:90vh;overflow-y:auto;box-shadow:0 25px 50px -12px rgba(0,0,0,0.8);position:relative;box-sizing:border-box;padding:28px}',
      // Fullscreen
      '.hatch-fullscreen{width:100%;height:100%;border-radius:0;max-width:none;max-height:none;display:flex;flex-direction:row;padding:0;overflow:hidden}',
      '.hatch-fs-left{flex:1;padding:48px 40px;overflow-y:auto;display:flex;flex-direction:column;justify-content:center;border-right:1px solid rgba(255,255,255,0.06)}',
      '.hatch-fs-right{width:360px;flex-shrink:0;padding:40px 32px;overflow-y:auto;background:rgba(255,255,255,0.02);display:flex;flex-direction:column;justify-content:center}',
      // Slide-in (corner)
      '.hatch-slide-in{position:fixed;bottom:20px;right:20px;width:288px;background:#0F0F12;border:1px solid rgba(255,255,255,0.12);border-radius:16px;padding:20px;box-shadow:0 16px 40px rgba(0,0,0,0.6);animation:hatchSlideInCorner 0.35s cubic-bezier(0.34,1.56,0.64,1);box-sizing:border-box;max-height:85vh;overflow-y:auto}',
      // Bottom sheet
      '.hatch-bottom-sheet{position:fixed;bottom:0;left:0;right:0;background:#0F0F12;border-radius:20px 20px 0 0;border:1px solid rgba(255,255,255,0.1);border-bottom:none;padding:24px 24px 32px;box-shadow:0 -16px 40px rgba(0,0,0,0.5);animation:hatchSlideUpSheet 0.35s cubic-bezier(0.34,1.56,0.64,1);max-height:80vh;overflow-y:auto;box-sizing:border-box}',
      '.hatch-sheet-handle{width:36px;height:4px;border-radius:2px;background:rgba(255,255,255,0.12);margin:0 auto 20px}',
      // Minimal
      '.hatch-minimal{background:#0F0F12;border:1px solid rgba(255,255,255,0.08);border-radius:16px;max-width:360px;width:100%;padding:28px 24px;text-align:center;box-shadow:0 20px 40px rgba(0,0,0,0.7)}',
      // Side panel
      '.hatch-side-panel{position:fixed;top:0;right:0;bottom:0;width:360px;background:#0F0F12;border-left:1px solid rgba(255,255,255,0.1);padding:28px 24px;overflow-y:auto;animation:hatchSlideRight 0.3s ease;box-shadow:-16px 0 40px rgba(0,0,0,0.4);box-sizing:border-box}',
      // Close button
      '#hatch-close{position:absolute;top:14px;right:14px;background:rgba(255,255,255,0.07);border:none;border-radius:50%;width:30px;height:30px;cursor:pointer;display:flex;align-items:center;justify-content:center;color:rgba(255,255,255,0.4);font-size:14px;transition:background 0.15s;z-index:1}',
      '#hatch-close:hover{background:rgba(255,255,255,0.12);color:rgba(255,255,255,0.7)}',
      // Typography
      '.hatch-headline{font-size:22px;font-weight:700;color:#fff;margin:0 0 8px;line-height:1.3;padding-right:32px}',
      '.hatch-headline.lg{font-size:28px}',
      '.hatch-headline.sm{font-size:18px;padding-right:0}',
      '.hatch-sub{font-size:14px;color:rgba(255,255,255,0.5);margin:0 0 14px;line-height:1.5}',
      '.hatch-body{font-size:13px;color:rgba(255,255,255,0.45);margin:0 0 16px;line-height:1.7;white-space:pre-line}',
      '.hatch-social{font-size:12px;color:rgba(255,255,255,0.35);margin-bottom:14px}',
      '.hatch-social.stars span{color:#FBBF24}',
      '.hatch-urgency{font-size:12px;font-weight:600;color:#F59E0B;background:rgba(245,158,11,0.1);border:1px solid rgba(245,158,11,0.2);border-radius:8px;padding:8px 12px;margin-bottom:14px;text-align:center}',
      // Countdown
      '.hatch-countdown{display:flex;gap:8px;justify-content:center;margin-bottom:14px}',
      '.hatch-cd-unit{display:flex;flex-direction:column;align-items:center;gap:2px}',
      '.hatch-cd-num{font-family:ui-monospace,monospace;font-size:22px;font-weight:700;color:#fff;background:rgba(255,255,255,0.07);border-radius:8px;width:42px;text-align:center;line-height:1.5}',
      '.hatch-cd-label{font-size:9px;text-transform:uppercase;letter-spacing:0.08em;color:rgba(255,255,255,0.3)}',
      // Trust badges
      '.hatch-trust{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:14px}',
      '.hatch-trust-badge{font-size:10px;font-weight:500;color:rgba(255,255,255,0.4);background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.08);border-radius:100px;padding:3px 10px;display:flex;align-items:center;gap:4px}',
      // Guarantee
      '.hatch-guarantee{font-size:11px;color:rgba(255,255,255,0.35);text-align:center;margin-bottom:12px;display:flex;align-items:center;justify-content:center;gap:4px}',
      '.hatch-guarantee::before{content:"🛡"}',
      // Toggle
      '.hatch-toggle{display:flex;align-items:center;justify-content:center;gap:10px;margin-bottom:18px}',
      '.hatch-toggle-label{font-size:13px;color:rgba(255,255,255,0.5);cursor:pointer}',
      '.hatch-toggle-label.active{color:#fff;font-weight:600}',
      '.hatch-switch{width:40px;height:22px;border-radius:11px;background:rgba(255,255,255,0.12);border:none;cursor:pointer;position:relative;transition:background 0.2s;padding:0;outline:none}',
      '.hatch-switch.on{background:var(--hatch-accent,#6366F1)}',
      '.hatch-switch-thumb{position:absolute;top:3px;left:3px;width:16px;height:16px;border-radius:50%;background:#fff;transition:transform 0.2s}',
      '.hatch-switch.on .hatch-switch-thumb{transform:translateX(18px)}',
      '.hatch-badge{font-size:10px;font-weight:600;padding:2px 8px;border-radius:100px;background:rgba(99,102,241,0.15);color:#818CF8}',
      // Plans
      '.hatch-plans{display:grid;gap:10px;margin-bottom:14px}',
      '.hatch-plans.multi{grid-template-columns:repeat(auto-fit,minmax(130px,1fr))}',
      '.hatch-plan{background:rgba(255,255,255,0.04);border:1.5px solid rgba(255,255,255,0.08);border-radius:14px;padding:16px;cursor:pointer;transition:all 0.15s;box-sizing:border-box;position:relative}',
      '.hatch-plan:hover{border-color:rgba(255,255,255,0.15);background:rgba(255,255,255,0.06)}',
      '.hatch-plan.popular{border-color:var(--hatch-accent,rgba(99,102,241,0.5));background:rgba(99,102,241,0.08)}',
      '.hatch-popular-badge{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:var(--hatch-accent,#818CF8);margin-bottom:8px}',
      '.hatch-plan-name{font-size:13px;font-weight:600;color:#fff;margin-bottom:6px}',
      '.hatch-price{font-family:ui-monospace,monospace;font-size:26px;font-weight:700;color:#fff;line-height:1}',
      '.hatch-price-period{font-size:12px;color:rgba(255,255,255,0.4)}',
      '.hatch-features{list-style:none;padding:0;margin:10px 0 0;display:flex;flex-direction:column;gap:5px}',
      '.hatch-feature{display:flex;align-items:flex-start;gap:6px;font-size:11px;color:rgba(255,255,255,0.5);line-height:1.4}',
      '.hatch-check{flex-shrink:0;margin-top:1px}',
      '.hatch-cta{width:100%;padding:11px;border-radius:var(--hatch-btn-radius,10px);border:none;cursor:pointer;font-size:13px;font-weight:600;margin-top:8px;transition:opacity 0.15s}',
      '.hatch-cta.primary{background:var(--hatch-accent,#6366F1);color:#fff}',
      '.hatch-cta.secondary{background:rgba(255,255,255,0.08);color:rgba(255,255,255,0.7)}',
      '.hatch-cta:hover{opacity:0.88}',
      '.hatch-footer{font-size:11px;color:rgba(255,255,255,0.2);text-align:center;margin-top:12px}',
      '.hatch-signin{font-size:11px;color:rgba(255,255,255,0.15);text-align:center;margin-top:4px}',
      '.hatch-powered{font-size:10px;color:rgba(255,255,255,0.1);text-align:center;margin-top:8px}',
    ].join('')
    document.head.appendChild(style)
  }

  // ─── Content builders ───────────────────────────────────────────────────────

  function buildSocialProof(config, accentColor) {
    var type = config.social_proof_type || 'text'
    var text = config.social_proof || ''
    if (!text || type === 'none') return ''
    if (type === 'stars') {
      return '<p class="hatch-social stars"><span>★★★★★</span> ' + esc(text) + '</p>'
    }
    if (type === 'user_count') {
      return '<p class="hatch-social">👥 ' + esc(text) + '</p>'
    }
    return '<p class="hatch-social">✦ ' + esc(text) + '</p>'
  }

  function buildUrgency(config) {
    if (!config.urgency_text) return ''
    return '<div class="hatch-urgency">' + esc(config.urgency_text) + '</div>'
  }

  function buildCountdown(config) {
    if (!config.show_countdown || !config.urgency_end_date) return ''
    var cdId = 'hatch-cd-' + uid().slice(0, 8)
    setTimeout(function() { startCountdown(config.urgency_end_date, cdId) }, 50)
    return '<div class="hatch-countdown" id="' + cdId + '"></div>'
  }

  function buildTrustBadges(config) {
    var badges = config.trust_badges || []
    if (!badges.length) return ''
    return '<div class="hatch-trust">' +
      badges.map(function(b) { return '<span class="hatch-trust-badge">✓ ' + esc(b) + '</span>' }).join('') +
      '</div>'
  }

  function buildGuarantee(config) {
    if (!config.guarantee_text) return ''
    return '<p class="hatch-guarantee"> ' + esc(config.guarantee_text) + '</p>'
  }

  function buildBodyCopy(config) {
    if (!config.body_copy) return ''
    return '<p class="hatch-body">' + esc(config.body_copy) + '</p>'
  }

  function buildYearlyToggle(currentYearly, discountPct) {
    return '<div class="hatch-toggle">' +
      '<span class="hatch-toggle-label' + (!currentYearly ? ' active' : '') + '" id="hatch-label-monthly">Monthly</span>' +
      '<button class="hatch-switch' + (currentYearly ? ' on' : '') + '" id="hatch-yearly-toggle" type="button" aria-label="Toggle yearly billing"><div class="hatch-switch-thumb"></div></button>' +
      '<span class="hatch-toggle-label' + (currentYearly ? ' active' : '') + '" id="hatch-label-yearly">Yearly</span>' +
      '<span class="hatch-badge" style="' + (!currentYearly ? 'display:none' : '') + '" id="hatch-save-badge">Save ' + (discountPct || 20) + '%</span>' +
      '</div>'
  }

  function buildPlan(plan, config, accentColor, currentYearly) {
    var sym = currencySymbol(config.currency)
    var monthlyPrice = Math.round(plan.price_monthly / 100)
    var yearlyMonthly = plan.price_yearly > 0 ? Math.round(plan.price_yearly / 12 / 100) : monthlyPrice
    var displayPrice = currentYearly && plan.price_yearly > 0 ? yearlyMonthly : monthlyPrice
    var isPopular = plan.is_popular
    var btnText = config.cta_copy || 'Get started'
    if (config.show_trial_in_cta) btnText = 'Start free trial'

    var html = '<div class="hatch-plan' + (isPopular ? ' popular' : '') + '" data-plan-id="' + plan.id + '">'
    if (isPopular) html += '<div class="hatch-popular-badge" style="color:' + accentColor + '">★ Most Popular</div>'
    html += '<div class="hatch-plan-name">' + esc(plan.name) + '</div>'
    html += '<div><span class="hatch-price">' + esc(sym) + displayPrice + '</span><span class="hatch-price-period">/mo</span></div>'
    if (currentYearly && plan.price_yearly > 0) {
      html += '<div style="font-size:10px;color:rgba(255,255,255,0.3);margin-top:2px">billed ' + esc(sym) + Math.round(plan.price_yearly / 100) + '/yr</div>'
    }
    if (plan.features && plan.features.length > 0) {
      html += '<ul class="hatch-features">'
      plan.features.slice(0, 4).forEach(function(f) {
        html += '<li class="hatch-feature">'
        html += '<svg class="hatch-check" width="11" height="11" viewBox="0 0 12 12" fill="none"><circle cx="6" cy="6" r="6" fill="' + accentColor + '" opacity="0.2"/><path d="M3.5 6L5.5 8L8.5 4.5" stroke="' + accentColor + '" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>'
        html += esc(f) + '</li>'
      })
      html += '</ul>'
    }
    var btnClass = isPopular ? 'hatch-cta primary' : 'hatch-cta secondary'
    html += '<button class="' + btnClass + '" style="' + (isPopular ? 'background:' + accentColor + ';' : '') + '" data-checkout="' + plan.id + '">' + esc(btnText) + '</button>'
    html += '</div>'
    return html
  }

  function buildPlans(plans, config, accentColor, currentYearly) {
    var html = '<div class="hatch-plans' + (plans.length > 1 ? ' multi' : '') + '">'
    plans.forEach(function(plan) { html += buildPlan(plan, config, accentColor, currentYearly) })
    html += '</div>'
    return html
  }

  function buildFooter(config) {
    var footer = config.footer_text || 'Cancel anytime · No hidden fees'
    var html = '<p class="hatch-footer">' + esc(footer) + '</p>'
    html += '<p class="hatch-signin">Already a subscriber? <a href="#" style="color:rgba(255,255,255,0.3)">Sign in</a></p>'
    if (!config.hide_powered_by) {
      html += '<p class="hatch-powered">⚡ Powered by Hatch</p>'
    }
    return html
  }

  // ─── Template renderers ────────────────────────────────────────────────────

  function renderClassicModal(config, plans, overlay, currentYearly) {
    var accentColor = (config.design && config.design.accentColor) || '#6366F1'
    var yearlyEnabled = config.show_yearly_toggle && plans.some(function(p) { return p.price_yearly > 0 })

    var modal = document.createElement('div')
    modal.id = 'hatch-modal'
    modal.style.setProperty('--hatch-accent', accentColor)
    modal.style.setProperty('--hatch-btn-radius', btnRadius(config.button_shape))
    modal.style.fontFamily = fontFamily(config.font_family)

    var animation = config.animation_style || 'slide'
    if (animation === 'fade') modal.style.animation = 'hatchFadeIn 0.3s ease'
    else if (animation === 'zoom') modal.style.animation = 'hatchZoomIn 0.3s cubic-bezier(0.34,1.56,0.64,1)'
    else if (animation === 'none') modal.style.animation = 'none'
    else modal.style.animation = 'hatchSlideUp 0.35s cubic-bezier(0.34,1.56,0.64,1)'

    var html = ''
    if (config.closeable !== false) html += '<button id="hatch-close" aria-label="Close">✕</button>'
    html += buildUrgency(config)
    html += buildCountdown(config)
    html += '<h2 class="hatch-headline">' + esc(config.headline || 'Unlock full access') + '</h2>'
    if (config.subheadline) html += '<p class="hatch-sub">' + esc(config.subheadline) + '</p>'
    html += buildBodyCopy(config)
    html += buildSocialProof(config, accentColor)
    html += buildTrustBadges(config)
    if (yearlyEnabled) html += buildYearlyToggle(currentYearly, config.yearly_discount_percent)
    html += buildPlans(plans, config, accentColor, currentYearly)
    html += buildGuarantee(config)
    html += buildFooter(config)

    modal.innerHTML = html
    overlay.appendChild(modal)
    return modal
  }

  function renderFullscreen(config, plans, overlay, currentYearly) {
    var accentColor = (config.design && config.design.accentColor) || '#6366F1'
    var yearlyEnabled = config.show_yearly_toggle && plans.some(function(p) { return p.price_yearly > 0 })

    overlay.style.padding = '0'
    var modal = document.createElement('div')
    modal.id = 'hatch-modal'
    modal.className = 'hatch-fullscreen'
    modal.style.setProperty('--hatch-accent', accentColor)
    modal.style.setProperty('--hatch-btn-radius', btnRadius(config.button_shape))
    modal.style.fontFamily = fontFamily(config.font_family)

    var leftHtml = ''
    if (config.closeable !== false) leftHtml += '<button id="hatch-close" aria-label="Close">✕</button>'
    leftHtml += buildUrgency(config)
    leftHtml += buildCountdown(config)
    leftHtml += '<h2 class="hatch-headline lg">' + esc(config.headline || 'Unlock full access') + '</h2>'
    if (config.subheadline) leftHtml += '<p class="hatch-sub">' + esc(config.subheadline) + '</p>'
    leftHtml += buildBodyCopy(config)
    leftHtml += buildSocialProof(config, accentColor)
    leftHtml += buildTrustBadges(config)
    leftHtml += buildGuarantee(config)

    var rightHtml = ''
    if (yearlyEnabled) rightHtml += buildYearlyToggle(currentYearly, config.yearly_discount_percent)
    rightHtml += buildPlans(plans, config, accentColor, currentYearly)
    rightHtml += buildFooter(config)

    modal.innerHTML =
      '<div class="hatch-fs-left" style="position:relative">' + leftHtml + '</div>' +
      '<div class="hatch-fs-right">' + rightHtml + '</div>'

    overlay.appendChild(modal)
    return modal
  }

  function renderSlideIn(config, plans, overlay, currentYearly) {
    var accentColor = (config.design && config.design.accentColor) || '#6366F1'

    overlay.classList.add('hatch-no-dim')

    var modal = document.createElement('div')
    modal.id = 'hatch-modal'
    modal.className = 'hatch-slide-in'
    modal.style.setProperty('--hatch-accent', accentColor)
    modal.style.setProperty('--hatch-btn-radius', btnRadius(config.button_shape))
    modal.style.fontFamily = fontFamily(config.font_family)

    var html = ''
    if (config.closeable !== false) html += '<button id="hatch-close" aria-label="Close">✕</button>'
    html += buildUrgency(config)
    html += '<h2 class="hatch-headline sm">' + esc(config.headline || 'Unlock full access') + '</h2>'
    if (config.subheadline) html += '<p class="hatch-sub" style="font-size:12px">' + esc(config.subheadline) + '</p>'
    html += buildSocialProof(config, accentColor)
    // Only show popular/first plan
    var featuredPlan = plans.find(function(p) { return p.is_popular }) || plans[0]
    if (featuredPlan) {
      var sym = currencySymbol(config.currency)
      var price = Math.round(featuredPlan.price_monthly / 100)
      var btnText = config.cta_copy || 'Get started'
      html += '<div style="margin:10px 0">'
      html += '<div style="font-size:12px;font-weight:600;color:#fff;margin-bottom:4px">' + esc(featuredPlan.name) + '</div>'
      html += '<div><span class="hatch-price" style="font-size:20px">' + esc(sym) + price + '</span><span class="hatch-price-period">/mo</span></div>'
      html += '<button class="hatch-cta primary" style="background:' + accentColor + ';margin-top:10px" data-checkout="' + featuredPlan.id + '">' + esc(btnText) + '</button>'
      html += '</div>'
    }
    html += buildGuarantee(config)
    html += '<p class="hatch-footer" style="font-size:10px">' + esc(config.footer_text || 'Cancel anytime') + '</p>'

    modal.innerHTML = html
    overlay.appendChild(modal)
    return modal
  }

  function renderBottomSheet(config, plans, overlay, currentYearly) {
    var accentColor = (config.design && config.design.accentColor) || '#6366F1'
    var yearlyEnabled = config.show_yearly_toggle && plans.some(function(p) { return p.price_yearly > 0 })

    overlay.style.alignItems = 'flex-end'
    overlay.style.padding = '0'
    overlay.classList.add('hatch-dimmed')

    var modal = document.createElement('div')
    modal.id = 'hatch-modal'
    modal.className = 'hatch-bottom-sheet'
    modal.style.setProperty('--hatch-accent', accentColor)
    modal.style.setProperty('--hatch-btn-radius', btnRadius(config.button_shape))
    modal.style.fontFamily = fontFamily(config.font_family)

    var html = '<div class="hatch-sheet-handle"></div>'
    if (config.closeable !== false) html += '<button id="hatch-close" aria-label="Close" style="top:10px">✕</button>'
    html += buildUrgency(config)
    html += buildCountdown(config)
    html += '<h2 class="hatch-headline">' + esc(config.headline || 'Unlock full access') + '</h2>'
    if (config.subheadline) html += '<p class="hatch-sub">' + esc(config.subheadline) + '</p>'
    html += buildSocialProof(config, accentColor)
    if (yearlyEnabled) html += buildYearlyToggle(currentYearly, config.yearly_discount_percent)
    html += buildPlans(plans, config, accentColor, currentYearly)
    html += buildGuarantee(config)
    html += buildFooter(config)

    modal.innerHTML = html
    overlay.appendChild(modal)
    return modal
  }

  function renderMinimal(config, plans, overlay, currentYearly) {
    var accentColor = (config.design && config.design.accentColor) || '#6366F1'

    overlay.classList.add('hatch-dimmed')
    var modal = document.createElement('div')
    modal.id = 'hatch-modal'
    modal.className = 'hatch-minimal'
    modal.style.setProperty('--hatch-accent', accentColor)
    modal.style.setProperty('--hatch-btn-radius', btnRadius(config.button_shape))
    modal.style.fontFamily = fontFamily(config.font_family)

    var featuredPlan = plans.find(function(p) { return p.is_popular }) || plans[0]
    var sym = currencySymbol(config.currency)

    var html = ''
    if (config.closeable !== false) html += '<button id="hatch-close" aria-label="Close" style="top:10px;right:10px">✕</button>'
    if (config.urgency_text) html += buildUrgency(config)
    html += '<h2 class="hatch-headline sm" style="text-align:center;padding-right:0">' + esc(config.headline || 'Unlock full access') + '</h2>'
    if (config.subheadline) html += '<p class="hatch-sub" style="text-align:center">' + esc(config.subheadline) + '</p>'
    html += buildSocialProof(config, accentColor)
    if (featuredPlan) {
      var price = Math.round(featuredPlan.price_monthly / 100)
      html += '<div style="text-align:center;margin:16px 0">'
      html += '<span class="hatch-price">' + esc(sym) + price + '</span><span class="hatch-price-period">/mo</span>'
      html += '</div>'
      var btnText = config.cta_copy || 'Get started'
      html += '<button class="hatch-cta primary" style="background:' + accentColor + '" data-checkout="' + featuredPlan.id + '">' + esc(btnText) + '</button>'
    }
    html += buildGuarantee(config)
    html += '<p class="hatch-footer">' + esc(config.footer_text || 'Cancel anytime · No hidden fees') + '</p>'

    modal.innerHTML = html
    overlay.appendChild(modal)
    return modal
  }

  function renderSidePanel(config, plans, overlay, currentYearly) {
    var accentColor = (config.design && config.design.accentColor) || '#6366F1'
    var yearlyEnabled = config.show_yearly_toggle && plans.some(function(p) { return p.price_yearly > 0 })

    overlay.style.justifyContent = 'flex-end'
    overlay.style.padding = '0'
    overlay.classList.add('hatch-dimmed')

    var modal = document.createElement('div')
    modal.id = 'hatch-modal'
    modal.className = 'hatch-side-panel'
    modal.style.setProperty('--hatch-accent', accentColor)
    modal.style.setProperty('--hatch-btn-radius', btnRadius(config.button_shape))
    modal.style.fontFamily = fontFamily(config.font_family)

    var html = ''
    if (config.closeable !== false) html += '<button id="hatch-close" aria-label="Close" style="top:16px;right:16px">✕</button>'
    html += buildUrgency(config)
    html += buildCountdown(config)
    html += '<h2 class="hatch-headline" style="font-size:20px">' + esc(config.headline || 'Unlock full access') + '</h2>'
    if (config.subheadline) html += '<p class="hatch-sub">' + esc(config.subheadline) + '</p>'
    html += buildBodyCopy(config)
    html += buildSocialProof(config, accentColor)
    html += buildTrustBadges(config)
    if (yearlyEnabled) html += buildYearlyToggle(currentYearly, config.yearly_discount_percent)
    html += buildPlans(plans, config, accentColor, currentYearly)
    html += buildGuarantee(config)
    html += buildFooter(config)

    modal.innerHTML = html
    overlay.appendChild(modal)
    return modal
  }

  // ─── Main render ───────────────────────────────────────────────────────────

  function renderPaywall(config, plans) {
    if (state.activePaywall) return

    // Inject custom CSS
    if (config.custom_css && !document.getElementById('hatch-custom-css')) {
      var customStyle = document.createElement('style')
      customStyle.id = 'hatch-custom-css'
      customStyle.textContent = config.custom_css
      document.head.appendChild(customStyle)
    }

    var template = config.template || 'classic-modal'
    var yearlyEnabled = config.show_yearly_toggle && plans.some(function(p) { return p.price_yearly > 0 })
    var currentYearly = false

    var overlay = document.createElement('div')
    overlay.id = 'hatch-overlay'

    // Set overlay opacity
    var opacity = config.overlay_opacity != null ? config.overlay_opacity : 65
    overlay.classList.add(template === 'slide-in' ? 'hatch-no-dim' : 'hatch-dimmed')
    if (template !== 'slide-in') {
      overlay.style.background = 'rgba(0,0,0,' + (opacity / 100) + ')'
    }

    function buildAndMount() {
      // Clear existing children (for re-renders)
      while (overlay.firstChild) overlay.removeChild(overlay.firstChild)
      overlay.className = 'hatch-overlay' // reset
      overlay.id = 'hatch-overlay'

      // Re-set opacity
      if (template !== 'slide-in') {
        overlay.style.background = 'rgba(0,0,0,' + (opacity / 100) + ')'
        overlay.style.backdropFilter = 'blur(6px)'
        overlay.style.webkitBackdropFilter = 'blur(6px)'
      }

      var modal
      if (template === 'fullscreen') {
        modal = renderFullscreen(config, plans, overlay, currentYearly)
      } else if (template === 'slide-in') {
        overlay.style.background = 'transparent'
        overlay.style.backdropFilter = 'none'
        overlay.style.webkitBackdropFilter = 'none'
        overlay.style.justifyContent = 'flex-end'
        overlay.style.alignItems = 'flex-end'
        overlay.style.padding = '0'
        overlay.style.pointerEvents = 'none'
        modal = renderSlideIn(config, plans, overlay, currentYearly)
        modal.style.pointerEvents = 'all'
      } else if (template === 'bottom-sheet') {
        modal = renderBottomSheet(config, plans, overlay, currentYearly)
      } else if (template === 'minimal') {
        modal = renderMinimal(config, plans, overlay, currentYearly)
      } else if (template === 'side-panel') {
        modal = renderSidePanel(config, plans, overlay, currentYearly)
      } else {
        // classic-modal (default)
        modal = renderClassicModal(config, plans, overlay, currentYearly)
      }
      return modal
    }

    var modal = buildAndMount()
    document.body.appendChild(overlay)

    markShown(config.id)
    track('paywall_shown', { paywall_id: config.id })

    // Event delegation
    function handleClick(e) {
      var target = e.target

      // Close
      if (target.id === 'hatch-close' || (target.closest && target.closest('#hatch-close'))) {
        closePaywall()
        return
      }

      // Background click
      if (target === overlay && config.closeable !== false) {
        closePaywall()
        return
      }

      // Yearly toggle
      var toggleBtn = target.id === 'hatch-yearly-toggle' ? target : (target.closest && target.closest('#hatch-yearly-toggle'))
      if (toggleBtn) {
        currentYearly = !currentYearly
        buildAndMount()
        return
      }

      // Checkout
      var checkoutBtn = (target.dataset && target.dataset.checkout) ? target : (target.closest && target.closest('[data-checkout]'))
      if (checkoutBtn && checkoutBtn.dataset) {
        var planId = checkoutBtn.dataset.checkout
        track('plan_selected', { plan_id: planId, yearly: currentYearly })
        startCheckout(config, planId, currentYearly)
      }
    }

    overlay.addEventListener('click', handleClick)
    state.activePaywall = { overlay: overlay, config: config, handleClick: handleClick }
  }

  function closePaywall() {
    if (state.activePaywall) {
      var overlay = state.activePaywall.overlay
      overlay.style.animation = 'hatchFadeIn 0.15s ease reverse'
      setTimeout(function() {
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay)
      }, 150)
      state.activePaywall = null

      // Remove custom CSS on close to allow re-injection next time
      var customCss = document.getElementById('hatch-custom-css')
      if (customCss) customCss.parentNode.removeChild(customCss)
    }
  }

  async function startCheckout(config, planId, yearly) {
    track('checkout_started', { plan_id: planId })

    var successUrl = config.success_redirect_url
      || (window.location.href + (window.location.href.includes('?') ? '&' : '?') + 'hatch_success=1')

    try {
      var res = await fetch(API_BASE + '/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          paywallId: config.id,
          planId: planId,
          userId: state.userId,
          email: state.userTraits.email,
          successUrl: successUrl,
          cancelUrl: window.location.href,
          yearly: yearly,
        }),
      })
      var data = await res.json()
      if (data.url) window.location.href = data.url
    } catch (e) {
      console.error('[Hatch] Checkout error:', e)
    }
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  function init(apiKey) {
    if (state.initialized) return
    state.apiKey = apiKey
    state.sessionId = getSession().id

    var storedUser = getStoredUser()
    if (storedUser) {
      state.userId = storedUser.id
      state.userTraits = storedUser.traits || {}
    }

    injectStyles()
    track('page_view', { url: window.location.href })

    if (window.location.search.includes('hatch_success=1')) {
      fetchSubscription()
    }

    state.initialized = true
  }

  function identify(userId, traits) {
    state.userId = userId
    state.userTraits = traits || {}
    storeUser({ id: userId, traits: traits || {} })
    track('identify', { user_id: userId })
    fetchSubscription()
  }

  function track(eventName, properties) {
    if (!state.apiKey) return
    var payload = {
      apiKey: state.apiKey,
      event: eventName,
      userId: state.userId,
      sessionId: state.sessionId,
      paywallId: state.activePaywall ? state.activePaywall.config.id : (properties && properties.paywall_id) || null,
      variantId: state.variantId || null,
      properties: properties || {},
    }
    if (navigator.sendBeacon) {
      var blob = new Blob([JSON.stringify(payload)], { type: 'application/json' })
      navigator.sendBeacon(API_BASE + '/sdk/events', blob)
    } else {
      fetch(API_BASE + '/sdk/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        keepalive: true,
      }).catch(function() {})
    }
  }

  async function show(paywallId) {
    if (!state.apiKey) { console.warn('[Hatch] Not initialized'); return }
    if (state.activePaywall) return

    var url = API_BASE + '/sdk/config?key=' + state.apiKey
    if (paywallId) url += '&paywall=' + paywallId
    if (state.sessionId) url += '&session=' + state.sessionId

    try {
      var res = await fetch(url)
      var data = await res.json()
      var config = data.paywall || (data.paywalls && data.paywalls[0])
      if (!config) { console.warn('[Hatch] No live paywall found'); return }

      if (config._variant_id) state.variantId = config._variant_id

      var plans = config.plan_ids && config.plan_ids.length > 0
        ? (config.plans || []).filter(function(p) { return config.plan_ids.includes(p.id) })
        : (config.plans || [])

      // Apply locale overrides
      var localizedConfig = applyLocale(config)

      // Setup auto-triggers (won't fire if called manually — they're for auto-show)
      setupTriggers(localizedConfig)

      // Manual show — bypass frequency check
      renderPaywall(localizedConfig, plans)
    } catch (e) {
      console.error('[Hatch] Failed to load paywall:', e)
    }
  }

  async function autoShow(apiKey) {
    // Called during init to auto-show based on triggers
    var url = API_BASE + '/sdk/config?key=' + apiKey
    if (state.sessionId) url += '&session=' + state.sessionId

    try {
      var res = await fetch(url)
      var data = await res.json()
      var configs = data.paywalls || (data.paywall ? [data.paywall] : [])
      configs.forEach(function(config) {
        if (!config.trigger_config) return
        var plans = config.plan_ids && config.plan_ids.length > 0
          ? (config.plans || []).filter(function(p) { return config.plan_ids.includes(p.id) })
          : (config.plans || [])
        var localizedConfig = applyLocale(config)
        if (config._variant_id) state.variantId = config._variant_id
        setupTriggers(localizedConfig, plans)
      })
    } catch (e) {}
  }

  function hide() {
    closePaywall()
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

  return {
    init: init,
    identify: identify,
    track: track,
    show: show,
    hide: hide,
    getSubscription: getSubscription,
  }
})
