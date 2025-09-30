/**
 * index.js
 * A comprehensive, fixed, and extended Discord bot file.
 *
 * - Ensures prefix and slash command parity
 * - Normalizes command keys (underscore <-> space)
 * - Robust message and interaction context (ctx) handling
 * - Anti-nuke scaffolding and automod features
 * - Many commands implemented across categories
 * - Leveling system toggles fixed and consistent
 *
 * AESTHETIC ENHANCEMENTS (NEW in this version):
 * 1. Professional, categorized Embed Color Palette (Success, Error, Mod, Leveling).
 * 2. Emojis added to most command titles for visual appeal.
 * 3. Improved formatting of core commands (help, ping, mod actions).
 *
 * CRITICAL FIX (from previous update):
 * - Slash command deployment logic updated to deploy commands **globally** AND **to the GUILD_ID** for immediate testing.
 *
 * IMPORTANT:
 * - Replace placeholder tokens and IDs with real ones
 * - This file is intentionally verbose with many comments for maintainability
 * - Test on a development guild (use GUILD_ID) before global registration
 *
 * Node/Discord.js assumptions:
 * - discord.js v14+ (uses REST, Routes, GatewayIntentBits, etc.)
 * - Node 16+ ideally Node 18+
 */

/* ============================================================
   Imports and Setup
   ============================================================ */
const fs = require('fs');
const path = require('path');

const keepAlive = require('./keepalive.js');
keepAlive();

const { REST } = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v10');
const {
  Client,
  GatewayIntentBits,
  Partials,
  Collection,
  EmbedBuilder,
  PermissionsBitField,
  PermissionFlagsBits,
  SlashCommandBuilder,
  ActivityType,
  ChannelType,
} = require('discord.js');

require('dotenv').config(); // load .env variables


/* ============================================================
   Configuration & Constants
   ============================================================ */

const TOKEN = process.env.TOKEN;

if (!TOKEN || TOKEN === 'YOUR_BOT_TOKEN') {
  console.error("\n❌ ERROR: Missing or invalid Discord bot TOKEN.\n" +
    "Check your .env file, it should look like this:\n" +
    "TOKEN=your_real_discord_bot_token_here\n");
  process.exit(1);
}

// Debug: Show token length (not full token for security)
console.log("🔑 TOKEN length:", TOKEN.length);
console.log("🔑 TOKEN preview:", TOKEN.slice(0, 5) + "...");

const CLIENT_ID = process.env.CLIENT_ID || 'YOUR_CLIENT_ID';
const GUILD_ID = process.env.GUILD_ID || null; // dev guild for fast slash updates
const MAIN_GUILD_ID = process.env.MAIN_GUILD_ID || null; // main server, optional

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

const FILES = {
  CONFIG: path.join(DATA_DIR, 'config.json'),
  USERS: path.join(DATA_DIR, 'users.json'),
  LOG: path.join(DATA_DIR, 'bot.log'),
};

const DEFAULT_PREFIX = '..'; // default prefix if missing in guild config
const BOT_OWNER_IDS = (process.env.OWNER_IDS || '').split(',').filter(Boolean); // optional owners
const MAX_MESSAGE_LENGTH = 2000;

const MAX_ANTISPAM_WINDOW = 10 * 1000; // 10 seconds default window
const MAX_ANTISPAM_MESSAGES = 5;

const NukeDetectionWindowMs = 10 * 1000; // 10 sec window for mass actions detection
const NukeThresholdChannelDeletes = 3; // number of channel deletions considered suspicious
const NukeThresholdRoleDeletes = 3;
const NukeThresholdBans = 3;

/* ============================================================
   EMBED COLOR PALETTE (Aesthetic Improvement)
   ============================================================ */
const EMBED_COLOR_SUCCESS = 0x28a745; // Green - Success/OK
const EMBED_COLOR_ERROR   = 0xdc3545; // Red - Danger/Error
const EMBED_COLOR_INFO    = 0x007bff; // Blue - Information
const EMBED_COLOR_WARN    = 0xffc107; // Yellow - Warning/Alert
const EMBED_COLOR_MOD     = 0x17a2b8; // Teal - Moderation Actions
const EMBED_COLOR_LEVEL   = 0x7646a7; // Purple - Leveling/XP

/* ============================================================
   LEVELING SYSTEM CONSTANTS
   ============================================================ */
const XP_COOLDOWN_MS = 60 * 1000; // 1 minute cooldown for XP gain
const lastXp = new Map(); // Map<userId, timestamp>
// Leveling formula: XP required for next level
const xpFormula = (level) => 5 * (level ** 2) + (50 * level) + 100;


/* ============================================================
   ANTI-LINK WHITELIST
   ============================================================ */
const SAFE_DOMAINS = [
    'discord.gg', 'discord.com', 'discordapp.com', 'youtube.com', 'youtu.be',
    'twitch.tv', 'twitter.com', 'x.com', 'github.com', 'tenor.com', 'giphy.com',
    'reddit.com', 'spotify.com', 'amazon.com', 'google.com', 'apple.com',
    'docs.google.com', 'sheets.google.com', 'forms.gle', 'media.discordapp.net',
];


/* ============================================================
   PRESENCE ROTATION CONFIGURATION
   ============================================================ */
const PRESENCES = [
    // 1. Watching Moderation | ..help (online) - Default Moderation
    { name: 'Moderation | ..help', type: ActivityType.Watching, status: 'online' },
    // 2. Data Analysis: Playing (idle) - Data analysis
    { name: 'Server Data | ..help', type: ActivityType.Playing, status: 'idle' },
    // 3. Command Listening: Listening (dnd) - Command listening
    { name: 'to Command Queries | ..help', type: ActivityType.Listening, status: 'dnd' },
    // 4. System Logs: Streaming (online) - System/log streams (Requires a URL)
    { 
        name: 'System Logs | ..help', 
        type: ActivityType.Streaming, 
        status: 'online', 
        url: 'https://www.twitch.tv/discord' // Placeholder URL: Required for ActivityType.Streaming
    },
];

/* ============================================================
   Helper: File load/save with defaults
   ============================================================ */

function safeReadJSON(file, defaultValue) {
  try {
    if (!fs.existsSync(file)) return defaultValue;
    const raw = fs.readFileSync(file, 'utf8');
    return JSON.parse(raw || '{}');
  } catch (e) {
    console.error('Failed to read JSON', file, e);
    return defaultValue;
  }
}
function safeWriteJSON(file, obj) {
  try {
    fs.writeFileSync(file, JSON.stringify(obj, null, 2), 'utf8');
  } catch (e) {
    console.error('Failed to write JSON', file, e);
  }
}

// persistent state
const config = safeReadJSON(FILES.CONFIG, {});
const users = safeReadJSON(FILES.USERS, {});

/* ============================================================
   Utility: save config helper
   ============================================================ */
function saveConfig() {
  safeWriteJSON(FILES.CONFIG, config);
}

/* ============================================================
   Utility: Leveling Logic
   ============================================================ */
function checkLevelUp(member, channel, currentLevel, currentXp) {
    const nextLevelXp = xpFormula(currentLevel);
    if (currentXp >= nextLevelXp) {
        const newLevel = currentLevel + 1;
        users[member.id].level = newLevel;
        // Carry over excess XP
        users[member.id].xp = currentXp - nextLevelXp; 
        safeWriteJSON(FILES.USERS, users);

        const embed = new EmbedBuilder()
            .setTitle(`🎉 Level Up! Level ${newLevel}`)
            .setDescription(`**Congratulations** ${member}! You've reached **Level ${newLevel}**!`)
            .setThumbnail(member.user.displayAvatarURL())
            .setColor(EMBED_COLOR_LEVEL);

        channel.send({ content: `${member}`, embeds: [embed] }).catch(()=>{});

        // Recursively check for multiple level ups
        checkLevelUp(member, channel, newLevel, users[member.id].xp);
    }
}


/* ============================================================
   Utility: Moderation Logging
   ============================================================ */
/**
 * Log a moderation action to the guild's mod log channel.
 * @param {Guild} guild The guild object.
 * @param {EmbedBuilder} embed The embed containing action details.
 */
async function logModerationAction(guild, embed) {
  const gid = guild.id;
  ensureGuildConfig(gid);
  const channelId = config[gid].modLogChannel;
  if (!channelId) return;

  try {
    const logChannel = await guild.channels.fetch(channelId).catch(() => null);
    if (logChannel && logChannel.isTextBased()) {
      // Ensure the embed is colored for the log
      embed.setColor(EMBED_COLOR_MOD);
      logChannel.send({ embeds: [embed] }).catch(()=>{});
    } else {
      // If the channel is gone, clear the config
      config[gid].modLogChannel = null;
      saveConfig();
    }
  } catch (e) {
    console.error('Failed to log moderation action:', e);
  }
}


/* ============================================================
   Utilities: Logging, Embeds, Respond adapter (Aesthetic Improvement)
   ============================================================ */

function log(...args) {
  const ln = `[${new Date().toISOString()}] ${args.join(' ')}`;
  console.log(ln);
  try {
    fs.appendFileSync(FILES.LOG, ln + '\n');
  } catch (e) {
    // ignore
  }
}

function mkEmbed(title, description, color = EMBED_COLOR_INFO) {
  return new EmbedBuilder().setTitle(title).setDescription(description).setColor(color).setTimestamp();
}
function embedInfo(title, desc) { return mkEmbed(title, desc, EMBED_COLOR_INFO); }
function embedSuccess(title, desc) { return mkEmbed(title, desc, EMBED_COLOR_SUCCESS); }
function embedError(title, desc) { return mkEmbed(title, desc, EMBED_COLOR_ERROR); }
function embedWarn(title, desc) { return mkEmbed(title, desc, EMBED_COLOR_WARN); }

/**
 * respond(ctx, { content, embeds, ephemeral })
 * Works for both message and interaction contexts.
 */
async function respond(ctx, options = {}) {
  try {
    const payload = {};
    if (options.content !== undefined) payload.content = options.content;
    if (options.embeds) payload.embeds = options.embeds;
    if (options.ephemeral) payload.ephemeral = options.ephemeral;
    if (options.components) payload.components = options.components;

    // interaction
    if (ctx?.isCommand?.() === true) {
      const interaction = ctx;
      if (interaction.replied || interaction.deferred) {
        return interaction.followUp(payload).catch(()=>{});
      } else {
        return interaction.reply(payload).catch(()=>{});
      }
    } else if (ctx?.channel) {
      // message
      const msg = ctx;
      return msg.channel.send(payload).catch(()=>{});
    } else {
      // fallback to console
      console.log('No ctx channel to respond to:', options);
    }
  } catch (e) {
    console.error('respond err', e);
  }
}

/* ============================================================
   Command mapping: commandsMap - central registry
   ============================================================ */

const commandsMap = {}; // { 'command key': async function(ctx) { ... } }

/* ============================================================
   ctx & command helpers (normalization)
   ============================================================ */

/**
 * Normalize command keys: converts underscores/spaces to a canonical 'space' key
 * e.g. enable_leveling -> enable leveling
 */
function normalizeCommandKey(name) {
  if (!name) return '';
  return String(name).toLowerCase().replace(/[_\s]+/g, ' ').trim();
}

/**
 * Build a uniform context object for message (prefix) handlers.
 * We keep the original Message object but add helpers: .isCommand(), .args
 */
