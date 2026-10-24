# Najwa AI privacy policy

*Last updated: 24 October 2026*

Najwa AI, by Bandar Altariqi, is a chat app that keeps your data on your own devices. Najwa AI has no servers and does not collect, sell or share any personal data.

## What stays on your device

Your chats, assistants, memory, settings, and any API keys or connector tokens you enter are stored only on your device. On desktop, keys and tokens are encrypted with your system's keychain when one is available. Keys and connector tokens are never synced.

## AI models you choose

When you send a message, it goes only to the model you picked:

- **On-device models** run entirely on your phone or computer. Nothing leaves your device.
- **Your own servers** (Ollama, LM Studio and similar) receive your messages directly from the app.
- **Cloud models** (Anthropic, OpenAI) receive your messages directly from the app, using your own API key. Their privacy policies apply.
- **Your Hermes Agent** receives your messages directly from the app, on the server where you run it.
- **Your computer's models, from your phone** ("On your computer"): your messages go from your phone to your own computer over an encrypted connection that only your devices can use, and from there to the model you picked.

## Links, the web and connectors (optional)

These can be turned off in **Settings → General** (Read links, the browser) and **Settings → Connectors**.

- **Read links:** when your message contains a link, your device opens that page itself, like a browser would, and gives its text to the model. The website sees an ordinary visit from your device.
- **A browser for your AI:** models that can use tools may search the web and open pages while answering. Searches go to DuckDuckGo. Pages are opened by your device in a private browser inside Najwa AI, separate from your own browser and without your logins. What to search for and open is decided by the model, based on your conversation.
- **Connectors** (such as GitHub): when you add one, the model can send requests to that service from your device, with the token you gave it. That service's privacy policy applies. Anything that changes something there waits for your approval first.

## Sync (optional)

If you turn on sync, your chats, assistants and memory are copied to storage **you** own:

- **Google Drive**: a hidden app folder in your Drive. Najwa AI asks only for the `drive.appdata` permission, so it can use its own folder and cannot see any of your other files.
- **GitHub**: a private repository you create.

Before anything is uploaded, it is encrypted on your device with a key made from your sync passphrase (AES-256-GCM). Google and GitHub store only encrypted data and cannot read your chats. Najwa AI's author has no access to it either.

Najwa AI uses Google user data only to store and read back your own encrypted sync files. It does not transfer Google user data to anyone else, use it for advertising, or let people read it. Its use of data from Google APIs follows the [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy), including the Limited Use requirements.

To stop syncing, open **Settings → Sync → Stop syncing**. For Google Drive, this also removes Najwa AI's access to your Google account. You can remove the stored sync data at any time: in Google Drive, go to **Settings → Manage apps → Najwa AI → Delete hidden app data**, or delete your GitHub repository.

## Contact

Questions: https://github.com/bandar9994

This policy is also published at https://bandar9994.github.io/privacy.html.
