require('dotenv').config();
const { 
    Client, 
    GatewayIntentBits, 
    ChannelType, 
    ActionRowBuilder, 
    StringSelectMenuBuilder, 
    ComponentType 
} = require('discord.js');
const {
    joinVoiceChannel,
    createAudioPlayer,
    createAudioResource,
    AudioPlayerStatus,
    VoiceConnectionStatus
} = require('@discordjs/voice');
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

// --- CONFIGURATION ---
const TOKEN = process.env.DISCORD_TOKEN; // Set this in Render's Environment Variables!
const PORT = process.env.PORT || 3000;
const WAITING_ROOM_NAME = "Waiting"; // The voice channel players must be in initially

// Configure FFmpeg binary path for prism-media
try {
    const ffmpeg = require('ffmpeg-static');
    if (ffmpeg) {
        process.env.FFMPEG_PATH = ffmpeg;
        console.log(`[Music] FFmpeg path configured to: ${ffmpeg}`);
    }
} catch (e) {
    console.error("[Music Warning] ffmpeg-static load failed:", e);
}
const MUSIC_DIR = path.join(__dirname, 'my_music'); // Folder for local MP3s

// Ensure music directory exists
if (!fs.existsSync(MUSIC_DIR)) {
    fs.mkdirSync(MUSIC_DIR, { recursive: true });
}

// --- DISCORD BOT SETUP ---
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// Music queues and players state per guild
const guildMusicData = {};
/* 
  Structure for guildMusicData[guildId]:
  {
     queue: [], // Array of { filePath, title }
     player: AudioPlayer,
     connection: VoiceConnection
  }
*/

client.on('clientReady', () => {
    console.log(`[Bot] Logged in as ${client.user.tag}!`);
    console.log(`[Bot] I am in ${client.guilds.cache.size} servers.`);
});

// Avoid crashes from unhandled promise rejections (like missing channel permissions)
process.on('unhandledRejection', error => {
    console.error('[Unhandled Rejection]', error);
});

client.on('error', error => {
    console.error('[Discord Client Error]', error);
});

let ACTIVE_CATEGORY_ID = null;

// --- MUSIC LOGIC HELPERS ---
function getGuildMusic(guildId) {
    if (!guildMusicData[guildId]) {
        guildMusicData[guildId] = {
            queue: [],
            player: createAudioPlayer(),
            connection: null
        };

        // Handle player state transitions
        guildMusicData[guildId].player.on(AudioPlayerStatus.Idle, () => {
            playNext(guildId);
        });

        guildMusicData[guildId].player.on('error', error => {
            console.error(`[Music Error] in guild ${guildId}:`, error);
            playNext(guildId);
        });
    }
    return guildMusicData[guildId];
}

async function playNext(guildId) {
    const data = guildMusicData[guildId];
    if (!data || data.queue.length === 0) return;

    const nextTrack = data.queue.shift();
    try {
        const resource = createAudioResource(nextTrack.filePath, { inlineVolume: true });
        resource.volume.setVolume(0.7); // 70% default volume
        data.player.play(resource);

        if (data.connection) {
            data.connection.subscribe(data.player);
        }
        console.log(`[Music] Now playing: ${nextTrack.title} in guild ${guildId}`);
    } catch (err) {
        console.error(`[Music] Failed to play track ${nextTrack.title}:`, err);
        playNext(guildId);
    }
}

