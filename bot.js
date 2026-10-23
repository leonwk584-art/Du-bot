require("dotenv").config();

const fs = require("node:fs");
const path = require("node:path");
const {
  Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder,
  EmbedBuilder, PermissionFlagsBits
} = require("discord.js");
const { google } = require("googleapis");

const required = ["DISCORD_TOKEN", "DISCORD_CLIENT_ID", "YOUTUBE_API_KEY"];
for (const key of required) {
  if (!process.env[key]) {
    console.error(`Fehlende Umgebungsvariable: ${key}. Bitte .env aus .env.example erstellen und ausfüllen.`);
    process.exit(1);
  }
}
const youtube = google.youtube({ version: "v3", auth: process.env.YOUTUBE_API_KEY });
const DATA_FILE = path.join(__dirname, "data.json");
const pollMinutes = Math.max(1, Number.parseInt(process.env.POLL_INTERVAL_MINUTES || "2", 10) || 2);

function loadData() {
  try {
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    if (!parsed.channels) parsed.channels = [];
    return parsed;
  } catch {
    return { channels: [] };
  }
}
let data = loadData();
function saveData() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), "utf8");
}
function isAdmin(interaction) {
  return interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ||
    interaction.memberPermissions?.has(PermissionFlagsBits.Administrator);
}
function extractHandleOrId(input) {
  const s = input.trim();
  const channelId = s.match(/youtube\.com\/channel\/(UC[\w-]+)/i);
  if (channelId) return { id: channelId[1] };
  const handle = s.match(/youtube\.com\/@([A-Za-z0-9._-]+)/i);
  if (handle) return { handle: handle[1] };
  const username = s.match(/youtube\.com\/user\/([A-Za-z0-9._-]+)/i);
  if (username) return { username: username[1] };
  if (/^UC[\w-]{20,}$/.test(s)) return { id: s };
  if (/^@?[A-Za-z0-9._-]+$/.test(s)) return { handle: s.replace(/^@/, "") };
  throw new Error("Link nicht erkannt. Nutze einen YouTube-Kanal-Link, z. B. https://www.youtube.com/@Kanalname");
}
async function resolveChannel(input) {
  const spec = extractHandleOrId(input);
  let response;
  if (spec.id) {
    response = await youtube.channels.list({ part: ["snippet", "contentDetails"], id: [spec.id], maxResults: 1 });
  } else if (spec.handle) {
    response = await youtube.channels.list({ part: ["snippet", "contentDetails"], forHandle: spec.handle, maxResults: 1 });
  } else {
    response = await youtube.channels.list({ part: ["snippet", "contentDetails"], forUsername: spec.username, maxResults: 1 });
  }
  const ch = response.data.items?.[0];
  if (!ch) throw new Error("YouTube-Kanal nicht gefunden. Prüfe den Link und deinen YouTube-API-Key.");
  return {
    id: ch.id,
    title: ch.snippet.title,
    url: `https://www.youtube.com/channel/${ch.id}`,
    uploadsPlaylistId: ch.contentDetails.relatedPlaylists.uploads
  };
}
const commands = [
  new SlashCommandBuilder()
    .setName("youtube-add")
    .setDescription("YouTube-Kanal abonnieren und neue Videos automatisch posten")
    .addStringOption(o => o.setName("link").setDescription("YouTube-Kanal-Link oder @Handle").setRequired(true))
    .addChannelOption(o => o.setName("zielkanal").setDescription("Discord-Kanal für Video-Meldungen").setRequired(true))
    .setDMPermission(false),
  new SlashCommandBuilder().setName("youtube-list").setDescription("Alle überwachten YouTube-Kanäle anzeigen").setDMPermission(false),
  new SlashCommandBuilder()
    .setName("send")
    .setDescription("Das neueste Video eines überwachten YouTube-Kanals sofort ankündigen")
    .addStringOption(o => o.setName("kanal").setDescription("YouTube-Kanalname oder Kanal-ID").setRequired(true))
    .setDMPermission(false),
  new SlashCommandBuilder()
    .setName("youtube-remove")
    .setDescription("Einen überwachten YouTube-Kanal entfernen")
    .addStringOption(o => o.setName("kanal").setDescription("Kanal-ID oder exakter YouTube-Kanalname").setRequired(true))
    .setDMPermission(false)
].map(c => c.toJSON());

async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);
  const appId = process.env.DISCORD_CLIENT_ID;
  if (process.env.DISCORD_GUILD_ID) {
    await rest.put(Routes.applicationGuildCommands(appId, process.env.DISCORD_GUILD_ID), { body: commands });
    console.log("Slash-Commands für Testserver registriert.");
  } else {
    await rest.put(Routes.applicationCommands(appId), { body: commands });
    console.log("Globale Slash-Commands registriert. Die Anzeige kann etwas dauern.");
  }
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once("ready", () => {
  console.log(`Eingeloggt als ${client.user.tag}`);
  pollAll().catch(console.error);
  setInterval(() => pollAll().catch(err => console.error("YouTube-Abfrage fehlgeschlagen:", err.message)), pollMinutes * 60 * 1000);
});

