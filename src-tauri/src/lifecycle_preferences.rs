use serde::{Deserialize, Serialize};
use std::io::Write;
use std::path::{Path, PathBuf};

const VERSION: u32 = 1;

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LifecyclePreferences {
    pub(crate) version: u32,
    pub(crate) start_minimized: bool,
    pub(crate) close_to_tray: bool,
}

impl Default for LifecyclePreferences {
    fn default() -> Self {
        Self {
            version: VERSION,
            start_minimized: false,
            close_to_tray: false,
        }
    }
}

fn backup_path(path: &Path) -> PathBuf {
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("lifecycle.json");
    path.with_file_name(format!("{name}.bak"))
}

fn read_exact(path: &Path) -> Result<LifecyclePreferences, String> {
    let bytes = std::fs::read(path).map_err(|error| error.to_string())?;
    let parsed: LifecyclePreferences =
        serde_json::from_slice(&bytes).map_err(|error| error.to_string())?;
    if parsed.version != VERSION {
        return Err(format!(
            "unsupported lifecycle preference version {}",
            parsed.version
        ));
    }
    Ok(parsed)
}

/// Load the native lifecycle preferences. A missing/corrupt file safely means both opt-ins are off. If a
/// previous process stopped between rotating the old file to `.bak` and publishing the replacement, recover
/// the verified backup instead of silently forgetting the user's choice.
pub(crate) fn load(path: &Path) -> LifecyclePreferences {
    if let Ok(value) = read_exact(path) {
        return value;
    }
    let backup = backup_path(path);
    if let Ok(value) = read_exact(&backup) {
        let _ = std::fs::copy(&backup, path);
        return value;
    }
    LifecyclePreferences::default()
}

/// Persist through a sibling temporary file, retain the old generation until exact read-back succeeds, and
/// restore it on failure. These preferences decide whether the process stays alive unseen, so an assumed write
/// is not good enough.
pub(crate) fn save_verified(path: &Path, value: &LifecyclePreferences) -> Result<(), String> {
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("lifecycle.json");
    let temp = parent.join(format!(".{name}.{}.tmp", std::process::id()));
    let backup = backup_path(path);
    let _ = std::fs::remove_file(&temp);

    let bytes = serde_json::to_vec(value).map_err(|error| error.to_string())?;
    {
        let mut file = std::fs::File::create(&temp).map_err(|error| error.to_string())?;
        file.write_all(&bytes).map_err(|error| error.to_string())?;
        file.flush().map_err(|error| error.to_string())?;
        file.sync_all().map_err(|error| error.to_string())?;
    }

    let had_previous = path.exists();
    if had_previous {
        let _ = std::fs::remove_file(&backup);
        std::fs::rename(path, &backup).map_err(|error| {
            let _ = std::fs::remove_file(&temp);
            error.to_string()
        })?;
    }

    if let Err(error) = std::fs::rename(&temp, path) {
        if had_previous {
            let _ = std::fs::rename(&backup, path);
        }
        let _ = std::fs::remove_file(&temp);
        return Err(error.to_string());
    }

    match read_exact(path) {
        Ok(saved) if saved == *value => {
            let _ = std::fs::remove_file(&backup);
            Ok(())
        }
        Ok(_) | Err(_) => {
            let _ = std::fs::remove_file(path);
            if had_previous {
                let _ = std::fs::rename(&backup, path);
            }
            Err("lifecycle preference read-back did not match".to_string())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "starnet-lifecycle-{name}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ))
    }

    #[test]
    fn missing_and_invalid_files_fail_to_opted_out_defaults() {
        let dir = temp_dir("defaults");
        let path = dir.join("lifecycle.json");
        assert_eq!(load(&path), LifecyclePreferences::default());
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(&path, b"not-json").unwrap();
        assert_eq!(load(&path), LifecyclePreferences::default());
        std::fs::write(
            &path,
            br#"{"version":99,"startMinimized":true,"closeToTray":true}"#,
        )
        .unwrap();
        assert_eq!(load(&path), LifecyclePreferences::default());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn save_round_trips_both_choices() {
        let dir = temp_dir("roundtrip");
        let path = dir.join("lifecycle.json");
        let expected = LifecyclePreferences {
            version: VERSION,
            start_minimized: true,
            close_to_tray: true,
        };
        save_verified(&path, &expected).unwrap();
        assert_eq!(load(&path), expected);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn valid_backup_recovers_a_corrupt_primary() {
        let dir = temp_dir("backup");
        let path = dir.join("lifecycle.json");
        let backup = backup_path(&path);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(&path, b"truncated").unwrap();
        std::fs::write(
            &backup,
            br#"{"version":1,"startMinimized":true,"closeToTray":false}"#,
        )
        .unwrap();
        let recovered = load(&path);
        assert!(recovered.start_minimized);
        assert!(!recovered.close_to_tray);
        assert_eq!(read_exact(&path).unwrap(), recovered);
        let _ = std::fs::remove_dir_all(dir);
    }
}