// --- MESSAGE & COMMAND HANDLER ---
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    // --- PROXIMITY VOCALS COMMANDS ---
    if (message.content === '!start-vocals' || message.content === '/start-vocals') {
        if (!message.member.permissions.has('ManageChannels')) {
            return message.reply("You do not have permission to use this command.");
        }

        const categoryId = message.channel.parentId;
        if (!categoryId) {
            return message.reply("You must use this command inside a Text Channel that belongs to a Category!");
        }

        ACTIVE_CATEGORY_ID = categoryId;

        let waitingChannel = message.guild.channels.cache.find(c => c.name === WAITING_ROOM_NAME && c.type === ChannelType.GuildVoice);
        if (!waitingChannel) {
            await message.guild.channels.create({
                name: WAITING_ROOM_NAME,
                type: ChannelType.GuildVoice,
                parent: ACTIVE_CATEGORY_ID,
                reason: 'Created Waiting Hub via !start-vocals'
            });
            message.reply(`Bound bot to this category. Created \`${WAITING_ROOM_NAME}\` channel!`);
        } else {
            try {
                await waitingChannel.setParent(ACTIVE_CATEGORY_ID);
                message.reply(`Bound bot to this category. Moved existing \`${WAITING_ROOM_NAME}\` channel here.`);
            } catch (e) {
                console.error("Failed to move Waiting channel (Missing Permissions):", e);
                message.reply(`Bound bot to this category, but was unable to move the existing \`${WAITING_ROOM_NAME}\` channel (check bot permissions).`);
            }
        }
    }

    if (message.content === '!stop-vocals' || message.content === '/stop-vocals') {
        if (!message.member.permissions.has('ManageChannels')) {
            return message.reply("You do not have permission to use this command.");
        }

        let deletedCount = 0;
        message.guild.channels.cache.forEach(async (channel) => {
            if (channel.type === ChannelType.GuildVoice) {
                if (channel.name === WAITING_ROOM_NAME || channel.name.startsWith('ProxVoc')) {
                    try {
                        await channel.delete('Cleanup via !stop-vocals');
                        deletedCount++;
                    } catch (e) {
                        console.log("Failed to delete channel:", channel.name);
                    }
                }
            }
        });

        ACTIVE_CATEGORY_ID = null;
        message.reply(`Cleanup complete! Deleted ${deletedCount} proximity channels and reset the bot.`);
    }

    // --- INTERACTIVE UPLOADED FILE HANDLER ---
    // If a user uploads an MP3 file directly, download and play it
    if (message.attachments.size > 0) {
        const mp3Attachment = message.attachments.find(att => att.name.toLowerCase().endsWith('.mp3'));
        if (mp3Attachment) {
            if (!message.member.voice.channel) {
                return message.reply("❌ Join a voice channel first to play this uploaded song!");
            }

            const title = path.basename(mp3Attachment.name, '.mp3');
            const safeTitle = title.replace(/[^a-zA-Z0-9-_ ]/g, ''); // sanitize filename
            const downloadPath = path.join(MUSIC_DIR, `${safeTitle}_uploaded_${Date.now()}.mp3`);

            try {
                const response = await fetch(mp3Attachment.url);
                if (!response.ok) throw new Error("Failed to download attachment");
                
                const buffer = Buffer.from(await response.arrayBuffer());
                fs.writeFileSync(downloadPath, buffer);

                const guildId = message.guild.id;
                const musicData = getGuildMusic(guildId);

                // Connect to voice if not already connected
                const connState = musicData.connection ? musicData.connection.state.status : null;
                if (!musicData.connection || connState === VoiceConnectionStatus.Disconnected || connState === VoiceConnectionStatus.Destroyed) {
                    musicData.connection = joinVoiceChannel({
                        channelId: message.member.voice.channel.id,
                        guildId: message.guild.id,
                        adapterCreator: message.guild.voiceAdapterCreator,
                    });

                    // Listen for destroyed state to nullify
                    musicData.connection.on(VoiceConnectionStatus.Destroyed, () => {
                        musicData.connection = null;
                    });
                }

                musicData.queue.push({ filePath: downloadPath, title: `${title} (Uploaded)` });
                message.reply(`📥 Downloaded and added to queue: **${title}**`);

                // If nothing is playing, start immediately
                if (musicData.player.state.status === AudioPlayerStatus.Idle) {
                    playNext(guildId);
                }
            } catch (err) {
                console.error("[Upload Play Error]:", err);
                message.reply("❌ Failed to download or play the uploaded MP3 file.");
            }
        }
    }

    // --- MUSIC BOT COMMANDS ---
    const args = message.content.trim().split(/ +/);
    const command = args.shift().toLowerCase();

    if (command === '!play') {
        const query = args.join(' ');
        if (!query) return message.reply("Please specify a song name to search for!");

        if (!message.member.voice.channel) {
            return message.reply("❌ You need to join a voice channel first!");
        }

        // Scan local music folder for matching MP3 files
        const files = fs.readdirSync(MUSIC_DIR).filter(f => f.endsWith('.mp3'));
        const matchedFile = files.find(f => f.toLowerCase().includes(query.toLowerCase()));

        if (!matchedFile) {
            return message.reply(`❌ Could not find an MP3 matching **'${query}'** in the \`my_music\` directory.`);
        }

        const filePath = path.join(MUSIC_DIR, matchedFile);
        const title = path.basename(matchedFile, '.mp3');
        const guildId = message.guild.id;
        const musicData = getGuildMusic(guildId);

        // Connect to voice if not already connected
        const connState = musicData.connection ? musicData.connection.state.status : null;
        if (!musicData.connection || connState === VoiceConnectionStatus.Disconnected || connState === VoiceConnectionStatus.Destroyed) {
            musicData.connection = joinVoiceChannel({
                channelId: message.member.voice.channel.id,
                guildId: message.guild.id,
                adapterCreator: message.guild.voiceAdapterCreator,
            });

            // Listen for destroyed state to nullify
            musicData.connection.on(VoiceConnectionStatus.Destroyed, () => {
                musicData.connection = null;
            });
        }

        musicData.queue.push({ filePath, title });
        message.reply(`➕ Added to queue: **${title}**`);

        // If nothing is currently playing, start immediately
        if (musicData.player.state.status === AudioPlayerStatus.Idle) {
            playNext(guildId);
        }
    }

    if (command === '!list') {
        if (!message.member.voice.channel) {
            return message.reply("❌ You need to join a voice channel first!");
        }

        // Scan local music folder for MP3 files
        const files = fs.readdirSync(MUSIC_DIR).filter(f => f.endsWith('.mp3'));
        if (files.length === 0) {
            return message.reply("❌ The `my_music` directory is currently empty. Drop some .mp3 files there first!");
        }

        // Build Discord Select Menu options (limit to 25 items due to Discord Select Menu constraints)
        const options = files.slice(0, 25).map((file) => {
            const title = path.basename(file, '.mp3');
            return {
                label: title.slice(0, 100), // label constraint: max 100 chars
                description: `Play '${title.slice(0, 50)}'`,
                value: file
            };
        });

        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('song-select')
            .setPlaceholder('🎵 Choose a song from the library...')
            .addOptions(options);

        const row = new ActionRowBuilder().addComponents(selectMenu);

        const responseMsg = await message.reply({
            content: `📂 **Texas Roleplay Song Library** (${files.length} songs available):`,
            components: [row]
        });

        // Setup component collector for selection
        const filter = i => i.customId === 'song-select' && i.user.id === message.author.id;
        const collector = responseMsg.createMessageComponentCollector({
            componentType: ComponentType.StringSelect,
            filter,
            time: 60000 // 60 seconds interactive timeout
        });

        collector.on('collect', async i => {
            const selectedFile = i.values[0];
            const filePath = path.join(MUSIC_DIR, selectedFile);
            const title = path.basename(selectedFile, '.mp3');
            const guildId = message.guild.id;
            const musicData = getGuildMusic(guildId);

            // Connect to voice if not already connected
            const connState = musicData.connection ? musicData.connection.state.status : null;
            if (!musicData.connection || connState === VoiceConnectionStatus.Disconnected || connState === VoiceConnectionStatus.Destroyed) {
                musicData.connection = joinVoiceChannel({
                    channelId: message.member.voice.channel.id,
                    guildId: message.guild.id,
                    adapterCreator: message.guild.voiceAdapterCreator,
                });

                // Listen for destroyed state to nullify
                musicData.connection.on(VoiceConnectionStatus.Destroyed, () => {
                    musicData.connection = null;
                });
            }

            musicData.queue.push({ filePath, title });

            await i.update({
                content: `✅ Selected: **${title}** (Added to queue!)`,
                components: []
            });

            // If nothing is playing, play immediately
            if (musicData.player.state.status === AudioPlayerStatus.Idle) {
                playNext(guildId);
            }
        });

        collector.on('end', async (collected, reason) => {
            if (reason === 'time') {
                try {
                    await responseMsg.edit({
                        content: "⏳ Song list selection timed out.",
                        components: []
                    });
                } catch (e) {}
            }
        });
    }

    if (command === '!skip') {
        const guildId = message.guild.id;
        const musicData = guildMusicData[guildId];
        if (musicData && musicData.player.state.status !== AudioPlayerStatus.Idle) {
            musicData.player.stop(); // Triggers Idle -> plays next song
            message.reply("⏭️ Skipped current track.");
        } else {
            message.reply("❌ Nothing is playing right now.");
        }
    }

    if (command === '!queue') {
        const guildId = message.guild.id;
        const musicData = guildMusicData[guildId];
        if (!musicData || musicData.queue.length === 0) {
            return message.reply("📭 The music queue is currently empty.");
        }

        const queueList = musicData.queue.map((track, index) => `${index + 1}. ${track.title}`).join('\n');
        message.reply(`**Current Music Queue:**\n${queueList}`);
    }

    if (command === '!leave') {
        const guildId = message.guild.id;
        const musicData = guildMusicData[guildId];
        if (musicData && musicData.connection) {
            musicData.player.stop();
            musicData.queue = [];
            musicData.connection.destroy();
            musicData.connection = null;
            message.reply("👋 Disconnected from voice and cleared the queue.");
        } else {
            message.reply("❌ I'm not active in a voice channel.");
        }
    }

    if (command === '!version') {
        let commitInfo = "Unknown commit";
        try {
            const execSync = require('child_process').execSync;
            commitInfo = execSync('git log -1 --pretty=format:"%h - %s (%cr)"', { encoding: 'utf8' }).trim();
        } catch (e) {
            commitInfo = "Deployed on Render (Git history unavailable)";
        }
        message.reply(`⚙️ **Texas Roleplay Bot Version 2.1.0**\n📝 **Last Commit**: \`${commitInfo}\``);
    }
});