function buildCtxFromMessage(message) {
  if (!message) return null;
  // Deep clone or new object to ensure original message is not mutated if required elsewhere
  const ctx = message;
  if (!ctx.isCommand) ctx.isCommand = () => false;
  if (!ctx.args) ctx.args = ctx.args || [];
  return ctx;
}

/**
 * Build a uniform context object for interactions (slash).
 * We use the Interaction object, set isCommand true and add args array.
 */
function buildCtxFromInteraction(interaction) {
  if (!interaction) return null;
  const ctx = interaction;
  if (!ctx.isCommand) ctx.isCommand = () => true;
  if (!ctx.args) ctx.args = [];
  return ctx;
}

/* ============================================================
   Helpers: Guild config management & ensure function
   ============================================================ */

function ensureGuildConfig(gid) {
  if (!gid) return {};
  const defaults = {
    prefix: DEFAULT_PREFIX,
    automod: {
      antilink: false,
      antispam: { enabled: true, max: MAX_ANTISPAM_MESSAGES, window: MAX_ANTISPAM_WINDOW },
      wordfilter: { enabled: false, bannedWords: [] },
      whitelistChannels: [],
      whitelistRoles: [],
      whitelistUsers: [],
    },
    nukemode: false,
    levelingEnabled: true,
    modLogChannel: null, // ID of the mod log channel
    slowmode: 0,
  };

  if (!config[gid]) config[gid] = {};

  // Deep merge defaults
  for (const [key, val] of Object.entries(defaults)) {
    if (config[gid][key] === undefined) {
      config[gid][key] = val;
    } else if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
      config[gid][key] = { ...val, ...config[gid][key] };
      for (const [subKey, subVal] of Object.entries(val)) {
        if (config[gid][key][subKey] === undefined) {
          config[gid][key][subKey] = subVal;
        }
      }
    }
  }

  safeWriteJSON(FILES.CONFIG, config);
  return config[gid];
}

/* ============================================================
   Permission helpers
   ============================================================ */

function isOwner(ctx) {
  try {
    const id = ctx?.user?.id || ctx?.author?.id;
    return BOT_OWNER_IDS.includes(String(id));
  } catch (e) { return false; }
}
function hasManageGuild(ctx) {
  try {
    if (!ctx.guild) return false;
    if (isOwner(ctx)) return true;
    const member = ctx.member;
    // Check for both prefix and slash contexts
    if (ctx.permissions && ctx.permissions instanceof PermissionsBitField) {
      return ctx.permissions.has(PermissionFlagsBits.ManageGuild);
    }
    return member?.permissions?.has?.(PermissionFlagsBits.ManageGuild) || false;
  } catch (e) { return false; }
}
function hasAdmin(ctx) {
  try {
    if (!ctx.guild) return false;
    if (isOwner(ctx)) return true;
    // Check for both prefix and slash contexts
    if (ctx.permissions && ctx.permissions instanceof PermissionsBitField) {
      return ctx.permissions.has(PermissionFlagsBits.Administrator);
    }
    return ctx.member?.permissions?.has?.(PermissionFlagsBits.Administrator) || false;
  } catch (e) { return false; }
}

/* ============================================================
   Anti-nuke scaffolding
   ============================================================ */

const recentEvents = {
  channelDeletes: [], // { guildId, time, channelId, executorId? }
  roleDeletes: [],
  bans: [],
};

/**
 * recordEvent: push event and prune old ones
 */
function recordEvent(type, payload) {
  const now = Date.now();
  if (!recentEvents[type]) recentEvents[type] = [];
  recentEvents[type].push({ ...payload, time: now });
  // prune older than window
  const cutoff = now - NukeDetectionWindowMs;
  recentEvents[type] = recentEvents[type].filter(e => e.time >= cutoff);
}

/**
 * checkForNuke: checks thresholds and returns true if a nuke is likely
 */
function checkForNuke(guildId) {
  const chDel = recentEvents.channelDeletes.filter(e => e.guildId === guildId).length;
  const rlDel = recentEvents.roleDeletes.filter(e => e.guildId === guildId).length;
  const bans = recentEvents.bans.filter(e => e.guildId === guildId).length;
  if (chDel >= NukeThresholdChannelDeletes || rlDel >= NukeThresholdRoleDeletes || bans >= NukeThresholdBans) {
    return true;
  }
  return false;
}

/**
 * activateSafeMode: when we think a nuke is happening, attempt to lock down
 */
async function activateSafeMode(guild) {
  try {
    const gid = guild.id;
    ensureGuildConfig(gid);
    config[gid].nukemode = true;
    saveConfig();
    // attempt to remove dangerous permissions from roles that are not managed by bot
    // caution: do not remove from administrators (we will log)
    const roles = guild.roles.cache.filter(r => !r.managed && r.editable);
    let locked = 0;
    for (const role of roles.values()) {
      // skip @everyone role change - but adjust sendMessages at channel level instead
      if (role.permissions.has(PermissionFlagsBits.Administrator)) continue;
      // remove dangerous perms: ManageChannels, ManageRoles, BanMembers, KickMembers
      const newPerms = role.permissions.remove([PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageRoles, PermissionFlagsBits.BanMembers, PermissionFlagsBits.KickMembers]);
      try {
        await role.setPermissions(newPerms);
        locked++;
      } catch (e) {
        // ignore failures to set permissions
      }
    }
    log(`Activated safe mode for guild ${gid}, roles locked: ${locked}`);
    // set slowmode server-wide (per-channel) as last resort - reduced rate
    guild.channels.cache.forEach(ch => {
      if (ch.isTextBased() && ch.viewable && ch.editable) {
        ch.setRateLimitPerUser(10).catch(()=>{});
      }
    });
  } catch (e) {
    console.error('activateSafeMode err', e);
  }
}

/**
 * deactivateSafeMode: revert safe mode
 */
async function deactivateSafeMode(guild) {
  try {
    const gid = guild.id;
    if (!config[gid]) return;
    config[gid].nukemode = false;
    saveConfig();
    // Note: re-applying original perms is non-trivial unless tracked.
    // For now we leave roles; operator should restore manually or via backup.
    log(`Deactivated safe mode for guild ${gid}`);
  } catch (e) {
    console.error('deactivateSafeMode err', e);
  }
}

/* ============================================================
   Automod implementations (antilink, antispam, wordfilter)
   ============================================================ */

const spamTracker = {}; // { guildId: { userId: [timestamps] } }

function recordMessageForSpam(gid, userId) {
  const now = Date.now();
  spamTracker[gid] = spamTracker[gid] || {};
  spamTracker[gid][userId] = spamTracker[gid][userId] || [];
  spamTracker[gid][userId].push(now);
  // prune older than window
  const window = config[gid]?.automod?.antispam?.window || MAX_ANTISPAM_WINDOW;
  spamTracker[gid][userId] = spamTracker[gid][userId].filter(ts => ts > now - window);
  return spamTracker[gid][userId].length;
}

/* ============================================================
   Commands: Core (Aesthetic Improvement)
   ============================================================ */

commandsMap['help'] = async (ctx) => {
  try {
    const prefix = config[ctx.guild?.id]?.prefix || DEFAULT_PREFIX;

    const modCommands = [
      `\`${prefix}clear <amount>\` - Bulk delete messages.`,
      `\`${prefix}kick @user [reason]\` - Kick a member.`,
      `\`${prefix}ban @user [reason]\` - Ban a member.`,
      `\`${prefix}tempban @user <dur>\` - Temporarily ban a member.`,
      `\`${prefix}softban @user\` - Ban, clear msgs, then unban.`,
      `\`${prefix}unban <user_id>\` - Unban a user by ID.`,
      `\`${prefix}mute @user [dur] [reason]\` - Timeout a member.`,
      `\`${prefix}unmute @user\` - Remove a member's timeout.`,
      `\`${prefix}warn @user [reason]\` - Issue a warning.`,
      `\`${prefix}warnings @user\` - View user's warnings.`,
    ].join('\n');

    const configCommands = [
      `\`${prefix}prefix [new_prefix]\` - View or change the command prefix.`,
      `\`${prefix}setmodlog <#channel>\` - Set the moderation logging channel.`,
      `\`${prefix}antilink on|off\` - Toggle link blocking (whitelist active).`,
      `\`${prefix}antispam set <max> <sec>\` - Configure anti-spam rules.`,
      `\`${prefix}wordfilter ...\` - Manage the banned words list.`,
      `\`${prefix}nukemode on|off\` - Toggle emergency safe mode.`,
      `\`${prefix}enable\` - Interactive security settings menu.`,
    ].join('\n');

    const utilCommands = [
      `\`${prefix}ping\` - Check bot latency/heartbeat.`,
      `\`${prefix}uptime\` - Show bot uptime.`,
      `\`${prefix}userinfo @user\` - Get user details.`,
      `\`${prefix}serverinfo\` - Get server details.`,
      `\`${prefix}avatar @user\` - Get user's avatar.`,
      `\`${prefix}roleinfo @role\` - Get role details.`,
      `\`${prefix}channelinfo\` - Get channel details.`,
    ].join('\n');

    const levelingCommands = [
        `\`${prefix}level [@user]\` - Check XP and level status.`,
        `\`${prefix}leaderboard\` - Show the top 10 leveled members.`,
    ].join('\n');


    const embed = new EmbedBuilder()
      .setTitle('📚 Rexo Help Menu')
      .setDescription(`Hello! I'm your secure moderation and utility bot.
My current **prefix** is: \`${prefix}\`
You can also use **slash commands** for all functions (e.g. \`/help\`).`)
      .setThumbnail(client.user.displayAvatarURL({ size: 128 }))
      .setColor(EMBED_COLOR_INFO)
      .addFields(
        { name: '🛡️ Moderation Commands', value: modCommands, inline: false },
        { name: '⚙️ Configuration & Security', value: configCommands, inline: false },
        { name: '📈 Leveling System (NEW)', value: levelingCommands, inline: false },
        { name: '🔍 Utility & Info', value: utilCommands, inline: false }
      )
      .setFooter({ text: `Type ${prefix}help or /help for this menu. | Developed by Rexo` })
      .setTimestamp();

    return respond(ctx, { embeds: [embed] });
  } catch (e) {
    console.error('help cmd err', e);
    return respond(ctx, { embeds: [embedError("Help Error", "Could not build help menu")] });
  }
};



commandsMap['ping'] = async (ctx) => {
  const start = Date.now();
  try {
    let replyMessage = null;
    if (ctx.channel) {
      replyMessage = await respond(ctx, { content: '🏓 Pinging...' });
    } else {
      if (ctx.isCommand?.() && !ctx.deferred && !ctx.replied) {
         await ctx.deferReply({ ephemeral: false }).catch(()=>{});
      }
    }

    const latency = Date.now() - start;
    const apiLatency = client.ws.ping.toFixed(0);

    const embed = new EmbedBuilder()
        .setTitle('🛰️ Pong!')
        .setDescription(`**Latency**: ${latency}ms (Message Edit/Reply)
**API Heartbeat**: ${apiLatency}ms (Discord API)`)
        .setThumbnail(client.user.displayAvatarURL({ size: 512 }))
        .setColor(EMBED_COLOR_INFO);

    if (replyMessage && replyMessage.edit) {
      return replyMessage.edit({ content: null, embeds: [embed] }).catch(()=>{});
    } else if (ctx.isCommand?.()) {
      return ctx.editReply({ embeds: [embed], content: null }).catch(()=>{});
    }
    return respond(ctx, { embeds: [embed] });

  } catch (e) {
    console.error('Ping command error:', e);
    return respond(ctx, { embeds: [embedError('Ping Error', 'Could not measure latency')] });
  }
};