client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;
  try {
    if (interaction.commandName === "youtube-add") {
      if (!isAdmin(interaction)) return interaction.reply({ content: "Dafür brauchst du die Berechtigung **Server verwalten** oder **Administrator**.", ephemeral: true });
      await interaction.deferReply({ ephemeral: true });
      const input = interaction.options.getString("link", true);
      const target = interaction.options.getChannel("zielkanal", true);
      if (!target.isTextBased() || !target.guild) {
        return interaction.editReply("Bitte wähle einen Textkanal auf diesem Discord-Server.");
      }
      const channel = await resolveChannel(input);
      const duplicate = data.channels.find(x => x.guildId === interaction.guildId && x.youtubeChannelId === channel.id);
      if (duplicate) {
        duplicate.discordChannelId = target.id;
        saveData();
        return interaction.editReply(`**${channel.title}** wird bereits überwacht. Zielkanal wurde auf ${target} geändert.`);
      }
      // Beim Hinzufügen wird das neueste Video als Startpunkt gespeichert, damit keine alten Videos gespammt werden.
      const latest = await getLatestVideo(channel.uploadsPlaylistId);
      data.channels.push({
        guildId: interaction.guildId,
        youtubeChannelId: channel.id,
        youtubeTitle: channel.title,
        youtubeUrl: channel.url,
        inputAlias: input.trim(),
        uploadsPlaylistId: channel.uploadsPlaylistId,
        discordChannelId: target.id,
        lastVideoId: latest?.id || null
      });
      saveData();
      return interaction.editReply(`✅ **${channel.title}** wurde hinzugefügt. Neue Videos werden in ${target} gepostet. Bereits veröffentlichte Videos werden nicht nachträglich gesendet.`);
    }
    if (interaction.commandName === "youtube-list") {
      const entries = data.channels.filter(x => x.guildId === interaction.guildId);
      if (!entries.length) return interaction.reply({ content: "Es werden noch keine YouTube-Kanäle überwacht. Nutze `/youtube-add`.", ephemeral: true });
      const lines = entries.map(x => `• **${x.youtubeTitle}** — <#${x.discordChannelId}>\n  ${x.youtubeUrl}`);
      return interaction.reply({ content: lines.join("\n").slice(0, 1900), ephemeral: true });
    }
    if (interaction.commandName === "send") {
      if (!isAdmin(interaction)) return interaction.reply({ content: "Dafür brauchst du die Berechtigung **Server verwalten** oder **Administrator**.", ephemeral: true });
      await interaction.deferReply({ ephemeral: true });
      const query = interaction.options.getString("kanal", true).trim().toLowerCase();
      const entry = data.channels.find(x => x.guildId === interaction.guildId &&
        (x.youtubeChannelId.toLowerCase() === query || x.youtubeTitle.toLowerCase() === query ||
         x.youtubeUrl.toLowerCase() === query || (x.inputAlias || "").toLowerCase() === query ||
         (x.inputAlias || "").toLowerCase().replace(/^https?:\/\/(www\.)?youtube\.com\//, "").replace(/^@/, "") === query.replace(/^@/, "")));
      if (!entry) return interaction.editReply("Kanal nicht gefunden. Füge ihn zuerst mit `/youtube-add` hinzu oder nutze den exakten Namen aus `/youtube-list`.");
      const latest = await getLatestVideo(entry.uploadsPlaylistId);
      if (!latest) return interaction.editReply("Für diesen YouTube-Kanal wurde kein Video gefunden.");
      const guild = await client.guilds.fetch(entry.guildId);
      const target = await guild.channels.fetch(entry.discordChannelId).catch(() => null);
      if (!target?.isTextBased()) return interaction.editReply("Der gespeicherte Zielkanal ist nicht verfügbar. Füge den Kanal mit `/youtube-add` erneut hinzu.");
      const embed = new EmbedBuilder()
        .setColor(0xFF0000)
        .setAuthor({ name: entry.youtubeTitle, url: entry.youtubeUrl })
        .setTitle(latest.title.slice(0, 256))
        .setURL(`https://www.youtube.com/watch?v=${latest.id}`)
        .setDescription("📺 Neues Video auf YouTube!")
        .setTimestamp(latest.publishedAt ? new Date(latest.publishedAt) : new Date());
      if (latest.thumbnail) embed.setThumbnail(latest.thumbnail);
      await target.send({ content: `@everyone 🔔 **Neues Video von ${entry.youtubeTitle}!**`, embeds: [embed], allowedMentions: { parse: ["everyone"] } });
      entry.lastVideoId = latest.id;
      saveData();
      return interaction.editReply(`✅ Die Video-Ankündigung wurde in ${target} gesendet.`);
    }
    if (interaction.commandName === "youtube-remove") {
      if (!isAdmin(interaction)) return interaction.reply({ content: "Dafür brauchst du die Berechtigung **Server verwalten** oder **Administrator**.", ephemeral: true });
      const query = interaction.options.getString("kanal", true).trim().toLowerCase();
      const index = data.channels.findIndex(x => x.guildId === interaction.guildId &&
        (x.youtubeChannelId.toLowerCase() === query || x.youtubeTitle.toLowerCase() === query));
      if (index < 0) return interaction.reply({ content: "Kein passender Kanal gefunden. Nutze `/youtube-list` für die Namen.", ephemeral: true });
      const [removed] = data.channels.splice(index, 1);
      saveData();
      return interaction.reply({ content: `🗑️ **${removed.youtubeTitle}** wird nicht mehr überwacht.`, ephemeral: true });
    }
  } catch (err) {
    console.error(err);
    const message = `Fehler: ${err.message || "Unbekannter Fehler"}`;
    if (interaction.deferred || interaction.replied) await interaction.editReply(message).catch(() => {});
    else await interaction.reply({ content: message, ephemeral: true }).catch(() => {});
  }
});

async function getLatestVideo(playlistId) {
  const result = await youtube.playlistItems.list({
    part: ["snippet", "contentDetails"], playlistId, maxResults: 1
  });
  const item = result.data.items?.[0];
  if (!item) return null;
  const videoId = item.contentDetails?.videoId;
  return videoId ? {
    id: videoId,
    title: item.snippet?.title || "Neues YouTube-Video",
    publishedAt: item.contentDetails?.videoPublishedAt || item.snippet?.publishedAt,
    thumbnail: item.snippet?.thumbnails?.high?.url || item.snippet?.thumbnails?.medium?.url
  } : null;
}

async function pollAll() {
  for (const entry of [...data.channels]) {
    try {
      const latest = await getLatestVideo(entry.uploadsPlaylistId);
      if (!latest) continue;
      if (!entry.lastVideoId) {
        entry.lastVideoId = latest.id;
        saveData();
        continue;
      }
      if (latest.id === entry.lastVideoId) continue;

      // Hol mehrere neue Uploads nach und poste chronologisch, sofern sie in der Playlist stehen.
      const response = await youtube.playlistItems.list({
        part: ["snippet", "contentDetails"],
        playlistId: entry.uploadsPlaylistId,
        maxResults: 10
      });
      const items = (response.data.items || []).map(item => ({
        id: item.contentDetails?.videoId,
        title: item.snippet?.title || "Neues YouTube-Video",
        publishedAt: item.contentDetails?.videoPublishedAt || item.snippet?.publishedAt,
        thumbnail: item.snippet?.thumbnails?.high?.url || item.snippet?.thumbnails?.medium?.url
      })).filter(v => v.id);
      const oldIndex = items.findIndex(v => v.id === entry.lastVideoId);
      const newVideos = (oldIndex >= 0 ? items.slice(0, oldIndex) : items.filter(v => v.id !== entry.lastVideoId)).reverse();
      const guild = await client.guilds.fetch(entry.guildId).catch(() => null);
      const target = guild ? await guild.channels.fetch(entry.discordChannelId).catch(() => null) : null;
      if (target?.isTextBased()) {
        for (const video of newVideos) {
          const embed = new EmbedBuilder()
            .setColor(0xFF0000)
            .setAuthor({ name: entry.youtubeTitle, url: entry.youtubeUrl })
            .setTitle(video.title.slice(0, 256))
            .setURL(`https://www.youtube.com/watch?v=${video.id}`)
            .setDescription("📺 Ein neues Video ist online!")
            .setTimestamp(video.publishedAt ? new Date(video.publishedAt) : new Date());
          if (video.thumbnail) embed.setThumbnail(video.thumbnail);
          await target.send({ content: `@everyone 🔔 **Neues Video von ${entry.youtubeTitle}!**`, embeds: [embed], allowedMentions: { parse: ["everyone"] } });
        }
      }
      entry.lastVideoId = latest.id;
      saveData();
    } catch (err) {
      console.error(`Fehler bei ${entry.youtubeTitle}:`, err.message || err);
    }
  }
}

(async () => {
  try {
    await registerCommands();
    await client.login(process.env.DISCORD_TOKEN);
  } catch (err) {
    console.error("Bot konnte nicht starten:", err);
    process.exit(1);
  }
})();