// Enforce Muting rules globally and cleanup proximity voice channels
client.on('voiceStateUpdate', async (oldState, newState) => {
    // Ignore updates related to the bot itself
    if (newState.id === client.user.id || oldState.id === client.user.id) return;

    // 1. Cleanup old channel if it's a ProxVoc and it's empty
    if (oldState.channel && (!newState.channel || oldState.channel.id !== newState.channel.id)) {
        if (oldState.channel.name.startsWith('ProxVoc')) {
            if (oldState.channel.members.size === 0) {
                try {
                    await oldState.channel.delete("Empty proximity channel cleanup");
                    console.log(`[Bot] Deleted empty channel: ${oldState.channel.name}`);
                } catch (e) {
                    console.log("Failed to delete empty channel:", e);
                }
            }
        }
    }

    // 2. Enforce Muting
    if (newState.channel) {
        if (newState.channel.name === WAITING_ROOM_NAME) {
            if (!newState.serverMute) {
                try {
                    await newState.setMute(true, "Always mute in Waiting Room");
                } catch (e) {
                    console.log("Failed to mute user in waiting room:", e);
                }
            }
        } else {
            if (newState.serverMute) {
                try {
                    await newState.setMute(false, "Left Waiting Room");
                } catch (e) {
                    console.log("Failed to unmute user:", e);
                }
            }
        }
    }
});

