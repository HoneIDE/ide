//! LSP subprocess bridge — spawn language servers, pipe JSON-RPC over stdin/stdout.
//!
//! This crate provides FFI functions for Perry-compiled TypeScript to communicate
//! with language servers via JSON-RPC. It handles:
//! - Subprocess spawning with stdin/stdout pipes
//! - Non-blocking reads from stdout
//! - Content-Length framed message parsing
//! - Writing JSON-RPC messages to stdin
//!
//! Up to 4 concurrent language server processes are supported.

use std::collections::VecDeque;
use std::ffi::CString;
use std::sync::Mutex;

/// A running language server process.
struct LspProcess {
    /// PID of the child process.
    pid: i32,
    /// File descriptor for writing to the child's stdin.
    stdin_fd: i32,
    /// File descriptor for reading from the child's stdout.
    stdout_fd: i32,
    /// Partial read buffer (for Content-Length framing).
    read_buf: Vec<u8>,
    /// Complete JSON-RPC messages ready to be polled.
    message_queue: VecDeque<String>,
    /// Whether the process is alive.
    alive: bool,
}

/// Up to 4 concurrent language servers.
static SERVERS: Mutex<[Option<LspProcess>; 4]> = Mutex::new([
    None, None, None, None,
]);

// ---------------------------------------------------------------------------
// String helpers for Perry FFI — go through `perry-ffi` so we stay on the
// stable wrapper surface. Earlier versions of this crate hand-rolled an
// `[len:u32][cap:u32][data...]` 8-byte header, which silently broke when
// Perry v0.5.213 expanded `StringHeader` to 5 fields (20 bytes). The
// perry-ffi shim hides that layout entirely.
// ---------------------------------------------------------------------------

fn str_from_header(ptr: *const u8) -> &'static str {
    if ptr.is_null() || (ptr as usize) < 0x1000 {
        return "";
    }
    let handle = unsafe { perry_ffi::JsString::from_raw(ptr as *mut perry_ffi::StringHeader) };
    perry_ffi::read_string(handle).unwrap_or("")
}

/// Allocate a Perry-arena string and return the header pointer as `i64`.
/// The runtime's GC reclaims the allocation once the JS-side reference
/// goes out of scope — no manual free.
fn make_perry_string(s: &str) -> i64 {
    perry_ffi::alloc_string(s).as_raw() as i64
}

// ---------------------------------------------------------------------------
// Subprocess management
// ---------------------------------------------------------------------------

/// Spawn a language server process.
/// Returns (stdin_fd, stdout_fd, pid) or (-1, -1, -1) on failure.
unsafe fn spawn_lsp(cmd: &str, args: &[&str], cwd: &str) -> (i32, i32, i32) {
    // Create pipes: stdin_pipe[0]=read, stdin_pipe[1]=write
    //               stdout_pipe[0]=read, stdout_pipe[1]=write
    let mut stdin_pipe: [i32; 2] = [0; 2];
    let mut stdout_pipe: [i32; 2] = [0; 2];

    if libc::pipe(stdin_pipe.as_mut_ptr()) != 0 { return (-1, -1, -1); }
    if libc::pipe(stdout_pipe.as_mut_ptr()) != 0 {
        libc::close(stdin_pipe[0]);
        libc::close(stdin_pipe[1]);
        return (-1, -1, -1);
    }

    let pid = libc::fork();
    if pid < 0 {
        // Fork failed
        libc::close(stdin_pipe[0]); libc::close(stdin_pipe[1]);
        libc::close(stdout_pipe[0]); libc::close(stdout_pipe[1]);
        return (-1, -1, -1);
    }

    if pid == 0 {
        // Child process
        // Redirect stdin to read end of stdin_pipe
        libc::close(stdin_pipe[1]); // Close write end
        libc::dup2(stdin_pipe[0], 0); // stdin = pipe read
        libc::close(stdin_pipe[0]);

        // Redirect stdout to write end of stdout_pipe
        libc::close(stdout_pipe[0]); // Close read end
        libc::dup2(stdout_pipe[1], 1); // stdout = pipe write
        // Also redirect stderr to stdout for error capture
        libc::dup2(stdout_pipe[1], 2);
        libc::close(stdout_pipe[1]);

        // Change directory
        if !cwd.is_empty() {
            let cwd_c = CString::new(cwd).unwrap();
            libc::chdir(cwd_c.as_ptr());
        }

        // Build argv
        let cmd_c = CString::new(cmd).unwrap();
        let mut argv_c: Vec<CString> = Vec::new();
        argv_c.push(cmd_c.clone());
        for arg in args {
            argv_c.push(CString::new(*arg).unwrap());
        }
        let mut argv_ptrs: Vec<*const i8> = Vec::new();
        for a in &argv_c {
            argv_ptrs.push(a.as_ptr());
        }
        argv_ptrs.push(std::ptr::null());

        libc::execvp(cmd_c.as_ptr(), argv_ptrs.as_ptr());
        libc::_exit(127); // execvp failed
    }

    // Parent process
    libc::close(stdin_pipe[0]);  // Close read end of stdin (child uses it)
    libc::close(stdout_pipe[1]); // Close write end of stdout (child uses it)

    // Set stdout_pipe[0] to non-blocking
    let flags = libc::fcntl(stdout_pipe[0], libc::F_GETFL);
    libc::fcntl(stdout_pipe[0], libc::F_SETFL, flags | libc::O_NONBLOCK);

    (stdin_pipe[1], stdout_pipe[0], pid)
}

