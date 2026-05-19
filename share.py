"""One-click public sharing via Serveo tunnel."""
import subprocess
import re
import threading
import time
import sys
import os

PORT = 8001


def ensure_server():
    import urllib.request
    try:
        urllib.request.urlopen(f"http://localhost:{PORT}/api/leaderboard", timeout=2)
        print(f"[OK] Game server running on port {PORT}")
        return True
    except Exception:
        print(f"[..] Starting game server on port {PORT}...")
        subprocess.Popen(
            [sys.executable, "-c",
             f"import uvicorn; uvicorn.run('main:app',host='0.0.0.0',port={PORT})"],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            cwd=os.path.dirname(os.path.abspath(__file__)),
        )
        time.sleep(5)
        try:
            urllib.request.urlopen(f"http://localhost:{PORT}/api/leaderboard", timeout=2)
            print("[OK] Game server started")
            return True
        except Exception:
            print("[FAIL] Could not start game server")
            return False


def main():
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    print("=" * 55)
    print("  FRUIT MERGE - Public Share (via serveo.net)")
    print("  No registration, no public IP required")
    print("=" * 55)
    print()

    if not ensure_server():
        sys.exit(1)

    print("[..] Connecting to tunnel (may take 10-15s)...")
    print()

    proc = subprocess.Popen(
        ["ssh",
         "-o", "StrictHostKeyChecking=no",
         "-o", "ServerAliveInterval=30",
         "-T",
         "-R", f"80:localhost:{PORT}",
         "serveo.net"],
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
        text=True, bufsize=1,
    )

    url = None
    output_lines = []
    lock = threading.Lock()

    def reader():
        nonlocal url
        try:
            for line in proc.stdout:
                with lock:
                    output_lines.append(line.rstrip())
                # Strip ANSI codes
                clean = re.sub(r'\x1b\[[0-9;]*[mK]', '', line).strip()
                m = re.search(r'https://[a-zA-Z0-9-]+\.serveousercontent\.com', clean)
                if m:
                    url = m.group(0)
        except:
            pass

    t = threading.Thread(target=reader, daemon=True)
    t.start()

    # Wait for URL
    deadline = time.time() + 25
    while url is None and time.time() < deadline:
        time.sleep(0.5)
        with lock:
            for l in output_lines[-3:]:
                clean = re.sub(r'\x1b\[[0-9;]*[mK]', '', l).strip()
                if 'Forwarding' in clean or 'http' in clean.lower():
                    print(f"  {clean}")

    if url:
        print()
        print("=" * 55)
        print("  SUCCESS! Public URL:")
        print()
        print(f"    {url}")
        print()
        print("  Share this link with friends!")
        print("  Leaderboard updates in real-time")
        print()
        print("  Press Ctrl+C to close")
        print("=" * 55)
    else:
        print()
        print("[!] Could not detect tunnel URL.")
        print("    The tunnel may still work - check output above.")

    try:
        proc.wait()
    except KeyboardInterrupt:
        print("\nTunnel closed.")
        proc.terminate()


if __name__ == "__main__":
    main()
