(function () {
  "use strict";

  var script = document.currentScript;
  var scriptUrl = new URL((script && script.src) || "https://coinpayportal.com/payments.js");
  var apiBase = scriptUrl.origin;
  var merchantId = script && script.getAttribute("data-merchant-id");
  var forcedTheme = script && script.getAttribute("data-theme");
  var defaultAmount = script && script.getAttribute("data-amount");
  var defaultCurrency = script && script.getAttribute("data-currency");
  var defaultDescription = script && script.getAttribute("data-description");
  var buttonText = (script && script.getAttribute("data-button-text")) || "Pay with CoinPay";

  var configPromise = null;
  var pollTimer = null;

  function getTheme() {
    if (forcedTheme === "light" || forcedTheme === "dark") return forcedTheme;
    var colorScheme = getComputedStyle(document.documentElement).colorScheme;
    if (colorScheme && colorScheme.split(" ").indexOf("dark") !== -1) return "dark";
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }

  function fetchJson(path, options) {
    return fetch(apiBase + path, options).then(function (response) {
      return response.json().then(function (data) {
        if (!response.ok || data.success === false) {
          throw new Error(data.error || "CoinPay request failed");
        }
        return data;
      });
    });
  }

  function loadConfig() {
    if (!merchantId) return Promise.reject(new Error("CoinPay merchant id is required"));
    if (!configPromise) {
      configPromise = fetchJson(
        "/api/payments/widget/config?merchant_id=" + encodeURIComponent(merchantId)
      );
    }
    return configPromise;
  }

  function ensureStyles() {
    if (document.getElementById("coinpay-widget-styles")) return;
    var style = document.createElement("style");
    style.id = "coinpay-widget-styles";
    style.textContent = [
      ".cpw-open{border:0;border-radius:8px;padding:10px 14px;font:600 14px system-ui,-apple-system,Segoe UI,sans-serif;background:#111827;color:#fff;cursor:pointer}",
      ".cpw-open:hover{background:#1f2937}",
      ".cpw-backdrop{position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;padding:18px;background:rgba(0,0,0,.52)}",
      ".cpw-modal{width:min(460px,100%);border-radius:12px;border:1px solid var(--cpw-border);background:var(--cpw-bg);color:var(--cpw-fg);box-shadow:0 24px 80px rgba(0,0,0,.38);font:14px system-ui,-apple-system,Segoe UI,sans-serif}",
      ".cpw-modal[data-theme=dark]{--cpw-bg:#0f172a;--cpw-fg:#f8fafc;--cpw-muted:#94a3b8;--cpw-border:#334155;--cpw-field:#111827;--cpw-accent:#22c55e}",
      ".cpw-modal[data-theme=light]{--cpw-bg:#fff;--cpw-fg:#111827;--cpw-muted:#6b7280;--cpw-border:#d1d5db;--cpw-field:#f9fafb;--cpw-accent:#16a34a}",
      ".cpw-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:16px 18px;border-bottom:1px solid var(--cpw-border)}",
      ".cpw-title{font-size:16px;font-weight:700}",
      ".cpw-close{border:0;background:transparent;color:var(--cpw-muted);font-size:24px;line-height:1;cursor:pointer}",
      ".cpw-body{padding:18px;display:grid;gap:14px}",
      ".cpw-field{display:grid;gap:6px}",
      ".cpw-field span{color:var(--cpw-muted);font-size:12px;font-weight:600}",
      ".cpw-field input,.cpw-field select{width:100%;box-sizing:border-box;border:1px solid var(--cpw-border);border-radius:8px;padding:10px;background:var(--cpw-field);color:var(--cpw-fg);font:14px system-ui,-apple-system,Segoe UI,sans-serif}",
      ".cpw-row{display:grid;grid-template-columns:1fr 1fr;gap:10px}",
      ".cpw-actions{display:flex;justify-content:flex-end;gap:10px;margin-top:2px}",
      ".cpw-btn{border:0;border-radius:8px;padding:10px 14px;font-weight:700;cursor:pointer}",
      ".cpw-btn-primary{background:var(--cpw-accent);color:#fff}",
      ".cpw-btn-secondary{background:transparent;color:var(--cpw-fg);border:1px solid var(--cpw-border)}",
      ".cpw-msg{color:var(--cpw-muted);font-size:13px;line-height:1.45}",
      ".cpw-error{color:#ef4444;font-size:13px}",
      ".cpw-payment{display:grid;gap:12px}",
      ".cpw-qr{width:180px;height:180px;justify-self:center;border-radius:8px;background:#fff;padding:8px}",
      ".cpw-code{word-break:break-all;border:1px solid var(--cpw-border);border-radius:8px;background:var(--cpw-field);padding:10px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}",
      ".cpw-status{font-weight:700;color:var(--cpw-accent)}",
      "@media(max-width:420px){.cpw-row{grid-template-columns:1fr}.cpw-actions{flex-direction:column}.cpw-btn{width:100%}}"
    ].join("");
    document.head.appendChild(style);
  }

  function closeModal(backdrop) {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    if (backdrop && backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
  }

  function renderShell(title) {
    ensureStyles();
    var backdrop = document.createElement("div");
    backdrop.className = "cpw-backdrop";
    backdrop.innerHTML =
      '<div class="cpw-modal" role="dialog" aria-modal="true" data-theme="' + getTheme() + '">' +
      '<div class="cpw-head"><div class="cpw-title">' + escapeHtml(title) + '</div><button class="cpw-close" aria-label="Close">&times;</button></div>' +
      '<div class="cpw-body"><div class="cpw-msg">Loading...</div></div>' +
      "</div>";
    backdrop.querySelector(".cpw-close").addEventListener("click", function () {
      closeModal(backdrop);
    });
    backdrop.addEventListener("click", function (event) {
      if (event.target === backdrop) closeModal(backdrop);
    });
    document.body.appendChild(backdrop);
    return {
      backdrop: backdrop,
      body: backdrop.querySelector(".cpw-body")
    };
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function normalizeOptions(options) {
    options = options || {};
    return {
      amountUsd: Number(options.amountUsd || options.amount_usd || defaultAmount || 0),
      currency: String(options.currency || defaultCurrency || "").toLowerCase(),
      description: options.description || defaultDescription || "Payment",
      successUrl: options.successUrl || options.success_url || window.location.href,
      cancelUrl: options.cancelUrl || options.cancel_url || window.location.href,
      metadata: options.metadata || {}
    };
  }

  function renderForm(view, config, options) {
    var currencies = [];
    if (config.accepts_card) currencies.push({ value: "card", label: "Card" });
    (config.chains || []).forEach(function (chain) {
      currencies.push({ value: chain.toLowerCase(), label: chain });
    });
    var selectedCurrency = options.currency || config.default_currency || (currencies[0] && currencies[0].value) || "";

    view.body.innerHTML =
      '<div class="cpw-msg">' + escapeHtml(config.display_name) + '</div>' +
      '<div class="cpw-row">' +
      '<label class="cpw-field"><span>Amount USD</span><input type="number" min="0.01" step="0.01" value="' + escapeHtml(options.amountUsd || "") + '" data-cpw-amount></label>' +
      '<label class="cpw-field"><span>Pay with</span><select data-cpw-currency>' +
      currencies.map(function (currency) {
        return '<option value="' + escapeHtml(currency.value) + '"' + (currency.value === selectedCurrency ? " selected" : "") + ">" + escapeHtml(currency.label) + "</option>";
      }).join("") +
      "</select></label>" +
      "</div>" +
      '<label class="cpw-field"><span>Description</span><input type="text" value="' + escapeHtml(options.description) + '" data-cpw-description></label>' +
      '<div class="cpw-error" hidden></div>' +
      '<div class="cpw-actions"><button class="cpw-btn cpw-btn-secondary" data-cpw-cancel>Cancel</button><button class="cpw-btn cpw-btn-primary" data-cpw-create>Create payment</button></div>';

    view.body.querySelector("[data-cpw-cancel]").addEventListener("click", function () {
      closeModal(view.backdrop);
    });
    view.body.querySelector("[data-cpw-create]").addEventListener("click", function () {
      var errorEl = view.body.querySelector(".cpw-error");
      var amount = Number(view.body.querySelector("[data-cpw-amount]").value);
      var currency = view.body.querySelector("[data-cpw-currency]").value;
      var description = view.body.querySelector("[data-cpw-description]").value;
      if (!amount || amount <= 0) {
        errorEl.textContent = "Enter a valid amount.";
        errorEl.hidden = false;
        return;
      }
      errorEl.hidden = true;
      createPayment(view, {
        amountUsd: amount,
        currency: currency,
        description: description,
        successUrl: options.successUrl,
        cancelUrl: options.cancelUrl,
        metadata: options.metadata
      });
    });
  }

  function createPayment(view, options) {
    view.body.innerHTML = '<div class="cpw-msg">Creating payment...</div>';
    fetchJson("/api/payments/widget/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        merchant_id: merchantId,
        amount_usd: options.amountUsd,
        currency: options.currency,
        payment_method: options.currency === "card" ? "card" : "crypto",
        description: options.description,
        success_url: options.successUrl,
        cancel_url: options.cancelUrl,
        metadata: options.metadata
      })
    })
      .then(function (data) {
        renderPayment(view, data.payment);
      })
      .catch(function (error) {
        view.body.innerHTML = '<div class="cpw-error">' + escapeHtml(error.message) + '</div>';
      });
  }

  function renderPayment(view, payment) {
    if (payment.checkout_url) {
      view.body.innerHTML =
        '<div class="cpw-payment">' +
        '<div class="cpw-msg">Card checkout is ready.</div>' +
        '<a class="cpw-btn cpw-btn-primary" style="text-align:center;text-decoration:none" target="_blank" rel="noopener" href="' + escapeHtml(payment.checkout_url) + '">Open checkout</a>' +
        '<div class="cpw-status" data-cpw-status>Pending</div>' +
        "</div>";
    } else {
      view.body.innerHTML =
        '<div class="cpw-payment">' +
        '<img class="cpw-qr" alt="Payment QR code" src="' + apiBase + escapeHtml(payment.qr_url) + '">' +
        '<div class="cpw-msg">Send <strong>' + escapeHtml(payment.amount_crypto || "") + " " + escapeHtml(payment.currency) + '</strong> to:</div>' +
        '<div class="cpw-code">' + escapeHtml(payment.address || "") + '</div>' +
        '<div class="cpw-status" data-cpw-status>Pending</div>' +
        "</div>";
    }
    startPolling(view, payment.id);
  }

  function startPolling(view, paymentId) {
    var statusEl = view.body.querySelector("[data-cpw-status]");
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(function () {
      fetchJson("/api/payments/widget/status/" + encodeURIComponent(paymentId))
        .then(function (data) {
          var status = data.payment && data.payment.status ? data.payment.status : "pending";
          statusEl.textContent = status.charAt(0).toUpperCase() + status.slice(1);
          if (["confirmed", "completed", "forwarded", "failed", "expired"].indexOf(status) !== -1) {
            clearInterval(pollTimer);
            pollTimer = null;
          }
        })
        .catch(function () {});
    }, 5000);
  }

  function open(options) {
    var normalized = normalizeOptions(options);
    var view = renderShell("CoinPay Checkout");
    loadConfig()
      .then(function (config) {
        if (!config.accepts_card && !config.accepts_crypto) {
          throw new Error("This merchant has not enabled payment rails.");
        }
        renderForm(view, config, normalized);
      })
      .catch(function (error) {
        view.body.innerHTML = '<div class="cpw-error">' + escapeHtml(error.message) + '</div>';
      });
  }

  function enhanceElement(element) {
    element.addEventListener("click", function (event) {
      event.preventDefault();
      open({
        amountUsd: element.getAttribute("data-coinpay-amount"),
        currency: element.getAttribute("data-coinpay-currency"),
        description: element.getAttribute("data-coinpay-description")
      });
    });
  }

  function boot() {
    if (!merchantId) return;
    document.querySelectorAll("[data-coinpay-checkout]").forEach(enhanceElement);
    if (defaultAmount && script) {
      var button = document.createElement("button");
      button.type = "button";
      button.className = "cpw-open";
      button.textContent = buttonText;
      enhanceElement(button);
      script.parentNode.insertBefore(button, script.nextSibling);
    }
  }

  window.CoinPay = window.CoinPay || {};
  window.CoinPay.open = open;
  window.CoinPay.loadConfig = loadConfig;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