/// Try to read available data from stdout and parse JSON-RPC messages.
fn poll_messages(proc: &mut LspProcess) {
    if !proc.alive { return; }

    // Non-blocking read
    let mut buf = [0u8; 8192];
    let n = unsafe { libc::read(proc.stdout_fd, buf.as_mut_ptr() as *mut _, buf.len()) };

    if n > 0 {
        proc.read_buf.extend_from_slice(&buf[..n as usize]);
    } else if n == 0 {
        // EOF — process exited
        proc.alive = false;
        return;
    }
    // n < 0 means EAGAIN (no data available) — that's fine

    // Parse Content-Length framed messages from read_buf
    loop {
        // Look for "Content-Length: <number>\r\n\r\n"
        let buf_str = match std::str::from_utf8(&proc.read_buf) {
            Ok(s) => s,
            Err(_) => break,
        };

        let header_end = match buf_str.find("\r\n\r\n") {
            Some(pos) => pos,
            None => break,
        };

        // Parse Content-Length from header
        let header = &buf_str[..header_end];
        let content_length = parse_content_length(header);
        if content_length <= 0 {
            // Malformed header — skip to after \r\n\r\n and try again
            proc.read_buf.drain(..header_end + 4);
            continue;
        }

        let body_start = header_end + 4;
        let total_len = body_start + content_length as usize;

        if proc.read_buf.len() < total_len {
            // Not enough data yet — wait for more
            break;
        }

        // Extract the message body
        let body = std::str::from_utf8(&proc.read_buf[body_start..total_len])
            .unwrap_or("")
            .to_string();

        if !body.is_empty() {
            proc.message_queue.push_back(body);
        }

        proc.read_buf.drain(..total_len);
    }
}

/// Parse "Content-Length: <number>" from a header string.
fn parse_content_length(header: &str) -> i64 {
    for line in header.split("\r\n") {
        if line.starts_with("Content-Length:") || line.starts_with("content-length:") {
            let val = line[15..].trim();
            return val.parse::<i64>().unwrap_or(-1);
        }
    }
    -1
}

// ---------------------------------------------------------------------------
// FFI exports
// ---------------------------------------------------------------------------

/// Start a language server process.
/// `cmd_ptr` and `args_ptr` are Perry StringHeader pointers.
/// `args_ptr` is a space-separated string of arguments.
/// Returns a handle (0-3) on success, -1 on failure.
#[no_mangle]
pub unsafe extern "C" fn hone_lsp_start(
    cmd_ptr: *const u8,
    args_ptr: *const u8,
    cwd_ptr: *const u8,
) -> f64 {
    let cmd = str_from_header(cmd_ptr);
    let args_str = str_from_header(args_ptr);
    let cwd = str_from_header(cwd_ptr);

    // Parse space-separated args
    let args: Vec<&str> = if args_str.is_empty() {
        Vec::new()
    } else {
        args_str.split(' ').collect()
    };

    let (stdin_fd, stdout_fd, pid) = spawn_lsp(cmd, &args, cwd);
    if pid < 0 {
        return -1.0;
    }

    let proc = LspProcess {
        pid,
        stdin_fd,
        stdout_fd,
        read_buf: Vec::with_capacity(16384),
        message_queue: VecDeque::new(),
        alive: true,
    };

    // Find a free slot
    let mut servers = SERVERS.lock().unwrap();
    for i in 0..4 {
        if servers[i].is_none() {
            servers[i] = Some(proc);
            return i as f64;
        }
    }

    // No free slots — kill the process
    libc::kill(pid, libc::SIGTERM);
    libc::close(stdin_fd);
    libc::close(stdout_fd);
    -1.0
}

