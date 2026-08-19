import os
import sys
import shutil
import subprocess

# --- CONFIGURATION ---
MUSIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "my_music")

def check_dependencies():
    """Checks if yt-dlp and ffmpeg are installed and accessible on system PATH."""
    yt_dlp_exists = shutil.which("yt-dlp") is not None
    ffmpeg_exists = shutil.which("ffmpeg") is not None

    if not yt_dlp_exists or not ffmpeg_exists:
        print("❌ Error: Missing required dependencies!")
        if not yt_dlp_exists:
            print("  - yt-dlp is missing. Install it using: pip install yt-dlp (or download the binary)")
        if not ffmpeg_exists:
            print("  - ffmpeg is missing. Download it and add it to your system PATH.")
        sys.exit(1)
    
    print("✅ Dependencies verified: 'yt-dlp' and 'ffmpeg' are active.")

def download_audio(youtube_url):
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
        "-o", out_template,              # Output destination template
        "--no-playlist",                 # Don't download entire playlists unless specified
        youtube_url
    ]

    print(f"\n📡 Starting download from: {youtube_url}")
    print("⏳ Downloading & converting... (This may take a moment)\n")

    try:
        # Run yt-dlp command and pipe output directly to console
        result = subprocess.run(command, check=True)
        if result.returncode == 0:
            print("\n🎉 Success! The audio has been downloaded and converted to MP3 in './my_music'.")
    except subprocess.CalledProcessError as e:
        print(f"\n❌ Download failed: The command returned a non-zero exit code ({e.returncode}).")
    except Exception as e:
        print(f"\n❌ An unexpected error occurred: {str(e)}")

def main():
    check_dependencies()
    
    # Check if a URL was passed as a CLI argument
    if len(sys.argv) > 1:
        url = sys.argv[1]
    else:
        # Fallback to interactive prompt
        url = input("🔗 Paste YouTube Video URL: ").strip()

    if not url:
        print("❌ Error: No URL provided.")
        sys.exit(1)

    download_audio(url)

if __name__ == "__main__":
    main()
