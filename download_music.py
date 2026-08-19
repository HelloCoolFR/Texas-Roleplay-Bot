import os
import sys
import shutil
import subprocess

# --- CONFIGURATION ---
MUSIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "my_music")

def check_dependencies():
    """Checks if yt-dlp and ffmpeg are installed and accessible."""
    yt_dlp_exists = shutil.which("yt-dlp") is not None
    
    # Check global PATH, then check local node_modules fallback
    ffmpeg_path = shutil.which("ffmpeg")
    if not ffmpeg_path:
        local_fallback = os.path.join(
            os.path.dirname(os.path.abspath(__file__)),
            "node_modules", "ffmpeg-static", "ffmpeg.exe"
        )
        if os.path.exists(local_fallback):
            ffmpeg_path = local_fallback

    # Check for node location
    node_path = shutil.which("node")

    if not yt_dlp_exists or not ffmpeg_path:
        print("[ERROR] Missing required dependencies!")
        if not yt_dlp_exists:
            print("  - yt-dlp is missing. Install it using: pip install yt-dlp")
        if not ffmpeg_path:
            print("  - ffmpeg is missing. Download it and add it to your system PATH.")
        sys.exit(1)
    
    print(f"[OK] Dependencies verified: 'yt-dlp', 'ffmpeg' ({ffmpeg_path}), and 'node' ({node_path}) are active.")
    return ffmpeg_path, node_path

def download_audio(youtube_url, ffmpeg_path, node_path):
    """Downloads a YouTube video as an MP3 using yt-dlp and FFmpeg."""
    # Ensure the destination folder exists
    if not os.path.exists(MUSIC_DIR):
        os.makedirs(MUSIC_DIR)
        print(f"📁 Created folder: {MUSIC_DIR}")

    # Output template (sanitized title + mp3 extension)
    out_template = os.path.join(MUSIC_DIR, "%(title)s.%(ext)s")

    # Construct the yt-dlp CLI command arguments
    command = [
        "yt-dlp",
        "-x",                            # Extract audio
        "--audio-format", "mp3",         # Convert to MP3
        "--audio-quality", "0",          # Best VBR audio quality
        "--ffmpeg-location", ffmpeg_path,# Location of ffmpeg binary
        "-o", out_template,              # Output destination template
        "--no-playlist",                 # Don't download entire playlists unless specified
        "--js-runtimes", f"node:{node_path}" if node_path else "node", # Specify explicit Node.js binary path
        "--format", "bestaudio/best",    # Force audio format selection
        "--extractor-args", "youtube:player-client=android", # Force Android player client to avoid 403 Forbidden
        "--progress-template", "[download] [%(progress.bar)s] %(progress._percent_str)s of %(progress._total_bytes_estimate_str)s at %(progress._speed_str)s",
        youtube_url
    ]

    print(f"\n[INFO] Starting download from: {youtube_url}")
    print("[INFO] Downloading & converting... (This may take a moment)\n")

    try:
        # Run yt-dlp command and pipe output directly to console
        result = subprocess.run(command, check=True)
        if result.returncode == 0:
            print("\n[SUCCESS] The audio has been downloaded and converted to MP3 in './my_music'.")
    except subprocess.CalledProcessError as e:
        print(f"\n[ERROR] Download failed: The command returned a non-zero exit code ({e.returncode}).")
    except Exception as e:
        print(f"\n[ERROR] An unexpected error occurred: {str(e)}")

def main():
    ffmpeg_path, node_path = check_dependencies()
    
    # Check if a URL was passed as a CLI argument
    if len(sys.argv) > 1:
        url = sys.argv[1]
    else:
        # Fallback to interactive prompt
        url = input("Paste YouTube Video URL: ").strip()

    if not url:
        print("[ERROR] No URL provided.")
        sys.exit(1)

    download_audio(url, ffmpeg_path, node_path)

if __name__ == "__main__":
    main()
