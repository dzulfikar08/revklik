use base64::Engine;
use hmac::{Hmac, Mac};
use sha2::{Digest, Sha256, Sha512};

type HmacSha256 = Hmac<Sha256>;

/// Timing-safe compare of two equal-length byte slices.
pub fn timing_safe_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

/// Standard Webhooks verification (Polar). Headers: webhook-id, webhook-timestamp,
/// webhook-signature: "v1,{base64sig}". Secret is "whsec_..." base64.
/// Returns Ok(()) if valid.
pub fn verify_standard_webhook(
    msg_id: &str,
    timestamp: &str,
    signature_header: &str,
    body: &[u8],
    secret: &str,
) -> bool {
    let secret = secret.strip_prefix("whsec_").unwrap_or(secret);
    let Ok(key) = base64::engine::general_purpose::STANDARD.decode(secret) else {
        return false;
    };
    let signed = format!("{msg_id}.{timestamp}.");
    let mut mac = match HmacSha256::new_from_slice(&key) {
        Ok(m) => m,
        Err(_) => return false,
    };
    mac.update(signed.as_bytes());
    mac.update(body);
    let expected = mac.finalize().into_bytes();

    // signature header may contain multiple "v1,xxx, t=..." — take v1 entries.
    for part in signature_header.split(' ') {
        if let Some(sig) = part.strip_prefix("v1,") {
            let Ok(provided) = base64::engine::general_purpose::STANDARD.decode(sig) else {
                continue;
            };
            if timing_safe_eq(&expected, &provided) {
                return true;
            }
        }
    }
    false
}

/// Stripe signature: "t={ts},v1={hex}". Secret "whsec_..." (raw bytes after whsec_? Stripe
/// uses the whsec_ secret as raw string bytes for HMAC key). Returns Ok if valid.
pub fn verify_stripe(signature_header: &str, body: &[u8], secret: &str) -> bool {
    // Stripe uses the full "whsec_..." endpoint secret as the HMAC key (do NOT strip).
    let mut ts = None;
    let mut sigs = Vec::new();
    for part in signature_header.split(',') {
        let part = part.trim();
        if let Some(v) = part.strip_prefix("t=") {
            ts = Some(v.to_string());
        } else if let Some(v) = part.strip_prefix("v1=") {
            sigs.push(v.to_string());
        }
    }
    let Some(ts) = ts else { return false };
    let signed = format!("{ts}.");
    let mut mac = match HmacSha256::new_from_slice(secret.as_bytes()) {
        Ok(m) => m,
        Err(_) => return false,
    };
    mac.update(signed.as_bytes());
    mac.update(body);
    let expected = hex::encode(mac.finalize().into_bytes());
    sigs.iter().any(|s| timing_safe_eq(s.as_bytes(), expected.as_bytes()))
}

/// LemonSqueezy: HMAC-SHA256 of raw body with the webhook secret (raw string). x-signature.
pub fn verify_lemonsqueezy(signature_hex: &str, body: &[u8], secret: &str) -> bool {
    let mut mac = match HmacSha256::new_from_slice(secret.as_bytes()) {
        Ok(m) => m,
        Err(_) => return false,
    };
    mac.update(body);
    let expected = hex::encode(mac.finalize().into_bytes());
    timing_safe_eq(signature_hex.as_bytes(), expected.as_bytes())
}

/// Xendit: x-callback-token equals the configured webhook secret (timing-safe).
pub fn verify_xendit(callback_token: &str, secret: &str) -> bool {
    timing_safe_eq(callback_token.as_bytes(), secret.as_bytes())
}

/// Midtrans: SHA-512 of (orderId + statusCode + grossAmount + serverKey), hex compare.
pub fn verify_midtrans(
    order_id: &str,
    status_code: &str,
    gross_amount: &str,
    signature_key: &str,
    server_key: &str,
) -> bool {
    let input = format!("{order_id}{status_code}{gross_amount}{server_key}");
    let digest = Sha512::digest(input.as_bytes());
    let expected = hex::encode(digest);
    timing_safe_eq(signature_key.as_bytes(), expected.as_bytes())
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::Engine;

    #[test]
    fn standard_webhook_roundtrip() {
        let secret_raw = b"test_secret_bytes_32_long_enough!!";
        let secret_b64 = base64::engine::general_purpose::STANDARD.encode(secret_raw);
        let full = format!("whsec_{secret_b64}");
        let msg_id = "msg_123";
        let ts = "1700000000";
        let body = b"{\"event\":\"test\"}";
        let signed = format!("{msg_id}.{ts}.");
        let mut mac = HmacSha256::new_from_slice(secret_raw).unwrap();
        mac.update(signed.as_bytes());
        mac.update(body);
        let sig = base64::engine::general_purpose::STANDARD.encode(mac.finalize().into_bytes());
        let header = format!("v1,{sig}");
        assert!(verify_standard_webhook(msg_id, ts, &header, body, &full));
        assert!(!verify_standard_webhook(msg_id, ts, &header, b"tampered", &full));
    }

    #[test]
    fn stripe_roundtrip() {
        let secret = "whsec_abcdef";
        let body = b"payload";
        let ts = "12345";
        let signed = format!("{ts}.");
        let mut mac = HmacSha256::new_from_slice(secret.as_bytes()).unwrap();
        mac.update(signed.as_bytes());
        mac.update(body);
        let sig = hex::encode(mac.finalize().into_bytes());
        let header = format!("t={ts},v1={sig}");
        assert!(verify_stripe(&header, body, secret));
    }

    #[test]
    fn midtrans_roundtrip() {
        let server_key = "sk-mid";
        let order_id = "order-1";
        let status = "200";
        let gross = "10000.00";
        let input = format!("{order_id}{status}{gross}{server_key}");
        let digest = Sha512::digest(input.as_bytes());
        let sig = hex::encode(digest);
        assert!(verify_midtrans(order_id, status, gross, &sig, server_key));
    }
}
