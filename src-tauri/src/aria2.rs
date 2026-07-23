use anyhow::{Result, anyhow};
use serde::Serialize;
use serde_json::{Value, json};
use std::time::Duration;

/// Minimal aria2 JSON-RPC client over HTTP.
#[derive(Clone)]
pub struct Aria2 {
    endpoint: String,
    secret: String,
    http: reqwest::Client,
}

impl Aria2 {
    pub fn new(port: u16, secret: String) -> Self {
        Self {
            endpoint: format!("http://127.0.0.1:{port}/jsonrpc"),
            secret,
            http: reqwest::Client::builder()
                .connect_timeout(Duration::from_secs(2))
                .timeout(Duration::from_secs(10))
                .build()
                .expect("valid aria2 HTTP client"),
        }
    }

    fn token(&self) -> String {
        format!("token:{}", self.secret)
    }

    pub async fn call(&self, method: &str, params: Value) -> Result<Value> {
        let mut p = vec![Value::String(self.token())];
        if let Value::Array(arr) = params {
            p.extend(arr);
        }
        let body = json!({
            "jsonrpc": "2.0",
            "id": "downman",
            "method": method,
            "params": p,
        });
        let resp = self.http.post(&self.endpoint).json(&body).send().await?;
        let v: Value = resp.json().await?;
        if let Some(err) = v.get("error") {
            return Err(anyhow!("aria2 error: {err}"));
        }
        Ok(v.get("result").cloned().unwrap_or(Value::Null))
    }

    pub async fn add_uri(&self, uris: Vec<String>, options: Value) -> Result<String> {
        let r = self.call("aria2.addUri", json!([uris, options])).await?;
        Ok(r.as_str().unwrap_or_default().to_string())
    }

    pub async fn pause(&self, gid: &str) -> Result<()> {
        self.call("aria2.pause", json!([gid])).await?;
        Ok(())
    }

    pub async fn unpause(&self, gid: &str) -> Result<()> {
        self.call("aria2.unpause", json!([gid])).await?;
        Ok(())
    }

    pub async fn pause_all(&self) -> Result<()> {
        self.call("aria2.pauseAll", json!([])).await?;
        Ok(())
    }

    pub async fn unpause_all(&self) -> Result<()> {
        self.call("aria2.unpauseAll", json!([])).await?;
        Ok(())
    }

    pub async fn tell_status(&self, gid: &str) -> Result<Value> {
        self.call("aria2.tellStatus", json!([gid])).await
    }

    pub async fn get_option(&self, gid: &str) -> Result<Value> {
        self.call("aria2.getOption", json!([gid])).await
    }

    pub async fn remove(&self, gid: &str) -> Result<()> {
        // try active remove then stopped removal cleanup
        let _ = self.call("aria2.forceRemove", json!([gid])).await;
        let _ = self.call("aria2.removeDownloadResult", json!([gid])).await;
        Ok(())
    }

    pub async fn tell_active(&self) -> Result<Value> {
        self.call("aria2.tellActive", json!([])).await
    }

    pub async fn tell_waiting(&self) -> Result<Value> {
        self.call("aria2.tellWaiting", json!([0, 1000])).await
    }

    pub async fn tell_stopped(&self) -> Result<Value> {
        self.call("aria2.tellStopped", json!([0, 1000])).await
    }

    pub async fn global_stat(&self) -> Result<Value> {
        self.call("aria2.getGlobalStat", json!([])).await
    }

    pub async fn change_global_option(&self, opts: Value) -> Result<()> {
        self.call("aria2.changeGlobalOption", json!([opts])).await?;
        Ok(())
    }

    pub async fn save_session(&self) -> Result<()> {
        self.call("aria2.saveSession", json!([])).await?;
        Ok(())
    }

    pub async fn shutdown(&self) -> Result<()> {
        self.call("aria2.shutdown", json!([])).await?;
        Ok(())
    }

    /// Per-download options (speed limit, file selection, etc.).
    pub async fn change_option(&self, gid: &str, opts: Value) -> Result<()> {
        self.call("aria2.changeOption", json!([gid, opts])).await?;
        Ok(())
    }

    /// Reposition a queued download. `how` is POS_SET | POS_CUR | POS_END.
    pub async fn change_position(&self, gid: &str, pos: i64, how: &str) -> Result<i64> {
        let r = self
            .call("aria2.changePosition", json!([gid, pos, how]))
            .await?;
        Ok(r.as_i64().unwrap_or(0))
    }

    /// Replace sources for one file in a paused/waiting download.
    pub async fn change_uri(
        &self,
        gid: &str,
        file_index: u32,
        remove: Vec<String>,
        add: Vec<String>,
    ) -> Result<Value> {
        self.call("aria2.changeUri", json!([gid, file_index, remove, add, 0]))
            .await
    }

    /// Add a torrent from base64-encoded .torrent contents.
    pub async fn add_torrent(&self, torrent_b64: String, options: Value) -> Result<String> {
        let r = self
            .call("aria2.addTorrent", json!([torrent_b64, [], options]))
            .await?;
        Ok(r.as_str().unwrap_or_default().to_string())
    }

    /// Add downloads from base64-encoded .metalink/.meta4 contents (may be several files).
    pub async fn add_metalink(&self, metalink_b64: String, options: Value) -> Result<Value> {
        self.call("aria2.addMetalink", json!([metalink_b64, options]))
            .await
    }
}

#[derive(Serialize)]
pub struct Snapshot {
    pub active: Value,
    pub waiting: Value,
    pub stopped: Value,
    pub stat: Value,
    pub site: Value,
    pub pending: Value,
    pub history: Value,
    pub queues: Value,
    #[serde(rename = "queueMap")]
    pub queue_map: Value,
    pub grabbed: Value,
    #[serde(rename = "grabRequest")]
    pub grab_request: Value,
}
