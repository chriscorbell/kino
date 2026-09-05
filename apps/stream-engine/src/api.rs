//! Kino's authenticated loopback API. The URL capability also authorizes mpv's
//! native range requests, which do not go through the web client's fetch calls.

use std::net::SocketAddr;

use axum::{
    extract::{Request, State},
    http::{header, HeaderValue, Method, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{delete, get, post},
    Json, Router,
};
use serde::Deserialize;
use serde_json::json;
use stream_server::{embedded_handlers as handlers, AppState};
use subtle::ConstantTimeEq;
use tower_http::cors::CorsLayer;

#[derive(Clone)]
pub struct Access {
    token: String,
    origin: HeaderValue,
}

impl Access {
    pub fn new(origin: &str) -> anyhow::Result<Self> {
        if !matches!(origin, "null" | "file://" | "qrc://") {
            let parsed: axum::http::Uri = origin.parse()?;
            anyhow::ensure!(
                matches!(parsed.scheme_str(), Some("http" | "https"))
                    && parsed.authority().is_some()
                    && parsed.query().is_none()
                    && origin
                        == format!(
                            "{}://{}",
                            parsed.scheme_str().unwrap(),
                            parsed.authority().unwrap()
                        ),
                "UI origin must be an explicit origin"
            );
        }
        let mut bytes = [0_u8; 32];
        getrandom::fill(&mut bytes)
            .map_err(|_| anyhow::anyhow!("session randomness unavailable"))?;
        Ok(Self {
            token: bytes.iter().map(|byte| format!("{byte:02x}")).collect(),
            origin: HeaderValue::from_str(origin)?,
        })
    }

    pub fn path_prefix(&self) -> String {
        format!("/kino/{}", self.token)
    }

    pub fn router(&self, state: AppState, address: SocketAddr) -> Router {
        let routes = Router::new()
            .route("/heartbeat", get(handlers::heartbeat))
            .route("/settings", get(settings).post(change_settings))
            .route("/create", post(handlers::create_engine))
            .route("/{infoHash}/create", post(handlers::create_magnet))
            .route("/{infoHash}", delete(handlers::remove_engine))
            .route(
                "/{infoHash}/{fileIdx}",
                get(handlers::stream_video).head(handlers::head_stream_video),
            )
            .with_state(state);
        let access = self.clone();
        let host = address.to_string();
        Router::new()
            .nest(&self.path_prefix(), routes)
            .layer(
                CorsLayer::new()
                    .allow_origin(self.origin.clone())
                    .allow_methods([Method::GET, Method::HEAD, Method::POST, Method::DELETE])
                    .allow_headers([header::CONTENT_TYPE, header::RANGE])
                    .expose_headers([
                        header::CONTENT_LENGTH,
                        header::CONTENT_RANGE,
                        header::ACCEPT_RANGES,
                    ]),
            )
            .layer(middleware::from_fn(move |request, next| {
                let access = access.clone();
                let host = host.clone();
                async move { access.authorize(request, next, &host).await }
            }))
    }

    async fn authorize(&self, request: Request, next: Next, host: &str) -> Response {
        let headers = request.headers();
        if headers.get_all(header::HOST).iter().count() != 1
            || headers
                .get(header::HOST)
                .and_then(|value| value.to_str().ok())
                != Some(host)
            || headers.get_all(header::ORIGIN).iter().count() > 1
            || headers
                .get(header::ORIGIN)
                .is_some_and(|value| value != self.origin)
        {
            return StatusCode::FORBIDDEN.into_response();
        }
        let Some((token, path)) = request
            .uri()
            .path()
            .strip_prefix("/kino/")
            .and_then(|value| value.split_once('/'))
        else {
            return StatusCode::UNAUTHORIZED.into_response();
        };
        if !same_token(token.as_bytes(), self.token.as_bytes()) {
            return StatusCode::UNAUTHORIZED.into_response();
        }
        // Generic torrent routes must not turn unsupported namespaces such as
        // /yt or /proxy into torrent operations. Reject them before dispatch.
        if !supported_path(path) {
            tracing::warn!(status = 404_u16, "unhandled request");
            return StatusCode::NOT_FOUND.into_response();
        }
        let mut response = next.run(request).await;
        response
            .headers_mut()
            .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
        response.headers_mut().insert(
            header::REFERRER_POLICY,
            HeaderValue::from_static("no-referrer"),
        );
        response
    }
}

fn same_token(supplied: &[u8], expected: &[u8]) -> bool {
    if supplied.len() != expected.len() {
        return false;
    }
    bool::from(supplied.ct_eq(expected))
}

fn supported_path(path: &str) -> bool {
    if matches!(path, "heartbeat" | "settings" | "create") {
        return true;
    }
    let (hash, operation) = path
        .split_once('/')
        .map_or((path, None), |(hash, operation)| (hash, Some(operation)));
    if hash.len() != 40 || !hash.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return false;
    }
    operation.is_none_or(|value| {
        value == "create"
            || (!value.is_empty()
                && value.bytes().all(|byte| byte.is_ascii_digit())
                && value.parse::<usize>().is_ok())
    })
}

