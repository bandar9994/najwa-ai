# Najwa AI privacy policy

*Last updated: 28 October 2026*

Najwa AI, by Bandar Altariqi, is a chat app that keeps your data on your own devices. Najwa AI has no servers and does not collect, sell or share any personal data.

**Who it is for:** Najwa AI is intended for people aged 18 and over. It is not directed at children, and it should not be used by anyone under 18.

## What stays on your device

Your chats, assistants, memory, settings, and any API keys or connector tokens you enter are stored only on your device. On desktop, keys and tokens are encrypted with your system's keychain when one is available. Keys and connector tokens are never synced.

## AI models you choose

When you send a message, it goes only to the model you picked:

- **On-device models** run entirely on your phone or computer. Nothing leaves your device.
- **Your own servers** (Ollama, LM Studio and similar) receive your messages directly from the app.
- **Cloud models** (Anthropic, OpenAI) receive your messages directly from the app, using your own API key. Their privacy policies apply.
- **Your Hermes Agent** receives your messages directly from the app, on the server where you run it.
- **Your computer's models, from your phone** ("On your computer"): your messages go from your phone to your own computer over an encrypted connection that only your devices can use, and from there to the model you picked.

## Voice (optional)

Voice is off until you tap the microphone in the message box, or turn on **Read replies aloud** in **Settings → Voice**. The microphone is used only while you are talking to Najwa AI, and what you say is written into the message box so you can check it before sending. Najwa AI does not save audio recordings on your device, and it has no servers to send them to.

- **Android:** speech is turned into text by the speech recognition service built into your phone (normally Google's "Speech Services"), not by code inside Najwa AI. Without **Private voice**, that service may send what you say to its provider's servers (usually Google) to be turned into text, and the provider's privacy policy applies. With **Settings → Voice → Private voice** on, Najwa AI asks the phone to recognise speech on the phone only; this needs Android 12 or newer with offline speech recognition available, and if the phone can't do it, Najwa AI says so instead of falling back. Private voice is off by default. The Android microphone permission is asked for the first time you use it.
- **iPhone:** speech is turned into text by Apple's speech recognition. Without **Private voice**, what you say is sent to Apple to be turned into text, and Apple's privacy policy applies. With **Private voice** on, recognition happens only on your iPhone, if your iPhone supports it for the language you picked; if not, Najwa AI says so instead of sending audio to Apple. Private voice is off by default.
- **Desktop (Windows, macOS, Linux):** speech is turned into text on your computer with Whisper (whisper.cpp), a speech recognition program that comes with the desktop app. What you say is recorded in memory, sent to Whisper on your own computer (a local connection, `127.0.0.1`, that never leaves the computer), and then discarded. Nothing is sent to anyone. Whisper needs a model file, which is downloaded once (see "Model downloads" below).
- **Reading replies aloud:** replies are read with the voices of your phone or computer (Android's text-to-speech engine, Apple's speech synthesiser on iPhone, or the voices installed in your computer's system on desktop). Najwa AI itself sends the text only to that system service. Some phone speech engines can use online voices; if yours does, its provider's policy applies.

## Model downloads

Some features need a model file that is downloaded once and then used on your device. Najwa AI downloads a model only when you choose to, from **Settings → Models** (phone) or **Settings → Voice** (desktop).

- **From where:** from Hugging Face (`huggingface.co`). On phones, the built-in list of on-device chat models comes from there, and you can also paste a link to any other `.gguf` file (or a vision file for a model), which is then downloaded from whatever address you gave. On desktop, the two Whisper speech models (`ggerganov/whisper.cpp`) come from Hugging Face. Hugging Face may send the download on to its own content-delivery hosts, which also receive the request.
- **What is sent:** an ordinary download request for that file. Like any download, the server can see your device's IP address and the file you ask for. Najwa AI adds no account, API key, chat or other personal data to it, and does not use a Hugging Face account. The request also carries the ordinary technical details your phone or computer's network software adds to any web request (for example the type of device and system version). Hugging Face's privacy policy applies to its side.
- **What is stored on your device:** the model file, in the app's own private storage (on Android: the app's `models` folder; on iPhone: the app's Application Support `models` folder, which is left out of iCloud backups; on desktop: a `whisper` folder in the app's data folder), plus, on Android, a small list of what was downloaded so Najwa AI can tell you if the phone removed a model. Unfinished downloads are kept as `.part` files so they can resume, and are removed if the download is cancelled or fails. You can delete any downloaded model in the same settings screen.
- **After the download:** the model runs on your device. Chatting with an on-device model, or speaking to the desktop app, does not contact Hugging Face again.
- **Notifications:** on Android, a download shows a notification with its progress, and Android may ask for notification permission.

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

Questions about this policy or about your data: **bandar.altariqi@gmail.com**

Project page: https://github.com/bandar9994

This policy is also published at https://bandar9994.github.io/privacy.html.
