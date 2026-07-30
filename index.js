require('dotenv').config();
const { Client, GatewayIntentBits, ChannelType } = require('discord.js');
const express = require('express');
const cors = require('cors');

// --- CONFIGURATION ---
const TOKEN = process.env.DISCORD_TOKEN; // Set this in Render's Environment Variables!
const PORT = process.env.PORT || 3000;
const WAITING_ROOM_NAME = "Waiting"; // The voice channel players must be in initially

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

client.on('ready', () => {
    console.log(`[Bot] Logged in as ${client.user.tag}!`);
    console.log(`[Bot] I am in ${client.guilds.cache.size} servers.`);
});

let ACTIVE_CATEGORY_ID = null;

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    if (message.content === '!start-vocals' || message.content === '/start-vocals') {
        if (!message.member.permissions.has('ManageChannels')) {
            return message.reply("You do not have permission to use this command.");
        }

        const categoryId = message.channel.parentId;
        if (!categoryId) {
            return message.reply("You must use this command inside a Text Channel that belongs to a Category!");
        }

        ACTIVE_CATEGORY_ID = categoryId;
        
        // Ensure Waiting room exists in this category
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
            // Move it to this category if it exists somewhere else
            await waitingChannel.setParent(ACTIVE_CATEGORY_ID);
            message.reply(`Bound bot to this category. Moved existing \`${WAITING_ROOM_NAME}\` channel here.`);
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
});

// Enforce Muting rules globally and cleanup
client.on('voiceStateUpdate', async (oldState, newState) => {
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
            // OPTIMIZATION 1: Check the bot's instant local cache first!
            // Anyone connected to a Voice Channel is automatically cached by the bot.
            let found = guild.members.cache.find(m => 
                (m.user.username && m.user.username.toLowerCase() === usernameInput) || 
                (m.user.globalName && m.user.globalName.toLowerCase() === usernameInput) ||
                (m.nickname && m.nickname.toLowerCase() === usernameInput)
            );
            
            if (found) return { member: found, guild: guild };

            // OPTIMIZATION 2: If not in cache, query Discord ONLY for this specific user.
            // (Previously this downloaded the entire server list, causing 20-second API rate limits)
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
    // Look for an existing channel with this name
    let channel = guild.channels.cache.find(c => c.name === channelName && c.type === ChannelType.GuildVoice);
    
    // If it exists but is FULL (unlikely) or something, we can use it. 
    // Actually, to optimize, we REUSE empty channels!
    if (channel) {
        return channel;
    }

    // If it doesn't exist, create it dynamically
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
// Roblox calls this when a player types their Discord username
app.post('/verify_user', async (req, res) => {
    const { username } = req.body;
    if (!username) return res.status(400).json({ success: false, error: "No username provided" });

    const result = await findMember(username);
    if (!result) return res.json({ success: false, error: "User not found in the Discord server." });

    const { member } = result;

    // Check if they are in a voice channel
    if (!member.voice.channel) {
        return res.json({ success: false, error: `You must join the '${WAITING_ROOM_NAME}' voice channel first!` });
    }

    // Force them to be in the exact "Waiting" room
    if (member.voice.channel.name !== WAITING_ROOM_NAME) {
        return res.json({ success: false, error: `You must be in the '${WAITING_ROOM_NAME}' vocal channel first!` });
    }

    console.log(`[API] Successfully verified ${username}`);
    return res.json({ success: true, message: "Verified" });
});

// ENDPOINT: Move User
// Roblox calls this to drag a player into a specific ProxVoc room
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
        // Find or create the target proximity channel
        const targetChannel = await getOrCreateProximityChannel(guild, targetChannelName);

        // Move the user!
        await member.voice.setChannel(targetChannel);
        console.log(`[API] Moved ${username} into ${targetChannelName}`);
        
        // Handle Mute
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
        players = [...new Set(players)]; // Unique
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
