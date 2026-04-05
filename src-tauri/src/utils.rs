/// Expands a leading `~` or `~/` in a file path to the user's home directory.
/// If `$HOME` is not set or the path doesn't start with `~`, returns the path unchanged.
pub fn expand_tilde(path: &str) -> String {
    if path == "~" {
        return std::env::var("HOME").unwrap_or_else(|_| path.to_string());
    }
    if let Some(rest) = path.strip_prefix("~/") {
        if let Ok(home) = std::env::var("HOME") {
            return format!("{}/{}", home, rest);
        }
    }
    path.to_string()
}