commandsMap['uptime'] = async (ctx) => {
  const uptimeMs = process.uptime() * 1000;
  const s = Math.floor(uptimeMs / 1000) % 60;
  const m = Math.floor(uptimeMs / (60 * 1000)) % 60;
  const h = Math.floor(uptimeMs / (60 * 60 * 1000)) % 24;
  const d = Math.floor(uptimeMs / (24 * 60 * 60 * 1000));
  const str = `**${d}** Days, **${h}** Hours, **${m}** Minutes, **${s}** Seconds`;
  const embed = new EmbedBuilder()
    .setTitle('⏱️ Uptime')
    .setDescription(str)
    .setColor(EMBED_COLOR_INFO)
    .setThumbnail(client.user.displayAvatarURL({ size: 512 }));
  return respond(ctx, { embeds: [embed] });
};


commandsMap['avatar'] = async (ctx) => {
  const target = ctx?.isCommand?.()
    ? (ctx.options.getUser('user') || ctx.user)
    : (ctx.mentions?.users?.first?.() || ctx.author);

  const embed = new EmbedBuilder()
    .setTitle(`🖼️ ${target.tag}'s Avatar`)
    .setDescription(`[Click here for Avatar URL (${target.displayAvatarURL({ size: 1024, extension: 'png' })})]`)
    .setImage(target.displayAvatarURL({ size: 1024, extension: 'png' }))
    .setColor(EMBED_COLOR_INFO)
    .setFooter({ text: `User ID: ${target.id}` })
    .setTimestamp();

  return respond(ctx, { embeds: [embed] });
};


commandsMap['userinfo'] = async (ctx) => {
  try {
    const target = ctx.isCommand?.()
      ? (ctx.options.getUser('user') || ctx.user)
      : (ctx.mentions?.users?.first() || ctx.author);

    const member = await ctx.guild.members.fetch(target.id).catch(() => null);

    const roles = member ? member.roles.cache.filter(r => r.id !== ctx.guild.id).map(r => r.toString()).join(', ') || 'None' : 'N/A';

    const embed = new EmbedBuilder()
      .setTitle(`👤 User Info: ${target.tag}`)
      .setThumbnail(target.displayAvatarURL({ size: 512 }))
      .addFields(
        { name: 'ID', value: `\`${target.id}\``, inline: true },
        { name: 'Bot', value: target.bot ? '✅ Yes' : '❌ No', inline: true },
        { name: 'Nickname', value: member?.nickname || 'None', inline: true },
        { name: 'Account Created', value: `<t:${Math.floor(target.createdTimestamp / 1000)}:R>`, inline: false },
        { name: 'Joined Server', value: member ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>` : 'N/A', inline: false },
        { name: `Roles (${member?.roles?.cache?.size - 1 || 0})`, value: roles.length > 1024 ? 'Too many to display' : roles, inline: false }
      )
      .setColor(EMBED_COLOR_INFO)
      .setTimestamp();

    return respond(ctx, { embeds: [embed] });
  } catch (e) {
    return respond(ctx, { embeds: [embedError('Userinfo Error', 'Could not fetch user info')] });
  }
};


commandsMap['serverinfo'] = async (ctx) => {
  try {
    const guild = ctx.guild;

    const embed = new EmbedBuilder()
      .setTitle(`🏢 Server Info: ${guild.name}`)
      .setThumbnail(guild.iconURL({ size: 512 }))
      .addFields(
        { name: 'Server ID', value: `\`${guild.id}\``, inline: true },
        { name: 'Owner', value: `<@${guild.ownerId}>`, inline: true },
        { name: 'Verification Level', value: `${guild.verificationLevel}`, inline: true },
        { name: 'Created On', value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:R>`, inline: false },
        { name: 'Members', value: `Total: ${guild.memberCount}\nHumans: ${guild.members.cache.filter(m => !m.user.bot).size}\nBots: ${guild.members.cache.filter(m => m.user.bot).size}`, inline: true },
        { name: 'Channels', value: `Text: ${guild.channels.cache.filter(c => c.type === ChannelType.GuildText).size}\nVoice: ${guild.channels.cache.filter(c => c.type === ChannelType.GuildVoice).size}`, inline: true },
        { name: 'Roles', value: `${guild.roles.cache.size}`, inline: true },
        { name: 'Boost Level', value: `Tier ${guild.premiumTier}`, inline: true },
        { name: 'Boost Count', value: `${guild.premiumSubscriptionCount || 0}`, inline: true }
      )
      .setColor(EMBED_COLOR_INFO)
      .setTimestamp();

    return respond(ctx, { embeds: [embed] });
  } catch (e) {
    return respond(ctx, { embeds: [embedError('ServerInfo Error', 'Could not fetch server info')] });
  }
};


commandsMap['roleinfo'] = async (ctx) => {
  try {
    let role;
    if (ctx.isCommand?.()) role = ctx.options.getRole('role');
    else role = ctx.mentions?.roles?.first();
    if (!role) return respond(ctx, { embeds: [embedInfo('Role Info', 'No role specified.')] });

    const embed = new EmbedBuilder()
      .setTitle(`🔖 Role Info: ${role.name}`)
      .setColor(role.color || EMBED_COLOR_INFO)
      .addFields(
        { name: 'ID', value: `\`${role.id}\``, inline: true },
        { name: 'Color', value: `\`${role.hexColor}\``, inline: true },
        { name: 'Hoisted', value: role.hoist ? '✅ Yes' : '❌ No', inline: true },
        { name: 'Created On', value: `<t:${Math.floor(role.createdTimestamp / 1000)}:R>`, inline: false },
        { name: 'Members', value: `${role.members.size}`, inline: true },
        { name: 'Position', value: `${role.position}`, inline: true },
        { name: 'Mentionable', value: role.mentionable ? '✅ Yes' : '❌ No', inline: true }
      )
      .setFooter({ text: `Guild: ${ctx.guild.name}` })
      .setTimestamp();

    return respond(ctx, { embeds: [embed] });
  } catch (e) {
    return respond(ctx, { embeds: [embedError('RoleInfo Error', 'Could not fetch role info')] });
  }
};


commandsMap['channelinfo'] = async (ctx) => {
  try {
    const channel = ctx.isCommand?.() ? ctx.options.getChannel('channel') : ctx.channel;
    if (!channel) return respond(ctx, { embeds: [embedInfo('Channel Info', 'No channel context.')] });

    let type;
    switch (channel.type) {
        case ChannelType.GuildText: type = 'Text'; break;
        case ChannelType.GuildVoice: type = 'Voice'; break;
        case ChannelType.GuildCategory: type = 'Category'; break;
        case ChannelType.GuildNews: type = 'News'; break;
        case ChannelType.GuildPublicThread: type = 'Public Thread'; break;
        default: type = 'Other';
    }

    const embed = new EmbedBuilder()
        .setTitle(`💬 Channel Info: #${channel.name || channel.id}`)
        .setColor(EMBED_COLOR_INFO)
        .addFields(
            { name: 'ID', value: `\`${channel.id}\``, inline: true },
            { name: 'Type', value: type, inline: true },
            { name: 'Created On', value: `<t:${Math.floor(channel.createdTimestamp / 1000)}:R>`, inline: false },
            { name: 'Topic', value: channel.topic ? channel.topic.substring(0, 100) + (channel.topic.length > 100 ? '...' : '') : 'None', inline: false }
        )
        .setThumbnail(ctx.guild?.iconURL ? ctx.guild.iconURL({ size: 512 }) : null);

    return respond(ctx, { embeds: [embed] });
  } catch (e) {
    return respond(ctx, { embeds: [embedError('ChannelInfo Error', 'Could not fetch channel info')] });
  }
};


commandsMap['enable'] = async (ctx) => {
  if (!hasManageGuild(ctx)) return respond(ctx, { embeds: [embedError('Permission Denied', 'Need Manage Guild')] });

  const embed = mkEmbed('🔒 Security & Feature Toggle Menu','Select a setting to **toggle its status** (ON/OFF).');

  const gid = ctx.guild.id;
  ensureGuildConfig(gid);

  const options = [
    // Core anti-nuke toggles (handled by config flag here, actual logic in events)
    { label: `Anti Link (${config[gid].automod.antilink ? '✅ ON' : '❌ OFF'}) (Whitelist active)`, value: 'anti_link' },
    { label: `Word Filter (${config[gid].automod.wordfilter.enabled ? '✅ ON' : '❌ OFF'})`, value: 'word_filter' },
    { label: `Nuke Mode (${config[gid].nukemode ? '⚠️ ACTIVE' : '❌ OFF'})`, value: 'nuke_mode' },
    { label: `Raid Mode (${config[gid].automod.antispam.enabled ? '✅ ON' : '❌ OFF'})`, value: 'raid_mode' },
    { label: `Leveling System (${config[gid].levelingEnabled ? '✅ ON' : '❌ OFF'})`, value: 'leveling_system' },

    // Placeholder settings (require more config/commands)
    { label: 'Banning/Kicking Members (Needs Whitelist)', value: 'banning_members' },
    { label: 'Deleting/Creating Roles (Needs Whitelist)', value: 'deleting_roles' },
    { label: 'Deleting/Creating Channels (Needs Whitelist)', value: 'deleting_channels' },
    { label: 'Adding Bots (Needs Whitelist)', value: 'adding_bots' },
  ];
  const selectOptions = options.map(o => ({ label: o.label, value: o.value }));

  // Discord.js v14 expects components in a specific format
  const row = {
    type: 1, // ActionRow
    components: [{
      type: 3, // StringSelectMenu
      custom_id: 'enable_menu',
      placeholder: 'Choose a security feature to toggle...',
      options: selectOptions
    }]
  };
  return respond(ctx, { embeds:[embed], components:[row] , ephemeral: true });
};


/* ============================================================
   Commands: Moderation (Aesthetic Improvement)
   ============================================================ */

/**
 * internal helper to fetch target user for both contexts
 */
async function resolveTargetFromCtx(ctx) {
  if (ctx.isCommand?.()) {
    const u = ctx.options.getUser('user');
    return u || ctx.user;
  } else {
    return ctx.mentions?.users?.first() || ctx.author;
  }
}

commandsMap['clear'] = async (ctx) => {
  // Check permission for Manage Messages
  const memberPermissions = ctx.isCommand?.() ? ctx.member.permissions : ctx.member.permissions;
  if (!memberPermissions?.has(PermissionFlagsBits.ManageMessages)) {
      return respond(ctx, { embeds: [embedError('Permission Denied', 'Need Manage Messages')] });
  }
  try {
    let amount = 10;
    if (ctx.isCommand?.()) amount = ctx.options.getInteger('amount') || 10;
    else amount = Number(ctx.args?.[0]) || 10;
    amount = Math.min(100, Math.max(1, amount));

    // Defer reply for slash command if not already done, important for long operations like bulkDelete
    if (ctx.isCommand?.() && !ctx.deferred && !ctx.replied) await ctx.deferReply({ ephemeral: true }).catch(()=>{});

    // Bulk delete only works for messages under 14 days old
    const messages = await ctx.channel.bulkDelete(amount, true);

    const embed = embedSuccess('🗑️ Messages Cleared', `Successfully deleted **${messages.size}** messages in <#${ctx.channel.id}>.`);

    if (ctx.isCommand?.() && (ctx.deferred || ctx.replied)) {
      return ctx.editReply({ embeds: [embed] }).catch(()=>{});
    }
    // For prefix commands, send normally and then delete the confirmation message after a short delay
    const confirmation = await respond(ctx, { embeds: [embed] });
    if (confirmation && confirmation.delete) setTimeout(() => confirmation.delete().catch(()=>{}), 5000); // 5 seconds to view
    return;

  } catch (e) {
    const errorEmbed = embedError('Clear Error', `Failed to delete messages. Error: ${e.message.substring(0, 100)}`);
    if (ctx.isCommand?.() && (ctx.deferred || ctx.replied)) {
      return ctx.editReply({ embeds: [errorEmbed] }).catch(()=>{});
    }
    return respond(ctx, { embeds: [errorEmbed] });
  }
};

