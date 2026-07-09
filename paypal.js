const BASE_URL = process.env.PAYPAL_ENV === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
async function getAccessToken() {
  const auth = Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString('base64');
  const res = await fetch(`${BASE_URL}/v1/oauth2/token`, { method: 'POST', headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=client_credentials' });
  const data = await res.json();
  return data.access_token;
}
async function createOrder(eurAmount, orderRef) {
  const token = await getAccessToken();
  const res = await fetch(`${BASE_URL}/v2/checkout/orders`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ intent: 'CAPTURE', purchase_units: [{ reference_id: orderRef, amount: { currency_code: 'EUR', value: eurAmount.toFixed(2) } }] }) });
  const data = await res.json();
  return { id: data.id, approveUrl: data.links?.find(l => l.rel === 'approve')?.href };
}
async function captureOrder(paypalOrderId) {
  const token = await getAccessToken();
  const res = await fetch(`${BASE_URL}/v2/checkout/orders/${paypalOrderId}/capture`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } });
  const data = await res.json();
  return { captured: data.status === 'COMPLETED', captureId: data.id, status: data.status };
}
module.exports = { createOrder, captureOrder };
