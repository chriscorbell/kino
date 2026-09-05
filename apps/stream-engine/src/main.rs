//! Kino's torrent streaming engine helper.
//!
//! Hosts stream-server through its embedded library profile — loopback-only
//! HTTP, no FFmpeg download, no SSDP, no auto-update — rather than running the
//! upstream standalone binary, whose defaults Kino rejects (ADR 0015). The
//! shell supervises this process and stops it by closing stdin or killing it.

use std::net::{Ipv4Addr, SocketAddr};
use std::path::PathBuf;

use tokio::io::AsyncReadExt;

mod api;
mod logging;

fn port_from_env() -> u16 {
    std::env::var("KINO_ENGINE_PORT")
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(0)
}

fn cache_dir_from_env() -> Option<PathBuf> {
    std::env::var_os("KINO_ENGINE_CACHE_DIR").map(PathBuf::from)
}

#[tokio::main]
async fn main() -> std::process::ExitCode {
    logging::install();
    match run().await {
        Ok(()) => std::process::ExitCode::SUCCESS,
        Err(error) => {
            tracing::error!(%error, "streaming engine failed");
            std::process::ExitCode::FAILURE
        }
    }
}

async fn run() -> anyhow::Result<()> {
    let access = api::Access::new(
        &std::env::var("KINO_ENGINE_UI_ORIGIN").unwrap_or_else(|_| "null".to_owned()),
    )?;
    let prefix = access.path_prefix();
    let mut cfg = stream_server::ServerConfig::embedded();
    cfg.router_factory = Some(stream_server::RouterFactory::new(move |state, address| {
        access.router(state, address)
    }));
    cfg.http_addr = SocketAddr::from((Ipv4Addr::LOCALHOST, port_from_env()));
    cfg.cache_dir = cache_dir_from_env();
    cfg.config_dir = Some(PathBuf::from(
        std::env::var_os("KINO_ENGINE_CONFIG_DIR")
            .ok_or_else(|| anyhow::anyhow!("engine configuration directory is required"))?,
    ));
    // Kino owns the subscriber. Upstream writers bypass our redaction and
    // produce unbounded files outside the folder exposed by Open Log Folder.
    cfg.init_logging = false;
    cfg.enable_cache_cleaner = true;

    let (shutdown_tx, shutdown_rx) = tokio::sync::mpsc::channel(1);
    let (ready_tx, ready_rx) = tokio::sync::oneshot::channel();
    let server = tokio::spawn(stream_server::run(cfg, shutdown_rx, Some(ready_tx)));

    let address = ready_rx.await?;
    // This private pipe carries the capability to the shell. Never log this
    // URL or persist it; it changes every time the helper starts.
    println!("KINO_ENGINE_READY http://{address}{prefix}");

    // Closing stdin is the supervisor's graceful stop signal.
    tokio::spawn(async move {
        let mut stdin = tokio::io::stdin();
        let mut buffer = [0_u8; 64];
        while let Ok(read) = stdin.read(&mut buffer).await {
            if read == 0 {
                break;
            }
        }
        let _ = shutdown_tx.send(()).await;
    });

    server.await??;
    Ok(())
}