commandsMap['kick'] = async (ctx) => {
  // Check permission for Kick Members
  const memberPermissions = ctx.isCommand?.() ? ctx.member.permissions : ctx.member.permissions;
  if (!memberPermissions?.has(PermissionFlagsBits.KickMembers)) {
    return respond(ctx, { embeds: [embedError('Permission Denied', 'Need Kick Members')] });
  }
  try {
    const target = await resolveTargetFromCtx(ctx);
    if (!target) return respond(ctx, { embeds: [embedInfo('Kick', 'No target')] });

    if (ctx.isCommand?.() && !ctx.deferred && !ctx.replied) await ctx.deferReply({ ephemeral: false }).catch(()=>{});

    const member = await ctx.guild.members.fetch(target.id).catch(()=>null);
    if (!member) return respond(ctx, { embeds: [embedInfo('Kick', 'User not found or not in guild')] });
    if (!member.kickable) return respond(ctx, { embeds: [embedError('Kick Error', 'Cannot kick this member (role hierarchy or permissions)')] });

    await member.kick(`Kicked by ${ctx.user?.tag || ctx.author?.tag || 'moderator'}`);

    // Log the action (NEW)
    const logEmbed = new EmbedBuilder()
        .setTitle('👟 Member Kicked')
        .addFields(
            { name: 'User', value: `${target.tag} (\`${target.id}\`)`, inline: true },
            { name: 'Moderator', value: `${ctx.user?.tag || ctx.author?.tag} (\`${ctx.user?.id || ctx.author?.id}\`)`, inline: true }
        )
        .setColor(EMBED_COLOR_MOD)
        .setTimestamp();
    logModerationAction(ctx.guild, logEmbed);

    const embed = embedSuccess('👟 Kicked', `**${target.tag}** has been kicked from the server.`);
    if (ctx.isCommand?.() && (ctx.deferred || ctx.replied)) {
      return ctx.editReply({ embeds: [embed] }).catch(()=>{});
    }
    return respond(ctx, { embeds: [embed] });

  } catch (e) {
    console.error('kick err', e);
    const errorEmbed = embedError('Kick Error', `Failed to kick user. Error: ${e.message.substring(0, 100)}`);
    if (ctx.isCommand?.() && (ctx.deferred || ctx.replied)) {
      return ctx.editReply({ embeds: [errorEmbed] }).catch(()=>{});
    }
    return respond(ctx, { embeds: [errorEmbed] });
  }
};

commandsMap['ban'] = async (ctx) => {
  // Check permission for Ban Members
  const memberPermissions = ctx.isCommand?.() ? ctx.member.permissions : ctx.member.permissions;
  if (!memberPermissions?.has(PermissionFlagsBits.BanMembers)) {
    return respond(ctx, { embeds: [embedError('Permission Denied', 'Need Ban Members')] });
  }
  try {
    let reason = 'No reason provided';
    if (ctx.isCommand?.()) reason = ctx.options.getString('reason') || reason;
    else reason = ctx.args?.slice(1).join(' ') || reason;

    const target = await resolveTargetFromCtx(ctx);
    if (!target) return respond(ctx, { embeds: [embedInfo('Ban', 'No target')] });

    if (ctx.isCommand?.() && !ctx.deferred && !ctx.replied) await ctx.deferReply({ ephemeral: false }).catch(()=>{});

    const member = await ctx.guild.members.fetch(target.id).catch(()=>null);
    if (member && !member.bannable) return respond(ctx, { embeds: [embedError('Ban Error', 'Cannot ban this member (role hierarchy or permissions)')] });

    await ctx.guild.members.ban(target.id, { reason }).catch(()=>{});

    // Log the action (NEW)
    const logEmbed = new EmbedBuilder()
        .setTitle('🔨 Member Banned')
        .addFields(
            { name: 'User', value: `${target.tag} (\`${target.id}\`)`, inline: true },
            { name: 'Moderator', value: `${ctx.user?.tag || ctx.author?.tag} (\`${ctx.user?.id || ctx.author?.id}\`)`, inline: true },
            { name: 'Reason', value: reason.substring(0, 1024), inline: false }
        )
        .setColor(EMBED_COLOR_ERROR)
        .setTimestamp();
    logModerationAction(ctx.guild, logEmbed);

    const embed = embedSuccess('🔨 Banned', `**${target.tag}** has been banned. **Reason**: ${reason}`);
    if (ctx.isCommand?.() && (ctx.deferred || ctx.replied)) {
      return ctx.editReply({ embeds: [embed] }).catch(()=>{});
    }
    return respond(ctx, { embeds: [embed] });

  } catch (e) {
    console.error('ban err', e);
    const errorEmbed = embedError('Ban Error', `Failed to ban user. Error: ${e.message.substring(0, 100)}`);
    if (ctx.isCommand?.() && (ctx.deferred || ctx.replied)) {
      return ctx.editReply({ embeds: [errorEmbed] }).catch(()=>{});
    }
    return respond(ctx, { embeds: [errorEmbed] });
  }
};

commandsMap['softban'] = async (ctx) => {
  // Check permission for Ban Members
  const memberPermissions = ctx.isCommand?.() ? ctx.member.permissions : ctx.member.permissions;
  if (!memberPermissions?.has(PermissionFlagsBits.BanMembers)) {
    return respond(ctx, { embeds: [embedError('Permission Denied', 'Need Ban Members')] });
  }
  try {
    const target = await resolveTargetFromCtx(ctx);
    if (!target) return respond(ctx, { embeds: [embedInfo('Softban', 'No target')] });

    if (ctx.isCommand?.() && !ctx.deferred && !ctx.replied) await ctx.deferReply({ ephemeral: false }).catch(()=>{});

    const member = await ctx.guild.members.fetch(target.id).catch(()=>null);
    if (member && !member.bannable) return respond(ctx, { embeds: [embedError('Softban Error', 'Cannot softban this member (role hierarchy or permissions)')] });

    await ctx.guild.members.ban(target.id, { deleteMessageDays: 7, reason: 'Softban: Deleted messages' }).catch(()=>{});
    await ctx.guild.members.unban(target.id, 'Softban: Immediate unban after message purge').catch(()=>{});

    // Log the action (NEW)
    const logEmbed = new EmbedBuilder()
        .setTitle('💨 Member Softbanned')
        .addFields(
            { name: 'User', value: `${target.tag} (\`${target.id}\`)`, inline: true },
            { name: 'Moderator', value: `${ctx.user?.tag || ctx.author?.tag} (\`${ctx.user?.id || ctx.author?.id}\`)`, inline: true },
            { name: 'Action', value: 'Messages purged, user unbanned.', inline: false }
        )
        .setColor(EMBED_COLOR_MOD)
        .setTimestamp();
    logModerationAction(ctx.guild, logEmbed);

    const embed = embedSuccess('💨 Softbanned', `**${target.tag}** softbanned (messages removed, user unbanned)`);
    if (ctx.isCommand?.() && (ctx.deferred || ctx.replied)) {
      return ctx.editReply({ embeds: [embed] }).catch(()=>{});
    }
    return respond(ctx, { embeds: [embed] });
  } catch (e) {
    console.error('softban err', e);
    const errorEmbed = embedError('Softban Error', `Failed to softban user. Error: ${e.message.substring(0, 100)}`);
    if (ctx.isCommand?.() && (ctx.deferred || ctx.replied)) {
      return ctx.editReply({ embeds: [errorEmbed] }).catch(()=>{});
    }
    return respond(ctx, { embeds: [errorEmbed] });
  }
};

commandsMap['tempban'] = async (ctx) => {
  // Check permission for Ban Members
  const memberPermissions = ctx.isCommand?.() ? ctx.member.permissions : ctx.member.permissions;
  if (!memberPermissions?.has(PermissionFlagsBits.BanMembers)) {
    return respond(ctx, { embeds: [embedError('Permission Denied', 'Need Ban Members')] });
  }
  try {
    const target = await resolveTargetFromCtx(ctx);
    if (!target) return respond(ctx, { embeds: [embedInfo('Tempban', 'No target')] });

    const durationStr = ctx.isCommand?.() ? ctx.options.getString('duration') : ctx.args?.[1];
    const durationMs = parseDuration(durationStr || '1h'); // default 1 hour
    const reason = `Tempban for ${durationStr || '1h'} by ${ctx.user?.tag || ctx.author?.tag || 'moderator'}`;

    if (ctx.isCommand?.() && !ctx.deferred && !ctx.replied) await ctx.deferReply({ ephemeral: false }).catch(()=>{});

    const member = await ctx.guild.members.fetch(target.id).catch(()=>null);
    if (member && !member.bannable) return respond(ctx, { embeds: [embedError('Tempban Error', 'Cannot tempban this member (role hierarchy or permissions)')] });

    await ctx.guild.members.ban(target.id, { reason }).catch(()=>{});

    // schedule unban using a simple setTimeout (note: server restart loses schedule)
    setTimeout(async () => {
      try {
        await ctx.guild.members.unban(target.id, 'Automatic unban').catch(()=>{});
        log(`Auto-unbanned user ${target.id} in guild ${ctx.guild.id}`);
      } catch(e){
        console.error(`Error during auto-unban for ${target.id}:`, e);
      }
    }, durationMs);

    // Log the action (NEW)
    const logEmbed = new EmbedBuilder()
        .setTitle('🕒 Member Tempbanned')
        .addFields(
            { name: 'User', value: `${target.tag} (\`${target.id}\`)`, inline: true },
            { name: 'Moderator', value: `${ctx.user?.tag || ctx.author?.tag} (\`${ctx.user?.id || ctx.author?.id}\`)`, inline: true },
            { name: 'Duration', value: durationStr || '1h', inline: true },
            { name: 'Reason', value: reason.substring(0, 1024), inline: false }
        )
        .setColor(EMBED_COLOR_WARN)
        .setTimestamp();
    logModerationAction(ctx.guild, logEmbed);

    const embed = embedSuccess('🕒 Tempbanned', `**${target.tag}** temporarily banned for **${durationStr || '1h'}**.`);
    if (ctx.isCommand?.() && (ctx.deferred || ctx.replied)) {
      return ctx.editReply({ embeds: [embed] }).catch(()=>{});
    }
    return respond(ctx, { embeds: [embed] });

  } catch (e) {
    console.error('tempban err', e);
    const errorEmbed = embedError('Tempban Error', `Failed to tempban user. Error: ${e.message.substring(0, 100)}`);
    if (ctx.isCommand?.() && (ctx.deferred || ctx.replied)) {
      return ctx.editReply({ embeds: [errorEmbed] }).catch(()=>{});
    }
    return respond(ctx, { embeds: [errorEmbed] });
  }
};

