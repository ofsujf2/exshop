(function () {
  const { productId } = window.__CHECKOUT__;

  function getShippingData() {
    const form = document.getElementById('checkout-form');
    if (!form.reportValidity()) return null;
    const fd = new FormData(form);
    return Object.fromEntries(fd.entries());
  }

  if (window.paypal) {
    paypal.Buttons({
      createOrder: async () => {
        const shipping = getShippingData();
        if (!shipping) throw new Error('Please fill in shipping details first.');
        const res = await fetch(`/checkout/${productId}/paypal/create`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(shipping),
        });
        const data = await res.json();
        window.__lastOrderId = data.orderId;
        return data.paypalOrderId;
      },
      onApprove: async () => {
        const res = await fetch(`/checkout/${window.__lastOrderId}/paypal/capture`, { method: 'POST' });
        const data = await res.json();
        if (data.status === 'paid') {
          alert('Payment confirmed! Your order will ship soon.');
        } else {
          alert('Payment could not be confirmed. Please contact support.');
        }
      },
      onError: (err) => {
        console.error(err);
        alert(err.message || 'PayPal checkout failed.');
      },
    }).render('#paypal-button-container');
  }

  const cryptoListEl = document.getElementById('crypto-list');
  const cryptoPayBtn = document.getElementById('crypto-pay-btn');
  let selectedCurrency = null;

  document.getElementById('toggle-crypto-btn').addEventListener('click', () => {
    cryptoListEl.classList.toggle('show');
  });

  document.querySelectorAll('.crypto-option').forEach((el) => {
    el.addEventListener('click', () => {
      document.querySelectorAll('.crypto-option').forEach(o => o.classList.remove('selected'));
      el.classList.add('selected');
      selectedCurrency = el.dataset.currency;
      cryptoPayBtn.disabled = false;
      cryptoPayBtn.textContent = `Pay with ${el.querySelector('strong').textContent}`;
    });
  });

  cryptoPayBtn.addEventListener('click', async () => {
    if (!selectedCurrency) return;
    const shipping = getShippingData();
    if (!shipping) return;

    cryptoPayBtn.disabled = true;
    cryptoPayBtn.textContent = 'Creating order…';

    try {
      const res = await fetch(`/checkout/${productId}/crypto/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...shipping, currency: selectedCurrency }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not create order');

      showCryptoPaymentBox(data);
      pollStatus(data.orderId);
    } catch (err) {
      alert(err.message);
    } finally {
      cryptoPayBtn.disabled = false;
      cryptoPayBtn.textContent = 'Retry';
    }
  });

  function showCryptoPaymentBox({ address, amount, currency }) {
    const box = document.getElementById('crypto-payment-box');
    const symbol = { bitcoin: 'BTC', ethereum: 'ETH', solana: 'SOL', litecoin: 'LTC' }[currency];
    document.getElementById('crypto-amount').textContent = `${amount} ${symbol}`;
    document.getElementById('crypto-address').textContent = address;

    const uri = `${currency}:${address}?amount=${amount}`;
    document.getElementById('crypto-qr').src =
      `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(uri)}`;

    box.classList.add('show');
    setStatus('waiting', 'Waiting for payment…');
  }

  function setStatus(kind, text) {
    const el = document.getElementById('crypto-status');
    el.className = `crypto-status ${kind}`;
    el.textContent = text;
  }

  function pollStatus(orderId) {
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/checkout/status/${orderId}`);
        const data = await res.json();
        if (data.status === 'paid' || data.status === 'shipped') {
          setStatus('paid', '✅ Payment confirmed! Your order will ship soon.');
          clearInterval(interval);
        }
      } catch (err) {
        console.error('Status check failed:', err);
      }
    }, 15000);
  }
})();