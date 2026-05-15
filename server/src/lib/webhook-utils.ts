export interface WebhookResult {
  siteId: string;
  amount: number;
  currency: string;
  paymentMethod: string;
  provider: string;
  orderId: string;
  sessionId?: string;
  utmSource?: string;
  utmCampaign?: string;
  subscriptionId?: string;
  eventType: 'payment' | 'subscription' | 'refund';
}

export async function verifyMidtransSignature(
  orderId: string,
  statusCode: string,
  grossAmount: string,
  serverKey: string,
  signatureKey: string,
): Promise<boolean> {
  const input = `${orderId}${statusCode}${grossAmount}${serverKey}`;
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-512', data);
  const computed = Array.from(new Uint8Array(hashBuffer), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
  if (computed.length !== signatureKey.length) return false;
  let result = 0;
  for (let i = 0; i < computed.length; i++) {
    result |= computed.charCodeAt(i) ^ signatureKey.charCodeAt(i);
  }
  return result === 0;
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

export function parseMidtransPaymentMethod(paymentType: string): string {
  const map: Record<string, string> = {
    'gopay': 'gopay', 'qris': 'qris', 'bank_transfer': 'va',
    'credit_card': 'credit_card', 'echannel': 'va_mandiri',
    'bca_va': 'va_bca', 'bni_va': 'va_bni', 'bri_va': 'va_bri',
    'cstore': 'cstore', 'shopeepay': 'shopeepay', 'ovo': 'ovo',
    'dana': 'dana', 'linkaja': 'linkaja', 'kredivo': 'kredivo',
    'akulaku': 'akulaku',
  };
  return map[paymentType] || paymentType;
}

export function mapXenditMethod(method: string, channel: string): string {
  const channelMap: Record<string, string> = {
    'OVO': 'ovo', 'DANA': 'dana', 'LINKAJA': 'linkaja',
    'SHOPEEPAY': 'shopeepay', 'BCA': 'va_bca', 'BNI': 'va_bni',
    'BRI': 'va_bri', 'MANDIRI': 'va_mandiri', 'PERMATA': 'va_permata',
    'QR_CODE': 'qris',
  };
  return channelMap[channel] || channel.toLowerCase();
}

export function categorizeChannel(referrer: string | null, utmSource: string | null, utmMedium: string | null): string {
  if (utmMedium === 'cpc' || utmMedium === 'ppc' || utmMedium === 'paid') return 'Paid';
  if (utmMedium === 'email') return 'Email';
  if (utmMedium === 'social' || utmMedium === 'social-media') return 'Social Media';
  if (!referrer) return 'Direct';
  const social = ['facebook.com', 'twitter.com', 'x.com', 'instagram.com', 'tiktok.com', 'linkedin.com', 'youtube.com', 'reddit.com'];
  const search = ['google.com', 'bing.com', 'yahoo.com', 'baidu.com', 'duckduckgo.com', 'yandex.com', 'google.co.id'];
  const ref = referrer.toLowerCase();
  if (social.some(s => ref.includes(s))) return 'Social Media';
  if (search.some(s => ref.includes(s))) return 'Organic Search';
  return 'Referral';
}