function parseDuration(input) {
  // Parses things like '1h', '30m', '10s', '2d'
  if (!input) return 60 * 60 * 1000;
  const numMatch = input.match(/(\d+)/);
  const unitMatch = input.match(/[a-z]+/i);

  const num = numMatch ? Number(numMatch[0]) : 1;
  const unit = unitMatch ? unitMatch[0].toLowerCase() : 'm'; // default to minutes if only a number is passed

  if (unit.startsWith('d')) return num * 24 * 60 * 60 * 1000;
  if (unit.startsWith('h')) return num * 60 * 60 * 1000;
  if (unit.startsWith('m')) return num * 60 * 1000;
  if (unit.startsWith('s')) return num * 1000;

  return num * 1000; // Fallback to seconds if no unit is clear
}

commandsMap['unban'] = async (ctx) => {
  // Check permission for Ban Members
  const memberPermissions = ctx.isCommand?.() ? ctx.member.permissions : ctx.member.permissions;
  if (!memberPermissions?.has(PermissionFlagsBits.BanMembers)) {
    return respond(ctx, { embeds: [embedError('Permission Denied', 'Need Ban Members')] });
  }
  try {
    let targetId;
    if (ctx.isCommand?.()) targetId = ctx.options.getString('user_id');
    else targetId = ctx.args?.[0];

    if (!targetId) return respond(ctx, { embeds: [embedInfo('Unban', 'No user id provided')] });
    if (!/^\d{17,19}$/.test(targetId)) return respond(ctx, { embeds: [embedError('Unban Error', 'Invalid user ID format')] });

    if (ctx.isCommand?.() && !ctx.deferred && !ctx.replied) await ctx.deferReply({ ephemeral: false }).catch(()=>{});

    await ctx.guild.members.unban(targetId).catch(e => {
        if (e.code === 10026) throw new Error("User not found in ban list."); // Unknown Ban
        throw e;
    });

    // Log the action (NEW)
    const logEmbed = new EmbedBuilder()
        .setTitle('🔓 Member Unbanned')
        .addFields(
            { name: 'User ID', value: `\`${targetId}\``, inline: true },
            { name: 'Moderator', value: `${ctx.user?.tag || ctx.author?.tag} (\`${ctx.user?.id || ctx.author?.id}\`)`, inline: true }
        )
        .setColor(EMBED_COLOR_SUCCESS)
        .setTimestamp();
    logModerationAction(ctx.guild, logEmbed);

    const embed = embedSuccess('🔓 Unbanned', `User ID: \`${targetId}\` has been unbanned successfully.`);
    if (ctx.isCommand?.() && (ctx.deferred || ctx.replied)) {
      return ctx.editReply({ embeds: [embed] }).catch(()=>{});
    }
    return respond(ctx, { embeds: [embed] });

  } catch (e) {
    console.error('unban err', e);
    const errorEmbed = embedError('Unban Error', `Failed to unban user. Error: ${e.message.substring(0, 100)}`);
    if (ctx.isCommand?.() && (ctx.deferred || ctx.replied)) {
      return ctx.editReply({ embeds: [errorEmbed] }).catch(()=>{});
    }
    return respond(ctx, { embeds: [errorEmbed] });
  }
};

commandsMap['mute'] = async (ctx) => {
  // Check permission for Manage Roles
  const memberPermissions = ctx.isCommand?.() ? ctx.member.permissions : ctx.member.permissions;
  if (!memberPermissions?.has(PermissionFlagsBits.ManageRoles)) {
    return respond(ctx, { embeds: [embedError('Permission Denied', 'Need Manage Roles')] });
  }
  try {
    const target = await resolveTargetFromCtx(ctx);
    if (!target) return respond(ctx, { embeds: [embedInfo('Mute', 'No target')] });

    if (ctx.isCommand?.() && !ctx.deferred && !ctx.replied) await ctx.deferReply({ ephemeral: false }).catch(()=>{});

    // discord.js v14 strongly prefers using timeouts instead of a 'Muted' role for muting.
    const durationStr = ctx.isCommand?.() ? ctx.options.getString('duration') : ctx.args?.[1];
    const durationMs = parseDuration(durationStr || '1h');
    const reason = ctx.isCommand?.() ? ctx.options.getString('reason') : ctx.args?.slice(2).join(' ') || 'Muted by moderator (No reason)';

    const member = await ctx.guild.members.fetch(target.id).catch(()=>null);
    if (!member) return respond(ctx, { embeds: [embedInfo('Mute', 'Member not found')] });
    if (!member.moderatable) return respond(ctx, { embeds: [embedError('Mute Error', 'Cannot moderate this member (role hierarchy or bot permissions)')] });

    await member.timeout(durationMs, reason).catch(e => {
        throw new Error(`Failed to apply timeout: ${e.message.substring(0, 100)}`);
    });

    // Log the action (NEW)
    const logEmbed = new EmbedBuilder()
        .setTitle('🔇 Member Timed Out')
        .addFields(
            { name: 'User', value: `${target.tag} (\`${target.id}\`)`, inline: true },
            { name: 'Moderator', value: `${ctx.user?.tag || ctx.author?.tag} (\`${ctx.user?.id || ctx.author?.id}\`)`, inline: true },
            { name: 'Duration', value: durationStr || '1h', inline: true },
            { name: 'Reason', value: reason.substring(0, 1024), inline: false }
        )
        .setColor(EMBED_COLOR_WARN)
        .setTimestamp();
    logModerationAction(ctx.guild, logEmbed);

    const embed = embedSuccess('🔇 Muted/Timed Out', `**${target.tag}** timed out for **${durationStr || '1h'}**. **Reason**: ${reason}`);
    if (ctx.isCommand?.() && (ctx.deferred || ctx.replied)) {
      return ctx.editReply({ embeds: [embed] }).catch(()=>{});
    }
    return respond(ctx, { embeds: [embed] });

  } catch (e) {
    console.error('mute err', e);
    const errorEmbed = embedError('Mute Error', `Failed to mute user. Error: ${e.message.substring(0, 100)}`);
    if (ctx.isCommand?.() && (ctx.deferred || ctx.replied)) {
      return ctx.editReply({ embeds: [errorEmbed] }).catch(()=>{});
    }
    return respond(ctx, { embeds: [errorEmbed] });
  }
};

commandsMap['unmute'] = async (ctx) => {
  // Check permission for Manage Roles
  const memberPermissions = ctx.isCommand?.() ? ctx.member.permissions : ctx.member.permissions;
  if (!memberPermissions?.has(PermissionFlagsBits.ManageRoles)) {
    return respond(ctx, { embeds: [embedError('Permission Denied', 'Need Manage Roles')] });
  }
  try {
    const target = await resolveTargetFromCtx(ctx);
    if (!target) return respond(ctx, { embeds: [embedInfo('Unmute', 'No target')] });

    if (ctx.isCommand?.() && !ctx.deferred && !ctx.replied) await ctx.deferReply({ ephemeral: false }).catch(()=>{});

    const member = await ctx.guild.members.fetch(target.id).catch(()=>null);
    if (!member) return respond(ctx, { embeds: [embedInfo('Unmute', 'Member not found')] });
    if (!member.moderatable) return respond(ctx, { embeds: [embedError('Unmute Error', 'Cannot moderate this member (role hierarchy or bot permissions)')] });
    if (!member.communicationDisabledUntil) return respond(ctx, { embeds: [embedInfo('Unmute', `**${target.tag}** is not muted/timed out.`)] });

    await member.timeout(null, 'Unmuted by moderator').catch(e => {
        throw new Error(`Failed to remove timeout: ${e.message.substring(0, 100)}`);
    });

    // Log the action (NEW)
    const logEmbed = new EmbedBuilder()
        .setTitle('🔊 Member Untimed Out')
        .addFields(
            { name: 'User', value: `${target.tag} (\`${target.id}\`)`, inline: true },
            { name: 'Moderator', value: `${ctx.user?.tag || ctx.author?.tag} (\`${ctx.user?.id || ctx.author?.id}\`)`, inline: true }
        )
        .setColor(EMBED_COLOR_SUCCESS)
        .setTimestamp();
    logModerationAction(ctx.guild, logEmbed);

    const embed = embedSuccess('🔊 Unmuted', `**${target.tag}** has been removed from timeout.`);
    if (ctx.isCommand?.() && (ctx.deferred || ctx.replied)) {
      return ctx.editReply({ embeds: [embed] }).catch(()=>{});
    }
    return respond(ctx, { embeds: [embed] });

  } catch (e) {
    console.error('unmute err', e);
    const errorEmbed = embedError('Unmute Error', `Failed to unmute user. Error: ${e.message.substring(0, 100)}`);
    if (ctx.isCommand?.() && (ctx.deferred || ctx.replied)) {
      return ctx.editReply({ embeds: [errorEmbed] }).catch(()=>{});
    }
    return respond(ctx, { embeds: [errorEmbed] });
  }
};

commandsMap['warn'] = async (ctx) => {
  // Check permission for Manage Messages or Manage Guild
  const memberPermissions = ctx.isCommand?.() ? ctx.member.permissions : ctx.member.permissions;
  if (!memberPermissions?.has(PermissionFlagsBits.ManageMessages) && !memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    return respond(ctx, { embeds: [embedError('Permission Denied', 'Need Manage Messages or Manage Guild')] });
  }
  try {
    const target = await resolveTargetFromCtx(ctx);
    const reason = ctx.isCommand?.() ? ctx.options.getString('reason') : ctx.args?.slice(1).join(' ') || 'No reason provided';
    if (!target) return respond(ctx, { embeds: [embedInfo('Warn', 'No target')] });

    if (ctx.isCommand?.() && !ctx.deferred && !ctx.replied) await ctx.deferReply({ ephemeral: false }).catch(()=>{});

    // store warning in users DB
    users[target.id] = users[target.id] || { xp: 0, level: 0, warns: [] };
    users[target.id].warns.push({ by: ctx.user?.id || ctx.author?.id, reason, time: Date.now() });
    safeWriteJSON(FILES.USERS, users);
    const totalWarnings = users[target.id].warns.length;

    // Log the action (NEW)
    const logEmbed = new EmbedBuilder()
        .setTitle('⚠️ Member Warned')
        .addFields(
            { name: 'User', value: `${target.tag} (\`${target.id}\`)`, inline: true },
            { name: 'Moderator', value: `${ctx.user?.tag || ctx.author?.tag} (\`${ctx.user?.id || ctx.author?.id}\`)`, inline: true },
            { name: 'Total Warnings', value: `${totalWarnings}`, inline: true },
            { name: 'Reason', value: reason.substring(0, 1024), inline: false }
        )
        .setColor(EMBED_COLOR_WARN)
        .setTimestamp();
    logModerationAction(ctx.guild, logEmbed);

    const embed = embedSuccess('⚠️ Warned', `**${target.tag}** warned for: **${reason}**. Total warnings: **${totalWarnings}**`);
    if (ctx.isCommand?.() && (ctx.deferred || ctx.replied)) {
      return ctx.editReply({ embeds: [embed] }).catch(()=>{});
    }
    return respond(ctx, { embeds: [embed] });

  } catch (e) {
    console.error('warn cmd err', e);
    const errorEmbed = embedError('Warn Error', `Failed to warn user. Error: ${e.message.substring(0, 100)}`);
    if (ctx.isCommand?.() && (ctx.deferred || ctx.replied)) {
      return ctx.editReply({ embeds: [errorEmbed] }).catch(()=>{});
    }
    return respond(ctx, { embeds: [errorEmbed] });
  }
};