// Helper function to find a member by username or display name across all guilds
async function findMember(usernameInput) {
    usernameInput = usernameInput.toLowerCase();
    for (const [guildId, guild] of client.guilds.cache) {
        try {
            let found = guild.members.cache.find(m =>
                (m.user.username && m.user.username.toLowerCase() === usernameInput) ||
                (m.user.globalName && m.user.globalName.toLowerCase() === usernameInput) ||
                (m.nickname && m.nickname.toLowerCase() === usernameInput)
            );

            if (found) return { member: found, guild: guild };

            const members = await guild.members.fetch({ query: usernameInput, limit: 10 });
            found = members.find(m =>
                (m.user.username && m.user.username.toLowerCase() === usernameInput) ||
                (m.user.globalName && m.user.globalName.toLowerCase() === usernameInput) ||
                (m.nickname && m.nickname.toLowerCase() === usernameInput)
            );

            if (found) return { member: found, guild: guild };
        } catch (err) {
            console.log(`Error fetching members for guild ${guildId}:`, err);
        }
    }
    return null;
}

// Helper function to find or create a dynamic Voice Channel
async function getOrCreateProximityChannel(guild, channelName) {
    let channel = guild.channels.cache.find(c => c.name === channelName && c.type === ChannelType.GuildVoice);
    if (channel) return channel;

    console.log(`[Bot] Dynamically creating channel: ${channelName}`);
    channel = await guild.channels.create({
        name: channelName,
        type: ChannelType.GuildVoice,
        parent: ACTIVE_CATEGORY_ID || undefined,
        reason: 'Dynamic Proximity Voice Chat creation',
    });
    return channel;
}