/// Send a JSON-RPC message to the language server.
/// Automatically wraps with Content-Length header.
/// `message_ptr` is a Perry StringHeader pointer containing the JSON body.
/// Returns 1.0 on success, 0.0 on failure.
#[no_mangle]
pub unsafe extern "C" fn hone_lsp_send(handle: f64, message_ptr: *const u8) -> f64 {
    let idx = handle as usize;
    if idx >= 4 { return 0.0; }

    let body = str_from_header(message_ptr);
    if body.is_empty() { return 0.0; }

    let mut servers = SERVERS.lock().unwrap();
    let proc = match servers[idx].as_mut() {
        Some(p) if p.alive => p,
        _ => return 0.0,
    };

    // Build Content-Length framed message
    let framed = format!("Content-Length: {}\r\n\r\n{}", body.len(), body);
    let bytes = framed.as_bytes();

    let written = libc::write(proc.stdin_fd, bytes.as_ptr() as *const _, bytes.len());
    if written < 0 {
        proc.alive = false;
        return 0.0;
    }

    1.0
}

/// Poll for the next complete JSON-RPC message from the server.
/// Returns a Perry StringHeader pointer to the message JSON, or 0 if none available.
/// The returned string must be freed by the caller (Perry GC handles this).
#[no_mangle]
pub unsafe extern "C" fn hone_lsp_poll(handle: f64) -> i64 {
    let idx = handle as usize;
    if idx >= 4 { return 0; }

    let mut servers = SERVERS.lock().unwrap();
    let proc = match servers[idx].as_mut() {
        Some(p) => p,
        None => return 0,
    };

    // Read any available data from stdout
    poll_messages(proc);

    // Return next queued message
    match proc.message_queue.pop_front() {
        Some(msg) => make_perry_string(&msg),
        None => 0,
    }
}

/// Check if the language server is still running.
/// Returns 1.0 if alive, 0.0 if dead.
#[no_mangle]
pub unsafe extern "C" fn hone_lsp_is_alive(handle: f64) -> f64 {
    let idx = handle as usize;
    if idx >= 4 { return 0.0; }

    let mut servers = SERVERS.lock().unwrap();
    let proc = match servers[idx].as_mut() {
        Some(p) => p,
        None => return 0.0,
    };

    // Check if child is still running
    let mut status: i32 = 0;
    let result = libc::waitpid(proc.pid, &mut status, libc::WNOHANG);
    if result > 0 {
        proc.alive = false;
        return 0.0;
    }

    if proc.alive { 1.0 } else { 0.0 }
}

/// Stop a language server process.
/// Returns 1.0 on success, 0.0 on failure.
#[no_mangle]
pub unsafe extern "C" fn hone_lsp_stop(handle: f64) -> f64 {
    let idx = handle as usize;
    if idx >= 4 { return 0.0; }

    let mut servers = SERVERS.lock().unwrap();
    if let Some(proc) = servers[idx].take() {
        libc::kill(proc.pid, libc::SIGTERM);
        libc::close(proc.stdin_fd);
        libc::close(proc.stdout_fd);
        // Reap child
        let mut status: i32 = 0;
        libc::waitpid(proc.pid, &mut status, 0);
        return 1.0;
    }

    0.0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_content_length_basic() {
        assert_eq!(parse_content_length("Content-Length: 42"), 42);
        assert_eq!(parse_content_length("Content-Length: 0"), 0);
        assert_eq!(parse_content_length("Content-Length: 1234"), 1234);
    }

    #[test]
    fn parse_content_length_missing() {
        assert_eq!(parse_content_length(""), -1);
        assert_eq!(parse_content_length("X-Custom: foo"), -1);
    }

    #[test]
    fn parse_content_length_multiline() {
        assert_eq!(
            parse_content_length("Content-Type: application/json\r\nContent-Length: 99"),
            99
        );
    }
}
