//! Kino's torrent streaming engine helper.
//!
//! Hosts stream-server through its embedded library profile — loopback-only
//! HTTP, no FFmpeg download, no SSDP, no auto-update — rather than running the
//! upstream standalone binary, whose defaults Kino rejects (ADR 0015). The
//! shell supervises this process and stops it by closing stdin or killing it.

use std::net::{Ipv4Addr, SocketAddr};
use std::path::PathBuf;

use tokio::io::AsyncReadExt;

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
    let mut cfg = stream_server::ServerConfig::embedded();
    cfg.http_addr = SocketAddr::from((Ipv4Addr::LOCALHOST, port_from_env()));
    cfg.cache_dir = cache_dir_from_env();
    cfg.config_dir = cfg.cache_dir.clone();
    // Kino owns the subscriber. Upstream writers bypass our redaction and
    // produce unbounded files outside the folder exposed by Open Log Folder.
    cfg.init_logging = false;
    cfg.enable_cache_cleaner = true;

    let (shutdown_tx, shutdown_rx) = tokio::sync::mpsc::channel(1);
    let (ready_tx, ready_rx) = tokio::sync::oneshot::channel();
    let server = tokio::spawn(stream_server::run(cfg, shutdown_rx, Some(ready_tx)));

    let address = ready_rx.await?;
    // The shell parses this line to learn the ephemeral port.
    println!("KINO_ENGINE_READY http://{address}");

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