// --- EXPRESS API SETUP ---
const app = express();
app.use(express.json());
app.use(cors());

// ENDPOINT: Verify User
app.post('/verify_user', async (req, res) => {
    const { username } = req.body;
    if (!username) return res.status(400).json({ success: false, error: "No username provided" });

    const result = await findMember(username);
    if (!result) return res.json({ success: false, error: "User not found in the Discord server." });

    const { member } = result;

    if (!member.voice.channel) {
        return res.json({ success: false, error: `You must join the '${WAITING_ROOM_NAME}' voice channel first!` });
    }

    if (member.voice.channel.name !== WAITING_ROOM_NAME) {
        return res.json({ success: false, error: `You must be in the '${WAITING_ROOM_NAME}' vocal channel first!` });
    }

    console.log(`[API] Successfully verified ${username}`);
    return res.json({ success: true, message: "Verified" });
});

// ENDPOINT: Move User
app.post('/move_user', async (req, res) => {
    const { username, targetChannelName, mute } = req.body;
    if (!username || !targetChannelName) return res.status(400).json({ success: false });

    const result = await findMember(username);
    if (!result) return res.json({ success: false, error: "User not found" });

    const { member, guild } = result;

    if (!member.voice.channel) {
        return res.json({ success: false, error: "User is not in any voice channel." });
    }

    try {
        const targetChannel = await getOrCreateProximityChannel(guild, targetChannelName);
        await member.voice.setChannel(targetChannel);
        console.log(`[API] Moved ${username} into ${targetChannelName}`);

        if (mute === true) {
            await member.voice.setMute(true, "Alone in proximity chat");
        } else if (mute === false) {
            await member.voice.setMute(false, "Joined proximity chat");
        }

        return res.json({ success: true });
    } catch (err) {
        console.log(`[API Error] Failed to move/mute user:`, err);
        return res.json({ success: false, error: "Failed to move/mute user." });
    }
});

// ENDPOINT: Rename Channel
app.post('/rename_channel', async (req, res) => {
    const { oldChannelName, newChannelName } = req.body;
    if (!oldChannelName || !newChannelName) return res.status(400).json({ success: false });

    try {
        let found = false;
        for (const [guildId, guild] of client.guilds.cache) {
            const channel = guild.channels.cache.find(c => c.name === oldChannelName && c.type === ChannelType.GuildVoice);
            if (channel) {
                await channel.setName(newChannelName, "Dynamic group rename");
                found = true;
                break;
            }
        }
        if (found) {
            return res.json({ success: true });
        } else {
            return res.json({ success: false, error: "Channel not found" });
        }
    } catch (err) {
        console.log(`[API Error] Failed to rename channel:`, err);
        return res.json({ success: false, error: "Failed to rename channel." });
    }
});

// ENDPOINT: Get Waiting Players
app.post('/waiting_players', async (req, res) => {
    try {
        let players = [];
        for (const [guildId, guild] of client.guilds.cache) {
            const channel = guild.channels.cache.find(c => c.name === WAITING_ROOM_NAME && c.type === ChannelType.GuildVoice);
            if (channel) {
                channel.members.forEach(m => {
                    if (m.user.username) players.push(m.user.username);
                    if (m.user.globalName && m.user.globalName !== m.user.username) players.push(m.user.globalName);
                    if (m.nickname) players.push(m.nickname);
                });
            }
        }
        players = [...new Set(players)];
        return res.json({ success: true, players: players });
    } catch (err) {
        console.log(`[API Error] Failed to fetch waiting players:`, err);
        return res.json({ success: false, error: "Failed to fetch players." });
    }
});

// START SERVER & BOT
app.listen(PORT, '0.0.0.0', () => {
    console.log(`[API] Web Server listening on port ${PORT}`);
});

client.login(TOKEN);