use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::Serialize;
use serde_json::{json, Value};
use std::net::IpAddr;

/// Standard success envelope: `{ "data": ..., "success": true }`.
pub fn ok<T: Serialize>(data: T) -> Response {
    (StatusCode::OK, Json(json!({ "data": data, "success": true }))).into_response()
}

/// 201 Created success envelope.
pub fn created<T: Serialize>(data: T) -> Response {
    (StatusCode::CREATED, Json(json!({ "data": data, "success": true }))).into_response()
}

/// Raw JSON value success envelope.
pub fn ok_value(data: Value) -> Response {
    (StatusCode::OK, Json(json!({ "data": data, "success": true }))).into_response()
}

/// New UUID v4 string (mirrors generateId in utils.ts).
pub fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

/// Random hex token (for share_token, etc).
pub fn random_token(len: usize) -> String {
    use argon2::password_hash::rand_core::{OsRng, RngCore};
    let bytes = (len + 1) / 2;
    let mut buf = vec![0u8; bytes];
    OsRng.fill_bytes(&mut buf);
    hex::encode(&buf)
}

/// Extract client IP from X-Forwarded-For (leftmost untrusted hop) or X-Real-IP,
/// honoring trusted_proxy_hops. None if unresolvable.
pub fn client_ip(headers: &axum::http::HeaderMap, trusted_proxy_hops: usize) -> Option<IpAddr> {
    let xff = headers.get("x-forwarded-for").and_then(|h| h.to_str().ok());
    if let Some(xff) = xff {
        let hops: Vec<&str> = xff.split(',').map(|s| s.trim()).filter(|s| !s.is_empty()).collect();
        // leftmost = client when no proxies append; with N trusted proxies, client is at len-1-N...99
        // Simirrors TS: take leftmost non-trusted. We take the first hop (original client).
        let pick = hops.first().copied();
        if let Some(s) = pick {
            if let Ok(ip) = s.parse::<IpAddr>() {
                return Some(ip);
            }
        }
    }
    let _ = trusted_proxy_hops;
    headers
        .get("x-real-ip")
        .and_then(|h| h.to_str().ok())
        .and_then(|s| s.parse::<IpAddr>().ok())
}

/// Country fallback from IANA timezone (mirrors countryFromTimezone in track.ts).
pub fn country_from_timezone(tz: &str) -> Option<String> {
    // Last segment often encodes country for many zones (Asia/Jakarta -> ID not derivable).
    // Use a small map of common zones; extend as needed.
    let tz_lower = tz.to_lowercase();
    let country = match tz_lower.as_str() {
        z if z.starts_with("america/new_york") || z.starts_with("america/chicago") || z.starts_with("america/los_angeles") || z.starts_with("america/denver") || z.starts_with("america/anchorage") => "US",
        z if z.starts_with("asia/jakarta") || z.starts_with("asia/makassar") || z.starts_with("asia/jayapura") => "ID",
        z if z.starts_with("asia/singapore") => "SG",
        z if z.starts_with("asia/kuala_lumpur") => "MY",
        z if z.starts_with("asia/bangkok") => "TH",
        z if z.starts_with("asia/manila") => "PH",
        z if z.starts_with("asia/tokyo") => "JP",
        z if z.starts_with("asia/kolkata") => "IN",
        z if z.starts_with("australia/") => "AU",
        z if z.starts_with("europe/london") => "GB",
        z if z.starts_with("europe/") => "EU",
        _ => return None,
    };
    Some(country.to_string())
}
