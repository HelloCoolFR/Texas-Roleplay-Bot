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

### Alternative: Download Directly from YouTube
You can download music directly from YouTube as an `.mp3` file inside your local `my_music` folder using the custom Python script:

```bash
cd "c:\Users\MATRINGHEN\Documents\Rojo_Projects\Texas_Rolepla\discord_bot" && python download_music.py "https://www.youtube.com/watch?v=..."
```

---

### Step 4: Git Command Steps
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
