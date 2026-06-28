use argon2::password_hash::rand_core::{OsRng, RngCore};
use argon2::password_hash::SaltString;
use argon2::{PasswordHasher, PasswordVerifier};
use base64::Engine;
use sha2::{Digest, Sha256};

/// Cookieless visitor fingerprint: SHA-256(ip | ua | lang | screenRes).
/// Mirrors fingerprintFromRequest in server/src/utils.ts.
pub fn fingerprint(ip: &str, user_agent: &str, accept_language: &str, screen_res: Option<&str>) -> String {
    let input = format!("{ip}|{user_agent}|{accept_language}|{}", screen_res.unwrap_or(""));
    hex::encode(Sha256::digest(input.as_bytes()))
}

/// SHA-256 hex of a token (for api_keys.key_hash). Mirrors hashToken in utils.ts.
pub fn hash_token(token: &str) -> String {
    hex::encode(Sha256::digest(token.as_bytes()))
}

/// Legacy SHA-256 base64 of a password (original D1 scheme). Mirrors hashPassword.
pub fn hash_password_legacy(password: &str) -> String {
    base64::engine::general_purpose::STANDARD.encode(Sha256::digest(password.as_bytes()))
}

/// Verify a password against either argon2id (preferred) or legacy SHA-256 base64.
/// Returns Some(true) on match, Some(false) on mismatch, None when there is no
/// password set (OAuth-only account — must never "pass").
pub fn verify_password(password: &str, stored_hash: &str) -> Option<bool> {
    if stored_hash.is_empty() {
        return None;
    }
    if let Ok(parsed) = argon2::PasswordHash::new(stored_hash) {
        if stored_hash.starts_with("$argon2") {
            return match argon2::Argon2::default().verify_password(password.as_bytes(), &parsed) {
                Ok(()) => Some(true),
                Err(argon2::password_hash::Error::Password) => Some(false),
                Err(_) => Some(false),
            };
        }
    }
    Some(hash_password_legacy(password) == stored_hash)
}

/// Hash a password with argon2id (new accounts + transparent upgrade on login).
pub fn hash_password_argon2(password: &str) -> anyhow::Result<String> {
    let salt = SaltString::generate(&mut OsRng);
    let phc = argon2::Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map_err(|e| anyhow::anyhow!("argon2 hash: {e}"))?;
    Ok(phc.to_string())
}

/// Generate an opaque API token: prefix + 32 random bytes hex.
/// Mirrors generateApiKey: kp_ (session), rvt_ (account), rv_ (site).
/// Returns (full_key, 7-char display_prefix).
pub fn generate_api_key(kind: &str) -> (String, String) {
    let prefix_tag = match kind {
        "account" => "rvt_",
        "site" => "rv_",
        _ => "kp_",
    };
    let mut bytes = [0u8; 32];
    OsRng.fill_bytes(&mut bytes);
    let key = format!("{prefix_tag}{}", hex::encode(bytes));
    let prefix = key.chars().take(7).collect();
    (key, prefix)
}
