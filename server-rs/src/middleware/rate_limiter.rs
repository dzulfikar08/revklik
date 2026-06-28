use dashmap::DashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};

/// In-memory fixed-window rate limiter (single VPS instance).
/// Mirrors the TS limiter in routes/track.ts + subscription-cache.ts:
/// per-key 60s window, bounded map with eviction.
pub struct RateLimiter {
    map: DashMap<String, Entry>,
    max_entries: usize,
}

#[derive(Clone, Copy)]
struct Entry {
    count: u32,
    reset_at: Instant,
}

#[derive(Debug, Clone, Copy)]
pub struct RateDecision {
    pub allowed: bool,
    pub remaining: u32,
    pub reset_at: Instant,
}

impl RateLimiter {
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            map: DashMap::with_capacity(8192),
            max_entries: 10_000,
        })
    }

    /// Check a fixed-window limit. `window` is typically 60s.
    pub fn check(&self, key: &str, limit: u32, window: Duration) -> RateDecision {
        let now = Instant::now();
        // Bounded eviction (best-effort): drop ~20% of the map on overflow.
        if self.map.len() > self.max_entries {
            self.evict(now);
        }

        let mut e = self.map.entry(key.to_string()).or_insert(Entry { count: 0, reset_at: now + window });
        if now > e.reset_at {
            *e = Entry { count: 1, reset_at: now + window };
            return RateDecision { allowed: true, remaining: limit.saturating_sub(1), reset_at: e.reset_at };
        }
        if e.count >= limit {
            return RateDecision { allowed: false, remaining: 0, reset_at: e.reset_at };
        }
        e.count += 1;
        RateDecision { allowed: true, remaining: limit.saturating_sub(e.count), reset_at: e.reset_at }
    }

    fn evict(&self, now: Instant) {
        let keys: Vec<String> = self
            .map
            .iter()
            .filter(|e| e.reset_at < now)
            .map(|e| e.key().clone())
            .collect();
        for k in keys {
            self.map.remove(&k);
        }
        // If still over capacity, drop a fraction of arbitrary entries.
        if self.map.len() > self.max_entries {
            let drop_n = self.map.len() / 5;
            let keys: Vec<String> = self.map.iter().take(drop_n).map(|r| r.key().clone()).collect();
            for k in keys {
                self.map.remove(&k);
            }
        }
    }
}
