use maxminddb::Reader;
use serde::Deserialize;
use std::net::IpAddr;
use std::path::Path;
use std::sync::Arc;

/// MaxMind GeoLite2 reader. None when no DB is configured (geo attribution skipped,
/// tz fallback still applies).
pub struct Geoip {
    reader: Option<Reader<Vec<u8>>>,
}

#[derive(Debug, Clone, Default)]
pub struct Geo {
    pub country: Option<String>,
    pub region: Option<String>,
    pub city: Option<String>,
}

#[derive(Deserialize)]
struct CityRecord {
    country: Option<CountryRec>,
    subdivisions: Option<Vec<SubRec>>,
    city: Option<NamesRec>,
}
#[derive(Deserialize)]
struct CountryRec {
    iso_code: Option<String>,
    names: Option<NamesRec>,
}
#[derive(Deserialize)]
struct SubRec {
    names: Option<NamesRec>,
}
#[derive(Deserialize)]
struct NamesRec {
    en: Option<String>,
}

impl Geoip {
    pub fn open(path: Option<&String>) -> Arc<Self> {
        let reader = path
            .filter(|p| Path::new(p).exists())
            .and_then(|p| match Reader::<Vec<u8>>::open_readfile(p) {
                Ok(r) => Some(r),
                Err(e) => {
                    tracing::warn!(path = %p, error = ?e, "failed to open geoip db; geo disabled");
                    None
                }
            });
        Arc::new(Self { reader })
    }

    pub fn lookup(&self, ip: Option<IpAddr>) -> Geo {
        let Some(ip) = ip else { return Geo::default() };
        let Some(reader) = self.reader.as_ref() else { return Geo::default() };
        let Ok(rec): Result<CityRecord, _> = reader.lookup::<CityRecord>(ip) else {
            return Geo::default();
        };
        Geo {
            country: rec.country.and_then(|c| c.iso_code),
            region: rec
                .subdivisions
                .and_then(|mut s| s.drain(..).next())
                .and_then(|s| s.names.and_then(|n| n.en)),
            city: rec.city.and_then(|c| c.en),
        }
    }
}