commandsMap['warnings'] = async (ctx) => {
  // Check permission for Manage Messages or Manage Guild
  const memberPermissions = ctx.isCommand?.() ? ctx.member.permissions : ctx.member.permissions;
  if (!memberPermissions?.has(PermissionFlagsBits.ManageMessages) && !memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    return respond(ctx, { embeds: [embedError('Permission Denied', 'Need Manage Messages or Manage Guild')] });
  }
  try {
    const target = await resolveTargetFromCtx(ctx);
    if (!target) return respond(ctx, { embeds: [embedInfo('Warnings', 'No target')] });
    if (ctx.isCommand?.() && !ctx.deferred && !ctx.replied) await ctx.deferReply({ ephemeral: false }).catch(()=>{});

    const userEntry = users[target.id] || { warns: [] };
    const warns = userEntry.warns;
    const warnsCount = warns.length;

    let description = `**${target.tag}** has **${warnsCount}** warnings.`;

    if (warnsCount > 0) {
      // Display up to the last 5 warnings
      const lastWarns = warns.slice(-5).reverse();
      const warnList = lastWarns.map((w, i) => {
        const date = `<t:${Math.floor(w.time / 1000)}:R>`;
        return `\`#${warnsCount - i}\` by <@${w.by}> ${date}: **${w.reason}**`;
      }).join('\n');
      description += `\n\n**Last ${lastWarns.length} Warnings:**\n${warnList}`;
    }

    const embed = embedInfo('📜 User Warnings', description);
    if (ctx.isCommand?.() && (ctx.deferred || ctx.replied)) {
      return ctx.editReply({ embeds: [embed] }).catch(()=>{});
    }
    return respond(ctx, { embeds: [embed] });

  } catch (e) {
    console.error('warnings cmd err', e);
    const errorEmbed = embedError('Warnings Error', `Failed to fetch warnings. Error: ${e.message.substring(0, 100)}`);
    if (ctx.isCommand?.() && (ctx.deferred || ctx.replied)) {
      return ctx.editReply({ embeds: [errorEmbed] }).catch(()=>{});
    }
    return respond(ctx, { embeds: [errorEmbed] });
  }
};


/* ============================================================
   Commands: Utility/Config
   ============================================================ */

commandsMap['prefix'] = async (ctx) => {
  if (!hasManageGuild(ctx)) return respond(ctx, { embeds: [embedError('Permission Denied', 'Need Manage Guild')] });
  try {
    const newPrefix = ctx.isCommand?.() ? ctx.options.getString('new_prefix') : ctx.args?.[0];
    const gid = ctx.guild.id;
    ensureGuildConfig(gid);

    if (!newPrefix) {
        return respond(ctx, { embeds: [embedInfo('⚙️ Current Prefix', `The current prefix is: \`${config[gid].prefix}\`. Use \`..prefix <new_prefix>\` to change it.`)] });
    }

    if (newPrefix.length > 5) return respond(ctx, { embeds: [embedError('Error', 'Prefix too long. Max 5 characters.')] });

    config[gid].prefix = newPrefix;
    saveConfig();

    return respond(ctx, { embeds: [embedSuccess('✅ Prefix Updated', `New prefix set to: \`${newPrefix}\``)] });
  } catch (e) {
    console.error('prefix cmd err', e);
    return respond(ctx, { embeds: [embedError('Prefix Error', 'Could not set new prefix')] });
  }
};

commandsMap['setmodlog'] = async (ctx) => {
  if (!hasManageGuild(ctx)) return respond(ctx, { embeds: [embedError('Permission Denied', 'Need Manage Guild')] });
  try {
    let targetChannel = ctx.isCommand?.() ? ctx.options.getChannel('channel') : ctx.mentions.channels.first();
    const gid = ctx.guild.id;
    ensureGuildConfig(gid);

    if (!targetChannel) {
        // If no channel mentioned, disable logging
        config[gid].modLogChannel = null;
        saveConfig();
        return respond(ctx, { embeds: [embedWarn('🚫 Mod Log Channel Disabled', 'Moderation logging has been disabled for this guild.')] });
    }

    if (!targetChannel.isTextBased()) {
        return respond(ctx, { embeds: [embedError('Error', 'The selected channel must be a text channel.')] });
    }

    config[gid].modLogChannel = targetChannel.id;
    saveConfig();

    return respond(ctx, { embeds: [embedSuccess('✅ Mod Log Channel Set', `Moderation actions will now be logged in ${targetChannel}.`)] });
  } catch (e) {
    console.error('setmodlog cmd err', e);
    return respond(ctx, { embeds: [embedError('Mod Log Error', 'Could not set the moderation log channel')] });
  }
};


commandsMap['nukemode'] = async (ctx) => {
  if (!hasAdmin(ctx)) return respond(ctx, { embeds: [embedError('Permission Denied', 'Need Administrator')] });
  try {
    const action = ctx.isCommand?.() ? ctx.options.getString('action') : ctx.args?.[0];
    const gid = ctx.guild.id;
    ensureGuildConfig(gid);

    if (!action) {
        const status = config[gid].nukemode ? '⚠️ ACTIVE' : '❌ OFF';
        return respond(ctx, { embeds: [embedInfo('⚠️ Nuke Mode Status', `Current Emergency Safe Mode status is: **${status}**.`)] });
    }

    if (action.toLowerCase() === 'on' || action.toLowerCase() === 'true') {
        if (config[gid].nukemode) {
            return respond(ctx, { embeds: [embedWarn('Nuke Mode', 'Nuke Mode is already active.')] });
        }
        await activateSafeMode(ctx.guild);
        return respond(ctx, { embeds: [embedSuccess('🚨 Nuke Mode Activated', 'Emergency Safe Mode manually activated. Potentially dangerous permissions have been removed from non-admin roles.')] });
    } else if (action.toLowerCase() === 'off' || action.toLowerCase() === 'false') {
        if (!config[gid].nukemode) {
            return respond(ctx, { embeds: [embedWarn('Nuke Mode', 'Nuke Mode is already inactive.')] });
        }
        await deactivateSafeMode(ctx.guild);
        return respond(ctx, { embeds: [embedSuccess('✅ Nuke Mode Deactivated', 'Emergency Safe Mode deactivated. Remember to manually restore any roles if permissions were stripped.')] });
    } else {
        return respond(ctx, { embeds: [embedError('Invalid Action', 'Please specify `on` or `off`.')] });
    }

  } catch (e) {
    console.error('nukemode cmd err', e);
    return respond(ctx, { embeds: [embedError('Nuke Mode Error', `Failed to toggle mode: ${e.message.substring(0, 100)}`)] });
  }
};

/* ============================================================
   Commands: Leveling System (Aesthetic Improvement)
   ============================================================ */

commandsMap['level'] = async (ctx) => {
    const target = ctx.isCommand?.()
      ? (ctx.options.getUser('user') || ctx.user)
      : (ctx.mentions?.users?.first() || ctx.author);

    if (!config[ctx.guild.id]?.levelingEnabled) {
        return respond(ctx, { embeds: [embedInfo('Leveling System', 'Leveling is currently disabled on this server.')] });
    }

    const userData = users[target.id] || { xp: 0, level: 0, warns: [] };
    const currentLevel = userData.level;
    const currentXp = userData.xp;
    const nextLevelXp = xpFormula(currentLevel);
    const xpRemaining = nextLevelXp - currentXp;

    const totalXpGained = Object.values(users).reduce((acc, user) => acc + user.xp + (user.level > 0 ? Array.from({length: user.level}, (_, i) => xpFormula(i)).reduce((a, b) => a + b, 0) : 0), 0);

    const embed = new EmbedBuilder()
        .setTitle(`🌟 Level Status for ${target.tag}`)
        .setThumbnail(target.displayAvatarURL({ size: 256 }))
        .addFields(
            { name: 'Level', value: `**${currentLevel}**`, inline: true },
            { name: 'Current XP', value: `${currentXp} XP`, inline: true },
            { name: 'XP to Next Level', value: `${xpRemaining} XP`, inline: true },
            { name: 'Progress', value: `\`${'█'.repeat(Math.floor((currentXp / nextLevelXp) * 10))} \`${Math.round((currentXp / nextLevelXp) * 100)}%`, inline: false }
        )
        .setFooter({ text: `Next Level: ${currentLevel + 1} | Total XP needed: ${nextLevelXp}`})
        .setColor(EMBED_COLOR_LEVEL)
        .setTimestamp();

    return respond(ctx, { embeds: [embed] });
};


commandsMap['leaderboard'] = async (ctx) => {
    if (!config[ctx.guild.id]?.levelingEnabled) {
        return respond(ctx, { embeds: [embedInfo('Leveling System', 'Leveling is currently disabled on this server.')] });
    }

    // Calculate total XP (current XP + cumulative XP from previous levels) for sorting
    const calculateTotalXP = (data) => {
        let total = data.xp || 0;
        for (let i = 0; i < (data.level || 0); i++) {
            total += xpFormula(i);
        }
        return total;
    }

    // 1. Filter and Sort users by Total XP (desc)
    const leaderboardData = Object.entries(users)
        .map(([id, data]) => ({ id, ...data, totalXP: calculateTotalXP(data) }))
        .filter(entry => ctx.guild.members.cache.has(entry.id)) // Only include members currently in the guild
        .sort((a, b) => b.totalXP - a.totalXP) // Primary sort: Total XP
        .slice(0, 10); // Take top 10

    if (leaderboardData.length === 0) {
        return respond(ctx, { embeds: [embedInfo('Leaderboard', 'No user data recorded yet.')] });
    }

    // 2. Format the leaderboard string
    const description = leaderboardData.map((data, index) => {
        const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : '🔹';
        return `${medal} **#${index + 1}** - <@${data.id}> | **Level ${data.level}** (${data.totalXP} Total XP)`;
    }).join('\n');

    const embed = new EmbedBuilder()
        .setTitle('🏆 Top 10 Server Level Leaders')
        .setDescription(description)
        .setColor(EMBED_COLOR_LEVEL) 
        .setTimestamp();

    return respond(ctx, { embeds: [embed] });
};


commandsMap['enable_leveling'] = async (ctx) => {
    if (!hasManageGuild(ctx)) return respond(ctx, { embeds: [embedError('Permission Denied', 'Need Manage Guild')] });
    const gid = ctx.guild.id;
    ensureGuildConfig(gid);
    config[gid].levelingEnabled = true;
    saveConfig();
    return respond(ctx, { embeds: [embedSuccess('✅ Leveling Enabled', 'The leveling system is now active.')] });
};

commandsMap['disable_leveling'] = async (ctx) => {
    if (!hasManageGuild(ctx)) return respond(ctx, { embeds: [embedError('Permission Denied', 'Need Manage Guild')] });
    const gid = ctx.guild.id;
    ensureGuildConfig(gid);
    config[gid].levelingEnabled = false;
    saveConfig();
    return respond(ctx, { embeds: [embedWarn('🚫 Leveling Disabled', 'The leveling system has been disabled.')] });
};

