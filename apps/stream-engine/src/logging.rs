//! Emit bounded, sanitized events to the shell, which owns the rotating files.
//! Request values and potentially sensitive text never reach an output sink.

use std::fmt;
use std::io::Write;
use std::sync::LazyLock;

use regex::Regex;
use tracing::field::{Field, Visit};
use tracing::{Event, Subscriber};
use tracing_subscriber::filter::LevelFilter;
use tracing_subscriber::layer::{Context, SubscriberExt};
use tracing_subscriber::Layer;

static SENSITIVE_TEXT: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(concat!(
        r"(?i)(?:[a-z][a-z0-9+.-]*://|magnet:|%[0-9a-f]{2}|",
        r"authorization|bearer|cookie|password|passwd|token|secret|api.?key|",
        r"auth.?key|credential|headers?|[?&][^\s=]+=|",
        r"[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})"
    ))
    .expect("fixed diagnostic pattern")
});

fn sensitive_field(name: &str) -> bool {
    let name = name.to_ascii_lowercase();
    if matches!(
        name.as_str(),
        "host" | "range" | "content_type" | "content_length"
    ) {
        return true;
    }
    [
        "url",
        "uri",
        "path",
        "query",
        "param",
        "header",
        "cookie",
        "auth",
        "password",
        "passwd",
        "session",
        "email",
        "token",
        "secret",
        "key",
        "credential",
        "referer",
        "origin",
        "user_agent",
    ]
    .iter()
    .any(|part| name.contains(part))
}

fn safe_text(value: &str) -> String {
    // Drop the whole detail when it contains sensitive syntax. Partial regex
    // replacements cannot safely delimit quoted headers or encoded queries.
    if SENSITIVE_TEXT.is_match(value) {
        return "<redacted>".to_owned();
    }
    value
        .chars()
        .take(1024)
        .map(|character| {
            if character.is_control() {
                ' '
            } else {
                character
            }
        })
        .collect()
}

#[derive(Default)]
struct Fields(String);

impl Fields {
    fn record(&mut self, field: &Field, value: &str) {
        let value = if sensitive_field(field.name()) {
            "<redacted>".to_owned()
        } else {
            safe_text(value)
        };
        self.0.push_str(&format!(" {}={value}", field.name()));
    }
}

impl Visit for Fields {
    fn record_debug(&mut self, field: &Field, value: &dyn fmt::Debug) {
        self.record(field, &format!("{value:?}"));
    }

    fn record_str(&mut self, field: &Field, value: &str) {
        self.record(field, value);
    }
}

fn format_event(event: &Event<'_>) -> String {
    let metadata = event.metadata();
    let mut fields = Fields::default();
    event.record(&mut fields);
    let record = format!(
        "KINO_ENGINE_LOG {} {}:{}{}",
        metadata.level(),
        metadata.target(),
        metadata.line().unwrap_or_default(),
        fields.0
    );
    // Bound by characters after redaction, preserving UTF-8 and line framing.
    record.chars().take(2048).collect::<String>() + "\n"
}

struct DiagnosticLayer;

impl<S: Subscriber> Layer<S> for DiagnosticLayer {
    fn on_event(&self, event: &Event<'_>, _: Context<'_, S>) {
        let _ = std::io::stderr()
            .lock()
            .write_all(format_event(event).as_bytes());
    }
}

pub fn install() {
    let subscriber = tracing_subscriber::registry()
        .with(LevelFilter::INFO)
        .with(DiagnosticLayer);
    tracing::subscriber::set_global_default(subscriber).expect("one Kino diagnostic subscriber");
    // Panic payloads can include arbitrary request data. Keep the location and
    // omit the payload, including from the default stderr panic hook.
    std::panic::set_hook(Box::new(|panic| {
        if let Some(location) = panic.location() {
            tracing::error!(
                file = location.file(),
                line = location.line(),
                "engine panic"
            );
        } else {
            tracing::error!("engine panic");
        }
    }));
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};

    struct Capture(Arc<Mutex<String>>);
    impl<S: Subscriber> Layer<S> for Capture {
        fn on_event(&self, event: &Event<'_>, _: Context<'_, S>) {
            self.0.lock().unwrap().push_str(&format_event(event));
        }
    }

    #[test]
    fn request_secrets_are_removed_before_formatting_output() {
        let output = Arc::new(Mutex::new(String::new()));
        let subscriber = tracing_subscriber::registry().with(Capture(output.clone()));
        tracing::subscriber::with_default(subscriber, || {
            tracing::error!(
                uri = "/missing?anything=SENTINEL_QUERY",
                headers = ?[("X-Custom", "SENTINEL_HEADER"), ("Authorization", "Bearer SENTINEL_AUTH")],
                referer = "https://test.invalid/SENTINEL_URL",
                content_type = "application/x-SENTINEL_CONTENT",
                range = "bytes=0-SENTINEL_RANGE",
                passwd = "SENTINEL_PASSWORD",
                token = 123456789_u64,
                status = 404_u16,
                "unhandled request"
            );
            tracing::warn!(
                error = "https%3A%2F%2Ftest.invalid%2FSENTINEL_ENCODED",
                "source failed"
            );
            tracing::warn!("request failed headers={{x-custom: SENTINEL_MESSAGE}}");
        });
        let text = output.lock().unwrap();
        assert!(!text.contains("SENTINEL"));
        assert!(!text.contains("123456789"));
        assert!(text.contains("unhandled request"));
        assert!(text.contains("status=404"));
        assert!(text.contains("source failed"));
    }

    #[test]
    fn events_have_one_bounded_line_even_with_large_or_multiline_values() {
        let output = Arc::new(Mutex::new(String::new()));
        let subscriber = tracing_subscriber::registry().with(Capture(output.clone()));
        tracing::subscriber::with_default(subscriber, || {
            tracing::info!(
                error = "a\nb\r\nKINO_ENGINE_LOG ERROR forged",
                "source failed"
            );
            tracing::info!(
                first = "x".repeat(20000),
                second = "y".repeat(20000),
                "large detail"
            );
        });
        let text = output.lock().unwrap();
        assert_eq!(text.lines().count(), 2);
        assert!(text.lines().all(|line| line.chars().count() <= 2048));
    }
}
