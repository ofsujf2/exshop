/**
 * Crypto payment helper.
 */
const WALLETS = {
  bitcoin: process.env.BTC_WALLET_ADDRESS,
  ethereum: process.env.ETH_WALLET_ADDRESS,
  solana: process.env.SOL_WALLET_ADDRESS,
  litecoin: process.env.LTC_WALLET_ADDRESS,
};

const COINGECKO_IDS = {
  bitcoin: 'bitcoin',
  ethereum: 'ethereum',
  solana: 'solana',
  litecoin: 'litecoin',
};

const OFFSET_DECIMALS = {
  bitcoin: 8,
  litecoin: 8,
  ethereum: 6,
  solana: 6,
};

function getWallet(currency) {
  const address = WALLETS[currency];
  if (!address) throw new Error(`No wallet configured for ${currency}`);
  return address;
}

async function getEurPrice(currency) {
  const id = COINGECKO_IDS[currency];
  const res = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=eur`);
  if (!res.ok) throw new Error(`CoinGecko error: ${res.status}`);
  const data = await res.json();
  return data[id].eur;
}

function offsetFromOrderId(orderId, currency) {
  let hash = 0;
  for (const ch of orderId) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const units = hash % 999 + 1;
  return units / 10 ** OFFSET_DECIMALS[currency];
}

async function computeCryptoAmount(currency, eurAmount, orderId) {
  const price = await getEurPrice(currency);
  const base = eurAmount / price;
  const offset = offsetFromOrderId(orderId, currency);
  return Number((base + offset).toFixed(OFFSET_DECIMALS[currency]));
}

module.exports = { getWallet, computeCryptoAmount, verifyPayment: async () => ({ paid: false }) };