commandsMap['xpadd'] = async (ctx) => {
    if (!hasManageGuild(ctx)) return respond(ctx, { embeds: [embedError('Permission Denied', 'Need Manage Guild')] });
    const target = ctx.isCommand?.()
      ? ctx.options.getUser('user')
      : (ctx.mentions?.users?.first() || null);
    const amount = ctx.isCommand?.() ? ctx.options.getInteger('amount') : parseInt(ctx.args?.[1] || '0', 10);
    if (!target || isNaN(amount) || amount <= 0) {
        return respond(ctx, { embeds: [embedError('XP Add Error', 'Usage: ..xpadd @user <amount>')] });
    }
    users[target.id] = users[target.id] || { xp: 0, level: 0, warns: [] };
    users[target.id].xp += amount;
    safeWriteJSON(FILES.USERS, users);
    const memberObj = await ctx.guild.members.fetch(target.id);
    checkLevelUp(memberObj, ctx.channel, users[target.id].level, users[target.id].xp);
    return respond(ctx, { embeds: [embedSuccess('✨ XP Added', `Added **${amount}** XP to ${target.tag}.`)] });
};

commandsMap['viewlevel'] = async (ctx) => {
    return commandsMap['level'](ctx);
};



/* ============================================================
   Discord.js Client Setup
   ============================================================ */

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildBans, // needed for antinuke ban tracking
    GatewayIntentBits.GuildIntegrations, // needed for antinuke bot/app additions
    GatewayIntentBits.GuildMessageReactions,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction, Partials.GuildMember, Partials.User],
});

client.commands = new Collection();
client.slashCommands = []; // Array of raw JSON structures for registration


/* ============================================================
   Automod Commands Registration (Example: Antilink)
   ============================================================ */

commandsMap['antilink'] = async (ctx) => {
    if (!hasManageGuild(ctx)) return respond(ctx, { embeds: [embedError('Permission Denied', 'Need Manage Guild')] });
    const gid = ctx.guild.id;
    ensureGuildConfig(gid);
    const action = ctx.isCommand?.() ? ctx.options.getString('action') : ctx.args?.[0];

    if (!action) {
        const status = config[gid].automod.antilink ? '✅ ON' : '❌ OFF';
        return respond(ctx, { embeds: [embedInfo('🔗 Anti-Link Status (Whitelist Active)', `Current Anti-Link status is: **${status}**. Whitelisted domains: ${SAFE_DOMAINS.length}`)] });
    }

    const toggle = action.toLowerCase() === 'on' || action.toLowerCase() === 'true';
    config[gid].automod.antilink = toggle;
    saveConfig();

    const status = toggle ? 'Enabled' : 'Disabled';
    return respond(ctx, { embeds: [embedSuccess('🔗 Anti-Link Toggled', `Anti-Link (Whitelisted mode) has been **${status}**.`)] });
};

// wordfilter command and implementation left as an exercise for the user to match complexity of antilink/nukemode
commandsMap['wordfilter'] = async (ctx) => {
    // Basic placeholder logic
    if (!hasManageGuild(ctx)) return respond(ctx, { embeds: [embedError('Permission Denied', 'Need Manage Guild')] });
    return respond(ctx, { embeds: [embedInfo('🗣️ Word Filter', 'Use `..wordfilter add <word>`, `..wordfilter remove <word>`, or see configuration via the `..enable` menu.')] });
};
// antispam command implementation left as an exercise for the user


/* ============================================================
   Slash Command Builder Registration
   (Ensures prefix and slash parity where possible)
   ============================================================ */

// Build Slash Commands
const slashCommandData = [
    new SlashCommandBuilder().setName('help').setDescription('Shows the bot\'s help menu and command list.'),
    new SlashCommandBuilder().setName('ping').setDescription('Checks the bot\'s latency.'),
    new SlashCommandBuilder().setName('uptime').setDescription('Shows the bot\'s uptime.'),
    new SlashCommandBuilder().setName('prefix').setDescription('View or change the server prefix.').addStringOption(option => 
        option.setName('new_prefix').setDescription('The new prefix to set (max 5 characters).').setRequired(false)
    ),
    new SlashCommandBuilder().setName('clear').setDescription('Bulk delete messages in the channel.').addIntegerOption(option =>
        option.setName('amount').setDescription('Number of messages to delete (1-100).').setRequired(false)
    ),
    new SlashCommandBuilder().setName('kick').setDescription('Kicks a member from the server.').addUserOption(option =>
        option.setName('user').setDescription('The member to kick.').setRequired(true)
    ),
    new SlashCommandBuilder().setName('ban').setDescription('Bans a member from the server.').addUserOption(option =>
        option.setName('user').setDescription('The member to ban.').setRequired(true)
    ).addStringOption(option =>
        option.setName('reason').setDescription('Reason for the ban.').setRequired(false)
    ),
    // Added Tempban and Softban Slash commands
    new SlashCommandBuilder().setName('tempban').setDescription('Temporarily bans a user.').addUserOption(option =>
        option.setName('user').setDescription('The member to tempban.').setRequired(true)
    ).addStringOption(option =>
        option.setName('duration').setDescription('Duration (e.g., 1h, 30m, 5d).').setRequired(true)
    ),
    new SlashCommandBuilder().setName('softban').setDescription('Bans, deletes messages, then unbans a user.').addUserOption(option =>
        option.setName('user').setDescription('The member to softban.').setRequired(true)
    ),
    new SlashCommandBuilder().setName('unban').setDescription('Unbans a user using their ID.').addStringOption(option =>
        option.setName('user_id').setDescription('The ID of the user to unban.').setRequired(true)
    ),
    new SlashCommandBuilder().setName('mute').setDescription('Times out a member for a duration.').addUserOption(option =>
        option.setName('user').setDescription('The member to mute.').setRequired(true)
    ).addStringOption(option =>
        option.setName('duration').setDescription('Duration (e.g., 1h, 30m, 5d).').setRequired(false)
    ).addStringOption(option =>
        option.setName('reason').setDescription('Reason for the mute.').setRequired(false)
    ),
    new SlashCommandBuilder().setName('unmute').setDescription('Removes timeout/mute from a member.').addUserOption(option =>
        option.setName('user').setDescription('The member to unmute.').setRequired(true)
    ),
    new SlashCommandBuilder().setName('warn').setDescription('Warns a user.').addUserOption(option =>
        option.setName('user').setDescription('The member to warn.').setRequired(true)
    ).addStringOption(option =>
        option.setName('reason').setDescription('Reason for the warning.').setRequired(false)
    ),
    new SlashCommandBuilder().setName('warnings').setDescription('View a user\'s warnings.').addUserOption(option =>
        option.setName('user').setDescription('The member to view warnings for.').setRequired(false)
    ),
    new SlashCommandBuilder().setName('nukemode').setDescription('Manually activate or deactivate emergency safe mode.').addStringOption(option =>
        option.setName('action').setDescription('on or off').setRequired(false).addChoices({name: 'on', value: 'on'}, {name: 'off', value: 'off'})
    ),
    new SlashCommandBuilder().setName('antilink').setDescription('Toggle Anti-Link protection.').addStringOption(option =>
        option.setName('action').setDescription('on or off').setRequired(false).addChoices({name: 'on', value: 'on'}, {name: 'off', value: 'off'})
    ),
    new SlashCommandBuilder().setName('setmodlog').setDescription('Set the channel for moderation action logging.').addChannelOption(option =>
        option.setName('channel').setDescription('The channel to log mod actions to (leave blank to disable).').setRequired(false).addChannelTypes(ChannelType.GuildText)
    ),
    new SlashCommandBuilder().setName('level').setDescription('Check your current level and XP.').addUserOption(option =>
        option.setName('user').setDescription('The member to check the level for.').setRequired(false)
    ),
    new SlashCommandBuilder().setName('leaderboard').setDescription('Shows the server\'s top 10 leveled members.'),
    new SlashCommandBuilder().setName('enable').setDescription('View or toggle various security settings.'),
];

client.slashCommands = slashCommandData.map(command => command.toJSON());

/**
 * FIX: Deploys commands **globally** AND **to the GUILD_ID** for testing.
 */
async function registerSlashCommands() {
  const rest = new REST({ version: '10' }).setToken(TOKEN);
  try {
    // 1. Always deploy globally (for use on all servers)
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: client.slashCommands });
    log('Registered GLOBAL slash commands (may take up to an hour to propagate)');

    // 2. Also deploy to the development/testing guild ID for immediate availability
    if (GUILD_ID) {
      await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: client.slashCommands });
      log('Slash commands registered globally', GUILD_ID);
    }
  } catch (e) {
    console.error('Failed to register slash commands', e);
  }
}


/* ============================================================
   Client Event Handlers
   ============================================================ */

client.on('ready', () => {
    log(`Logged in as ${client.user.tag}!`);

    // Presence rotation logic
    let activityIndex = 0;

    const updatePresence = () => {
        const presence = PRESENCES[activityIndex];

        // Construct the activities array based on the activity type
        const activities = [{
            name: presence.name,
            type: presence.type
        }];

        // Add URL if the activity type is Streaming
        if (presence.type === ActivityType.Streaming) {
            activities[0].url = presence.url;
        }

        client.user.setPresence({
            activities: activities,
            status: presence.status,
        });

        // Move to the next activity, looping back to 0
        activityIndex = (activityIndex + 1) % PRESENCES.length;
    };

    // Set initial presence immediately
    updatePresence();

    // Rotate presence every 7 seconds (7000ms)
    setInterval(updatePresence, 7000);

    registerSlashCommands().catch(e => console.error('Failed to register commands on ready', e));
});

client.on('interactionCreate', async interaction => {
  if (!interaction.guild) return;

  // Handle Slash Commands
  if (interaction.isCommand()) {
    const ctx = buildCtxFromInteraction(interaction);
    const commandName = ctx.commandName;
    const normalizedKey = normalizeCommandKey(commandName);
    const handler = commandsMap[normalizedKey];

    if (handler) {
      try {
        await handler(ctx);
      } catch (e) {
        console.error(`Command ${commandName} failed:`, e);
        const errorEmbed = embedError('Command Error', 'An unexpected error occurred while running this command.');
        if (interaction.deferred || interaction.replied) {
          interaction.editReply({ embeds: [errorEmbed], ephemeral: true }).catch(()=>{});
        } else {
          interaction.reply({ embeds: [errorEmbed], ephemeral: true }).catch(()=>{});
        }
      }
      return;
    }
  }

  // Handle Select Menus (Security Fix)
  if (interaction.isStringSelectMenu()) {
    if (interaction.customId === 'enable_menu') {
        if (!hasManageGuild(interaction)) {
            return interaction.reply({ embeds: [embedError('Permission Denied', 'Need Manage Guild')], ephemeral: true });
        }

        // Defer update to show 'thinking' state as we process the request
        if (!interaction.deferred && !interaction.replied) await interaction.deferUpdate().catch(()=>{});

        const [selectedValue] = interaction.values;
        const gid = interaction.guild.id;
        ensureGuildConfig(gid);
        let status;
        let settingName;
        let requiresManualCheck = false;

        switch (selectedValue) {
            case 'anti_link':
                config[gid].automod.antilink = !config[gid].automod.antilink;
                status = config[gid].automod.antilink ? 'Enabled' : 'Disabled';
                settingName = 'Anti-Link';
                break;
            case 'word_filter':
                config[gid].automod.wordfilter.enabled = !config[gid].automod.wordfilter.enabled;
                status = config[gid].automod.wordfilter.enabled ? 'Enabled' : 'Disabled';
                settingName = 'Word Filter';
                break;
            case 'nuke_mode':
                // Nuke mode toggle should call the manual commands for proper setup/cleanup logic
                if (config[gid].nukemode) {
                    await deactivateSafeMode(interaction.guild);
                } else {
                    await activateSafeMode(interaction.guild);
                }
                status = config[gid].nukemode ? 'Activated' : 'Deactivated';
                settingName = 'Nuke Mode';
                requiresManualCheck = true;
                break;
            case 'raid_mode':
                // Use Antispam as a toggle for "Raid Mode" proxy
                config[gid].automod.antispam.enabled = !config[gid].automod.antispam.enabled;
                status = config[gid].automod.antispam.enabled ? 'Enabled (Antispam Proxy)' : 'Disabled';
                settingName = 'Raid Mode (Antispam)';
                break;
            case 'leveling_system':
                config[gid].levelingEnabled = !config[gid].levelingEnabled;
                status = config[gid].levelingEnabled ? 'Enabled' : 'Disabled';
                settingName = 'Leveling System';
                break;
            default:
                // For security settings that require more complex sub-commands (like whitelisting)
                return interaction.editReply({ 
                    embeds: [embedWarn('Configuration Required', `The security setting **${selectedValue.replace(/_/g, ' ').toUpperCase()}** toggled **monitored**. Use specific commands (like \`..wordfilter\`) to manage details like whitelists.`)], 
                    components: interaction.message.components,
                    ephemeral: true 
                });
        }

        saveConfig();
        const embed = requiresManualCheck 
            ? embedSuccess('✅ Nuke Mode Toggled', `**${settingName}** has been **${status}**. Check the dedicated \`..nukemode\` command for full status.`)
            : embedSuccess('✅ Setting Toggled', `**${settingName}** has been **${status}**. Config saved.`);


        // Update the original message to reflect the change and remove the selector
        return interaction.editReply({ embeds: [embed], components: [] , ephemeral: true }).catch(()=>{
            // fallback if edit fails
            return interaction.followUp({ embeds: [embed], ephemeral: true });
        });
    }
  }


  if (interaction.isButton()) {
    // Handle button interactions here if needed
  }

  // Handle Modal Submits here if needed
  if (interaction.isModalSubmit()) {
    // Handle modal submits here
  }
});


