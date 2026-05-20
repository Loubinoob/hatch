/**
 * Hatch SDK v1.0.0
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

  var state = {
    apiKey: null,
    userId: null,
    userTraits: {},
    sessionId: null,
    subscription: null,
    config: null,
    activePaywall: null,
    initialized: false,
  }

  // ─── Utils ─────────────────────────────────────────────────────────────────

  function uid() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
    })
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

  function injectStyles() {
    if (document.getElementById('hatch-styles')) return
    var style = document.createElement('style')
    style.id = 'hatch-styles'
    style.textContent = [
      '@keyframes hatchFadeIn{from{opacity:0}to{opacity:1}}',
      '@keyframes hatchSlideUp{from{opacity:0;transform:translateY(24px) scale(0.97)}to{opacity:1;transform:translateY(0) scale(1)}}',
      '#hatch-overlay{position:fixed;inset:0;background:rgba(0,0,0,0.65);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);z-index:999998;animation:hatchFadeIn 0.2s ease;display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box}',
      '#hatch-modal{background:#0F0F12;border:1px solid rgba(255,255,255,0.1);border-radius:20px;max-width:480px;width:100%;max-height:90vh;overflow-y:auto;box-shadow:0 25px 50px -12px rgba(0,0,0,0.8);animation:hatchSlideUp 0.35s cubic-bezier(0.34,1.56,0.64,1);position:relative;box-sizing:border-box;padding:28px}',
      '#hatch-close{position:absolute;top:14px;right:14px;background:rgba(255,255,255,0.07);border:none;border-radius:50%;width:30px;height:30px;cursor:pointer;display:flex;align-items:center;justify-content:center;color:rgba(255,255,255,0.4);font-size:16px;transition:background 0.15s;z-index:1}',
      '#hatch-close:hover{background:rgba(255,255,255,0.12);color:rgba(255,255,255,0.7)}',
      '.hatch-headline{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:22px;font-weight:700;color:#fff;margin:0 0 6px;line-height:1.3;padding-right:32px}',
      '.hatch-sub{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:14px;color:rgba(255,255,255,0.5);margin:0 0 16px}',
      '.hatch-social{font-size:12px;color:rgba(255,255,255,0.35);margin-bottom:16px}',
      '.hatch-toggle{display:flex;align-items:center;justify-content:center;gap:10px;margin-bottom:20px}',
      '.hatch-toggle-label{font-family:-apple-system,sans-serif;font-size:13px;color:rgba(255,255,255,0.5);cursor:pointer}',
      '.hatch-toggle-label.active{color:#fff}',
      '.hatch-switch{width:40px;height:22px;border-radius:11px;background:rgba(255,255,255,0.12);border:none;cursor:pointer;position:relative;transition:background 0.2s;padding:0;outline:none}',
      '.hatch-switch.on{background:var(--hatch-accent,#6366F1)}',
      '.hatch-switch-thumb{position:absolute;top:3px;left:3px;width:16px;height:16px;border-radius:50%;background:#fff;transition:transform 0.2s}',
      '.hatch-switch.on .hatch-switch-thumb{transform:translateX(18px)}',
      '.hatch-badge{font-size:10px;font-weight:600;padding:2px 8px;border-radius:100px;background:rgba(99,102,241,0.15);color:#818CF8}',
      '.hatch-plans{display:grid;gap:10px;margin-bottom:16px}',
      '.hatch-plans.multi{grid-template-columns:repeat(auto-fit,minmax(130px,1fr))}',
      '.hatch-plan{background:rgba(255,255,255,0.04);border:1.5px solid rgba(255,255,255,0.08);border-radius:14px;padding:16px;cursor:pointer;transition:border-color 0.15s,background 0.15s;box-sizing:border-box;position:relative}',
      '.hatch-plan:hover{border-color:rgba(255,255,255,0.15);background:rgba(255,255,255,0.06)}',
      '.hatch-plan.popular{border-color:rgba(99,102,241,0.5);background:rgba(99,102,241,0.08)}',
      '.hatch-popular-badge{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:var(--hatch-accent,#818CF8);margin-bottom:8px}',
      '.hatch-plan-name{font-family:-apple-system,sans-serif;font-size:13px;font-weight:600;color:#fff;margin-bottom:6px}',
      '.hatch-price{font-family:ui-monospace,monospace;font-size:26px;font-weight:700;color:#fff;line-height:1}',
      '.hatch-price-period{font-size:12px;color:rgba(255,255,255,0.4)}',
      '.hatch-features{list-style:none;padding:0;margin:12px 0 0;display:flex;flex-direction:column;gap:5px}',
      '.hatch-feature{display:flex;align-items:flex-start;gap:6px;font-family:-apple-system,sans-serif;font-size:11px;color:rgba(255,255,255,0.5);line-height:1.4}',
      '.hatch-check{flex-shrink:0;margin-top:1px}',
      '.hatch-cta{width:100%;padding:11px;border-radius:10px;border:none;cursor:pointer;font-family:-apple-system,sans-serif;font-size:13px;font-weight:600;margin-top:10px;transition:opacity 0.15s}',
      '.hatch-cta.primary{background:var(--hatch-accent,#6366F1);color:#fff}',
      '.hatch-cta.secondary{background:rgba(255,255,255,0.08);color:rgba(255,255,255,0.7)}',
      '.hatch-cta:hover{opacity:0.88}',
      '.hatch-footer{font-size:11px;color:rgba(255,255,255,0.2);text-align:center;margin-top:12px}',
      '.hatch-signin{font-size:11px;color:rgba(255,255,255,0.15);text-align:center;margin-top:4px}',
    ].join('')
    document.head.appendChild(style)
  }

  function renderPaywall(config, plans) {
    var accentColor = (config.design && config.design.accentColor) || '#6366F1'
    var yearlyEnabled = config.show_yearly_toggle && plans.some(function(p) { return p.price_yearly > 0 })
    var currentYearly = false

    var overlay = document.createElement('div')
    overlay.id = 'hatch-overlay'

    function buildModal() {
      var modal = document.createElement('div')
      modal.id = 'hatch-modal'
      modal.style.setProperty('--hatch-accent', accentColor)

      var html = ''

      if (config.closeable !== false) {
        html += '<button id="hatch-close" aria-label="Close">✕</button>'
      }

      html += '<h2 class="hatch-headline">' + esc(config.headline || 'Unlock full access') + '</h2>'

      if (config.subheadline) {
        html += '<p class="hatch-sub">' + esc(config.subheadline) + '</p>'
      }

      if (config.social_proof) {
        html += '<p class="hatch-social">✦ ' + esc(config.social_proof) + '</p>'
      }

      if (yearlyEnabled) {
        html += '<div class="hatch-toggle">'
        html += '<span class="hatch-toggle-label' + (!currentYearly ? ' active' : '') + '" id="hatch-label-monthly">Monthly</span>'
        html += '<button class="hatch-switch' + (currentYearly ? ' on' : '') + '" id="hatch-yearly-toggle" type="button" aria-label="Toggle yearly billing"><div class="hatch-switch-thumb"></div></button>'
        html += '<span class="hatch-toggle-label' + (currentYearly ? ' active' : '') + '" id="hatch-label-yearly">Yearly</span>'
        html += '<span class="hatch-badge" style="' + (currentYearly ? '' : 'display:none') + '" id="hatch-save-badge">Save 20%</span>'
        html += '</div>'
      }

      html += '<div class="hatch-plans' + (plans.length > 1 ? ' multi' : '') + '">'
      plans.forEach(function(plan) {
        var monthlyPrice = Math.round(plan.price_monthly / 100)
        var yearlyMonthly = plan.price_yearly > 0 ? Math.round(plan.price_yearly / 12 / 100) : monthlyPrice
        var displayPrice = currentYearly && plan.price_yearly > 0 ? yearlyMonthly : monthlyPrice
        var isPopular = plan.is_popular

        html += '<div class="hatch-plan' + (isPopular ? ' popular' : '') + '" data-plan-id="' + plan.id + '">'
        if (isPopular) {
          html += '<div class="hatch-popular-badge" style="color:' + accentColor + '">★ Most Popular</div>'
        }
        html += '<div class="hatch-plan-name">' + esc(plan.name) + '</div>'
        html += '<div><span class="hatch-price">$' + displayPrice + '</span><span class="hatch-price-period">/mo</span></div>'

        if (plan.features && plan.features.length > 0) {
          html += '<ul class="hatch-features">'
          plan.features.slice(0, 4).forEach(function(f) {
            html += '<li class="hatch-feature">'
            html += '<svg class="hatch-check" width="11" height="11" viewBox="0 0 12 12" fill="none"><circle cx="6" cy="6" r="6" fill="' + accentColor + '" opacity="0.2"/><path d="M3.5 6L5.5 8L8.5 4.5" stroke="' + accentColor + '" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>'
            html += esc(f)
            html += '</li>'
          })
          html += '</ul>'
        }

        var btnClass = isPopular ? 'hatch-cta primary' : 'hatch-cta secondary'
        html += '<button class="' + btnClass + '" style="' + (isPopular ? 'background:' + accentColor : '') + '" data-checkout="' + plan.id + '">' + esc(config.cta_copy || 'Get started') + '</button>'
        html += '</div>'
      })
      html += '</div>'

      html += '<p class="hatch-footer">Cancel anytime · No hidden fees</p>'
      html += '<p class="hatch-signin">Already a subscriber? <a href="#" style="color:rgba(255,255,255,0.3)">Sign in</a></p>'

      modal.innerHTML = html
      return modal
    }

    var modal = buildModal()
    overlay.appendChild(modal)
    document.body.appendChild(overlay)

    // Track paywall shown
    track('paywall_shown', { paywall_id: config.id })

    // Bind events
    overlay.addEventListener('click', function(e) {
      if (e.target === overlay && config.closeable !== false) closePaywall()
    })

    modal.addEventListener('click', function(e) {
      var target = e.target
      if (target.id === 'hatch-close') { closePaywall(); return }

      if (target.id === 'hatch-yearly-toggle' || target.closest && target.closest('#hatch-yearly-toggle')) {
        currentYearly = !currentYearly
        var newModal = buildModal()
        overlay.removeChild(modal)
        overlay.appendChild(newModal)
        modal = newModal
        bindEvents()
        return
      }

      var checkoutBtn = target.dataset && target.dataset.checkout ? target : (target.closest && target.closest('[data-checkout]'))
      if (checkoutBtn) {
        var planId = checkoutBtn.dataset.checkout
        track('plan_selected', { plan_id: planId, yearly: currentYearly })
        startCheckout(config, planId, currentYearly)
        return
      }
    })

    function bindEvents() {
      overlay.removeEventListener('click', arguments.callee)
      overlay.addEventListener('click', function(e) {
        if (e.target === overlay && config.closeable !== false) closePaywall()
      })
    }

    state.activePaywall = { overlay: overlay, config: config }
  }

  function closePaywall() {
    if (state.activePaywall) {
      var overlay = state.activePaywall.overlay
      overlay.style.animation = 'hatchFadeIn 0.15s ease reverse'
      setTimeout(function() {
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay)
      }, 150)
      state.activePaywall = null
    }
  }

  async function startCheckout(config, planId, yearly) {
    track('checkout_started', { plan_id: planId })

    var body = {
      paywallId: config.id,
      planId: planId,
      userId: state.userId,
      email: state.userTraits.email,
      successUrl: window.location.href + (window.location.href.includes('?') ? '&' : '?') + 'hatch_success=1',
      cancelUrl: window.location.href,
    }

    try {
      var res = await fetch(API_BASE + '/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      var data = await res.json()
      if (data.url) {
        window.location.href = data.url
      }
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

    // Check for post-checkout success
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

    // Fetch subscription status
    fetchSubscription()
  }

  function track(eventName, properties) {
    if (!state.apiKey) return
    var payload = {
      apiKey: state.apiKey,
      event: eventName,
      userId: state.userId,
      sessionId: state.sessionId,
      paywallId: state.activePaywall ? state.activePaywall.config.id : null,
      properties: properties || {},
    }
    // Fire-and-forget
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

    try {
      var res = await fetch(url)
      var data = await res.json()
      var config = data.paywall || (data.paywalls && data.paywalls[0])
      if (!config) { console.warn('[Hatch] No live paywall found'); return }

      var plans = config.plan_ids && config.plan_ids.length > 0
        ? config.plans.filter(function(p) { return config.plan_ids.includes(p.id) })
        : config.plans

      renderPaywall(config, plans || [])
    } catch (e) {
      console.error('[Hatch] Failed to load paywall:', e)
    }
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
    } catch (e) {
      return null
    }
  }

  function esc(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
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
