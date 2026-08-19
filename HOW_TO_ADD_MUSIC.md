# How to Add Music to the Discord Bot

To add new songs to the bot's live radio playlist, you must commit and push the new `.mp3` files to GitHub so that Render.com can pull and deploy them automatically.

Follow these simple commands in your terminal:

---

### Step 1: Open the Terminal and Navigate to the Bot Folder
Open your terminal (PowerShell or Command Prompt) and make sure you are in the bot's project directory:
```powershell
cd "c:\Users\MATRINGHEN\Documents\Rojo_Projects\Texas_Rolepla\discord_bot"
```

### Step 2: Add your MP3 files
Drop any new `.mp3` files you want into the `discord_bot/my_music/` directory.

### Alternative: Download Directly from YouTube (Interactive)
You can download music directly from YouTube as an `.mp3` file inside your local `my_music` folder using the custom interactive shortcut script.

From the repository root (`c:\Users\MATRINGHEN\Documents\Rojo_Projects\Texas_Rolepla`), simply run:
```powershell
.\Add_Music_YTB.bat
```
This will open the prompt, ask you for the YouTube URL, download the song, convert it, and output the progress bar!

---

### Step 4: Git Command Steps (Automatic Shortcut)
Instead of typing commands manually, you can instantly stage, commit, and push your newly downloaded music files to GitHub by running this shortcut from the repository root:
```powershell
.\Push_Music_Git.bat
```

Alternatively, you can run the commands manually:
1. **Stage all changes** (adds new MP3 files and tracks them):
   ```bash
   git add my_music/
   ```

2. **Commit the new songs** with a message:
   ```bash
   git commit -m "Add new songs to the radio playlist"
   ```

3. **Push the changes to GitHub**:
   ```bash
   git push origin main
   ```

---

### Step 5: Verification
Render.com will automatically detect the push and redeploy the bot (takes about 1-2 minutes).
- Once deployed, type `!version` to confirm the bot is active.
- The new tracks will automatically be indexed into the continuous radio rotation!
