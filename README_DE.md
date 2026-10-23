# YouTube-Neue-Videos-Bot für Discord

Dieser Discord-Bot überwacht YouTube-Kanäle und postet neue Uploads automatisch in einen ausgewählten Discord-Textkanal. Bei jeder neuen Video-Ankündigung sendet er außerdem `@everyone` (die Rolle muss in Discord erwähnbar sein und Bot-Berechtigungen müssen stimmen). Er unterstützt Kanal-Links wie `https://www.youtube.com/@Kanalname` sowie klassische `/channel/UC...`-Links.

## Voraussetzungen

- Node.js 18.17 oder neuer
- Ein Discord-Bot über das Discord Developer Portal
- Ein YouTube Data API v3 API-Key aus der Google Cloud Console

## 1. Discord-Bot anlegen

1. Öffne https://discord.com/developers/applications und erstelle eine Application.
2. Unter **Bot** den Bot erstellen und den Token kopieren. Den Token niemals teilen oder in Screenshots zeigen.
3. Unter **OAuth2 → URL Generator** die Scopes `bot` und `applications.commands` auswählen.
4. Bot-Berechtigungen: **View Channels**, **Send Messages**, **Embed Links**. Lade ihn über die generierte URL auf deinen Server ein.
5. Kopiere die **Application ID** aus **General Information**.

## 2. YouTube API-Key erstellen

1. Öffne https://console.cloud.google.com/.
2. Erstelle ein Projekt und aktiviere **YouTube Data API v3**.
3. Erstelle unter **APIs & Services → Credentials** einen API-Key.
4. Halte den Key privat und setze möglichst passende API-Beschränkungen.

## 3. Bot konfigurieren

1. Entpacke die ZIP-Datei.
2. Kopiere `.env.example` zu `.env`.
3. Trage `DISCORD_TOKEN`, `DISCORD_CLIENT_ID` und `YOUTUBE_API_KEY` ein.
4. Optional: Trage die Discord-Server-ID in `DISCORD_GUILD_ID` ein. Dann werden die Slash-Commands direkt auf diesem Server registriert. Ohne Server-ID werden globale Commands verwendet, deren Anzeige etwas dauern kann.

## 4. Starten

Öffne im Ordner ein Terminal und führe aus:

```bash
npm install
npm start
```

Lass den Prozess laufen oder hoste ihn auf einem dauerhaft laufenden Server. Wenn der Bot offline ist, kann er keine neuen Videos posten. Die überwachten Kanäle werden in `data.json` gespeichert.

## Befehle

- `/youtube-add link:<YouTube-Kanal-Link> zielkanal:<Discord-Textkanal>` – Kanal überwachen.
- `/youtube-list` – überwachte Kanäle anzeigen.
- `/send kanal:<Kanalname>` – das neueste Video sofort mit `@everyone` im eingerichteten Zielkanal ankündigen.
- `/youtube-remove kanal:<Kanalname oder Kanal-ID>` – Überwachung entfernen.

Der Bot kündigt neue Videos mit `@everyone` an. Stelle in Discord sicher, dass der Bot **Mention @everyone, @here, and All Roles** verwenden darf. Discord-Servereinstellungen können Erwähnungen zusätzlich einschränken.

Nur Mitglieder mit **Server verwalten** oder **Administrator** dürfen Kanäle hinzufügen oder entfernen.

## Verhalten / Hinweise

- Beim Hinzufügen wird das aktuell neueste Video als Startpunkt gespeichert. Alte Videos werden dadurch nicht sofort gepostet.
- Standardmäßig prüft der Bot alle 2 Minuten (`POLL_INTERVAL_MINUTES=2`).
- Die YouTube Data API hat Quotenlimits. Wenn du viele Kanäle überwachst, erhöhe das Intervall und kontrolliere deine API-Quote.
- Wenn mehrere Videos zwischen zwei Prüfungen veröffentlicht werden, versucht der Bot die letzten 10 Uploads nachzuholen.
- Dies ist ein fertiges Grundprojekt, aber vor dem öffentlichen Einsatz solltest du es auf deinem Server testen und Logs beobachten.