async fn settings(State(state): State<AppState>) -> impl IntoResponse {
    let settings = state.settings.read().await;
    Json(json!({ "values": {
        "seedingEnabled": settings.seeding_enabled,
        "btDownloadSpeedHardLimit": settings.bt_download_speed_hard_limit,
        "cacheSize": settings.cache_size,
    } }))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SettingsChange {
    seeding_enabled: Option<bool>,
    bt_download_speed_hard_limit: Option<f64>,
}

async fn change_settings(
    State(state): State<AppState>,
    Json(change): Json<SettingsChange>,
) -> Response {
    let mut values = serde_json::Map::new();
    if let Some(enabled) = change.seeding_enabled {
        values.insert("seedingEnabled".to_owned(), json!(enabled));
    }
    if let Some(limit) = change.bt_download_speed_hard_limit {
        if !limit.is_finite() || limit.fract() != 0.0 || !(0.0..=i32::MAX as f64).contains(&limit) {
            return StatusCode::BAD_REQUEST.into_response();
        }
        values.insert("btDownloadSpeedHardLimit".to_owned(), json!(limit));
    }
    match handlers::update_settings(&state, &values.into()).await {
        Ok(()) => Json(json!({ "success": true })).into_response(),
        Err(error) => {
            tracing::error!(%error, "engine settings could not be saved");
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_torrent_and_supported_control_paths_are_allowed() {
        let hash = "abcde01234abcde01234abcde01234abcde01234";
        for path in [
            "heartbeat",
            "settings",
            "create",
            hash,
            &format!("{hash}/create"),
            &format!("{hash}/0"),
        ] {
            assert!(supported_path(path));
        }
        for path in [
            "removeAll",
            "proxy/https://test.invalid",
            "yt/123",
            "settings/0",
            "diagnostics/logs",
            &format!("{hash}/remove"),
            &format!("{hash}/-1"),
            &format!("{hash}/0/extra"),
        ] {
            assert!(!supported_path(path));
        }
    }

    #[test]
    fn each_session_has_a_fresh_token_and_matches_all_its_bytes() {
        let first = Access::new("null").unwrap();
        let second = Access::new("null").unwrap();
        assert!(first.token.len() == 64 && first.token != second.token);
        assert!(same_token(first.token.as_bytes(), first.token.as_bytes()));
        assert!(!same_token(first.token.as_bytes(), second.token.as_bytes()));
        assert!(!same_token(b"", first.token.as_bytes()));
    }

    #[test]
    fn browser_origin_must_be_explicit() {
        for origin in [
            "null",
            "file://",
            "qrc://",
            "http://localhost:5173",
            "https://kino.example",
        ] {
            assert!(Access::new(origin).is_ok());
        }
        for origin in [
            "*",
            "",
            "https://kino.example/path",
            "https://kino.example?query=1",
        ] {
            assert!(Access::new(origin).is_err());
        }
    }
}