client.on('messageCreate', async message => {
  if (message.author.bot || !message.guild) return;
  const gid = message.guild.id;
  ensureGuildConfig(gid);
  const guildConfig = config[gid];
  const prefix = guildConfig.prefix;

  // 1. Prefix Command Handler (Always available in all guilds)
  if (message.content.startsWith(prefix)) {
    const args = message.content.slice(prefix.length).trim().split(/ +/);
    const commandName = args.shift()?.toLowerCase();
    const normalizedKey = normalizeCommandKey(commandName);
    const handler = commandsMap[normalizedKey];

    if (handler) {
      // Attach args to message object for handler use
      message.args = args;
      const ctx = buildCtxFromMessage(message);
      try {
        await handler(ctx);
      } catch (e) {
        console.error(`Prefix command ${commandName} failed:`, e);
        respond(message, { embeds: [embedError('Command Error', 'An unexpected error occurred while running this command.')] }).catch(()=>{});
      }
      return;
    }
  }

  // 2. Automod: Anti-Link Check (Enhanced with Whitelist)
  if (guildConfig.automod.antilink) {
    // Basic regex to find URLs (http/https not required for parsing later)
    const urlRegex = /(https?:\/\/(?:www\.|(?!www))[a-zA-Z0-9][a-zA-Z0-9-]+[a-zA-Z0-9]\.[^\s]{2,}|www\.[a-zA-Z0-9][a-zA-Z0-9-]+[a-zA-Z0-9]\.[^\s]{2,}|https?:\/\/(?:www\.|(?!www))[a-zA-Z0-9]+\.[^\s]{2,}|www\.[a-zA-Z0-9]+\.[^\s]{2,})/gi;
    const links = message.content.match(urlRegex);

    if (links && links.length > 0) {
        let isSuspicious = false;
        for (const link of links) {
            try {
                let url;
                // Prepend http:// for parsing if protocol is missing
                const formattedLink = link.startsWith('http') ? link : 'http://' + link;
                url = new URL(formattedLink);

                let hostname = url.hostname.toLowerCase();
                // Remove www. prefix if present
                if (hostname.startsWith('www.')) {
                    hostname = hostname.substring(4);
                }

                // Check if the link's hostname or any of its subdomains is in the SAFE_DOMAINS list
                const isSafe = SAFE_DOMAINS.some(safeDomain => hostname === safeDomain || hostname.endsWith('.' + safeDomain));

                if (!isSafe) {
                    isSuspicious = true;
                    break;
                }
            } catch (e) {
                // If link cannot be parsed (e.g., highly obfuscated/malformed), treat as suspicious
                isSuspicious = true; 
                break;
            }
        }

        if (isSuspicious) {
            await message.delete().catch(()=>{});
            const warning = await message.channel.send({ embeds: [embedWarn('🔗 Suspicious Link Blocked', `<@${message.author.id}>: Only links from approved services are allowed. Suspicious link blocked.`)] }).catch(()=>{});
            if (warning) setTimeout(() => warning.delete().catch(()=>{}), 5000); // Auto-delete warning
            return;
        }
    }
  }

  // 3. Automod: Word Filter Check (Basic Check)
  if (guildConfig.automod.wordfilter.enabled && guildConfig.automod.wordfilter.bannedWords.length > 0) {
      const contentLower = message.content.toLowerCase();
      const hasBannedWord = guildConfig.automod.wordfilter.bannedWords.some(word => contentLower.includes(word.toLowerCase()));

      if (hasBannedWord) {
          await message.delete().catch(()=>{});
          const warning = await message.channel.send({ embeds: [embedWarn('🗣️ Word Filter Blocked', `<@${message.author.id}>: Your message contained a filtered word.`)].catch(()=>{}) });
          if (warning) setTimeout(() => warning.delete().catch(()=>{}), 5000);
          return;
      }
  }


  // 4. Automod: Anti-Spam Check
  if (guildConfig.automod.antispam.enabled) {
    const count = recordMessageForSpam(gid, message.author.id);
    if (count > guildConfig.automod.antispam.max) {
        // Punish spammers: delete and optionally mute/timeout
        await message.delete().catch(()=>{});
        const member = message.member;
        if (member && member.moderatable && !member.communicationDisabledUntil) {
            // Apply a short timeout (e.g., 5 minutes)
            await member.timeout(5 * 60 * 1000, 'Automatic antispam timeout').catch(()=>{});
            const timeoutWarning = await message.channel.send({ embeds: [embedWarn('🚫 Spam Detected', `<@${message.author.id}> has been timed out for 5 minutes for spamming.`)] }).catch(()=>{});
            if (timeoutWarning) setTimeout(() => timeoutWarning.delete().catch(()=>{}), 5000);
        }
        return;
    }
  }

  // 5. Leveling System
  if (guildConfig.levelingEnabled) {
    const userId = message.author.id;
    const now = Date.now();

    if (!lastXp.has(userId) || now - lastXp.get(userId) > XP_COOLDOWN_MS) {
        // 15 to 25 XP per message
        const xpGain = Math.floor(Math.random() * (25 - 15 + 1)) + 15;

        users[userId] = users[userId] || { xp: 0, level: 0, warns: [] };
        users[userId].xp += xpGain;
        lastXp.set(userId, now);

        // Check for level up
        checkLevelUp(message.member, message.channel, users[userId].level, users[userId].xp);
    }
  }

  // Note: users data is saved inside checkLevelUp for leveling, and explicitly in warn.
});

// Guild Events for Anti-Nuke Detection
client.on('channelDelete', channel => {
    if (!channel.guild) return;
    recordEvent('channelDeletes', { guildId: channel.guild.id, channelId: channel.id });
    if (checkForNuke(channel.guild.id) && config[channel.guild.id]?.nukemode !== true) {
        activateSafeMode(channel.guild).catch(e => console.error('Failed to auto-activate safe mode on channel delete:', e));
    }
});

client.on('roleDelete', role => {
    if (!role.guild) return;
    recordEvent('roleDeletes', { guildId: role.guild.id, roleId: role.id });
    if (checkForNuke(role.guild.id) && config[role.guild.id]?.nukemode !== true) {
        activateSafeMode(role.guild).catch(e => console.error('Failed to auto-activate safe mode on role delete:', e));
    }
});

client.on('guildBanAdd', ban => {
    if (!ban.guild) return;
    recordEvent('bans', { guildId: ban.guild.id, userId: ban.user.id });
    if (checkForNuke(ban.guild.id) && config[ban.guild.id]?.nukemode !== true) {
        activateSafeMode(ban.guild).catch(e => console.error('Failed to auto-activate safe mode on ban:', e));
    }
});

// Guild Leave/Delete: Clean up configuration
client.on('guildDelete', guild => {
    if (!guild || !guild.id) return;
    if (config[guild.id]) {
        delete config[guild.id];
        saveConfig();
        log(`Cleaned config for departed guild: ${guild.id}`);
    }
});


/* ============================================================
   Login
   ============================================================ */

if (!TOKEN || TOKEN.startsWith('YOUR')) {
  console.error('TOKEN is not set. Please set TOKEN environment variable.');
  process.exit(1);
}

// FIX: Client login is now correctly at the end after client definition
client.login(TOKEN).catch(e => {
  console.error('Failed to login', e);
  process.exit(1);
});

/* ============================================================
   Notes and TODOs (administration)
   - This file is intentionally extensive; production tweaks:
 * - Persist safe-mode role permission backups to restore after nukemode
 * - Use a job scheduler or database for tempban unbans (current setTimeout lost on restart)
 * - Add more robust command argument parsing and slash subcommands
 * - Integrate with external services (image generation, meme APIs, translation)
 * - Add comprehensive unit tests where possible
 * - **Remember to replace 'YOUR_BOT_TOKEN' and 'YOUR_CLIENT_ID' placeholders.**
   ============================================================ */

/* ============================================================
   End of file
   ============================================================ */
// === New Leveling Commands ===
commandsMap['xp'] = async (ctx) => {
    const target = ctx.isCommand?.()
      ? (ctx.options.getUser('user') || ctx.user)
      : (ctx.mentions?.users?.first() || ctx.author);
    const gid = ctx.guild.id;
    ensureGuildConfig(gid);
    if (!config[gid].levelingEnabled) {
        return respond(ctx, { embeds: [embedInfo('Leveling Disabled', 'Leveling system is disabled on this server.')] });
    }
    const userData = users[target.id] || { xp: 0, level: 0 };
    const embed = new EmbedBuilder()
      .setTitle(`📊 XP for ${target.tag}`)
      .setDescription(`Level: **${userData.level}**\nXP: **${userData.xp}** / ${xpFormula(userData.level)} for next level`)
      .setColor(EMBED_COLOR_LEVEL);
    return respond(ctx, { embeds: [embed] });
};

commandsMap['enable_leveling'] = async (ctx) => {
    if (!hasManageGuild(ctx)) return respond(ctx, { embeds: [embedError('Permission Denied', 'Need Manage Guild')] });
    const gid = ctx.guild.id;
    ensureGuildConfig(gid);
    config[gid].levelingEnabled = true;
    saveConfig();
    return respond(ctx, { embeds: [embedSuccess('✅ Leveling Enabled', 'The leveling system is now active.')] });
};

commandsMap['disable_leveling'] = async (ctx) => {
    if (!hasManageGuild(ctx)) return respond(ctx, { embeds: [embedError('Permission Denied', 'Need Manage Guild')] });
    const gid = ctx.guild.id;
    ensureGuildConfig(gid);
    config[gid].levelingEnabled = false;
    saveConfig();
    return respond(ctx, { embeds: [embedWarn('🚫 Leveling Disabled', 'The leveling system has been disabled.')] });
};

