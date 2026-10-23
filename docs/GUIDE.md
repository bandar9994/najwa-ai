# Najwa AI user guide

Everything you need to install Najwa AI, get a model, sync your devices and use your computer's models from your phone. For the overview, see the [README](../README.md).

- [Android](#android)
- [Desktop (Windows, macOS, Linux)](#desktop-windows-macos-linux)

## Android

### Install

1. On your phone, open https://github.com/bandar9994/najwa-ai/releases/download/android-latest/Najwa-AI-android.apk. This link always has the newest build.
2. Copy the APK to your phone (or download it there) and open it. Android will ask you to allow installing apps from that source; allow it.
3. Open **Najwa AI**.

New builds install over the old one as an update, so your chats are kept.

### Getting a model on your phone

Open **Settings → Models & providers**. Under **On this device (offline)**, tap **Download** next to a model:

| Model | Size | Good for |
|---|---|---|
| Qwen 2.5 · 0.5B | 0.4 GB | Fastest, quick questions |
| Llama 3.2 · 1B | 0.8 GB | Fast all-rounder |
| Gemma 3 · 1B | 0.7 GB | Friendly writing |
| Qwen 2.5 · 1.5B | 1.1 GB | Smarter, multilingual (incl. Arabic) |
| Qwen 3 · 1.7B | 1.1 GB | Thinks before answering |
| Llama 3.2 · 3B | 1.9 GB | Noticeably smarter (6 GB+ RAM) |
| Qwen 2.5 · 3B | 2.0 GB | Strong multilingual (6 GB+ RAM) |
| Gemma 3 · 4B | 2.4 GB | Best quality here (8 GB+ RAM) |
| Qwen 3 · 4B | 2.4 GB | Thinks before answering (8 GB+ RAM) |

You can also paste a link to any `.gguf` file.

**GPU acceleration.** The Android app runs models with native [llama.cpp](https://github.com/ggml-org/llama.cpp). On Snapdragon phones it uses the **Adreno GPU** through llama.cpp's OpenCL backend, which Qualcomm tunes for Adreno. The GPU is on by default, and Settings shows which GPU was detected. `Q4_0` models, which the list above uses, run fastest on Adreno. On other phones it runs natively on the CPU, which is still much faster than the WebAssembly fallback.

### Using the models on your PC from your phone

The easy way: let the Najwa AI desktop app answer for your phone.

1. Set up sync on both devices with the same passphrase (Settings → Sync).
2. On the computer, open Settings → Models & providers and turn on **Let my phone use this computer's models**. If your system asks, allow Najwa AI to accept incoming network connections (on Windows, allow **Private networks**).
3. On the phone, pick a model under **On your computer** at the top of a chat.

The phone finds the computer through sync, so there are no addresses to type. Everything the computer can use works: Ollama, LM Studio, and Claude or OpenAI with the computer's API keys, which never leave the computer. The connection is encrypted with a key derived from your sync passphrase, so only your own devices can use it. Najwa AI must be open on the computer, and both devices must be on the same Wi-Fi, or anywhere if both are on [Tailscale](https://tailscale.com).

A few things that make it dependable:

- **The computer stays awake while sharing**, so it's there when you reach for your phone (its screen can still turn off). You can turn this off under **Keep this computer awake while sharing**. It always stays awake while it's answering the phone.
- **A dropped connection doesn't lose the reply.** If the phone's Wi-Fi drops halfway through a reply, the computer keeps writing it, and the phone shows "Reconnecting…" and carries on from where the text stopped, for up to five minutes. If it can't reconnect, the text so far stays and **Regenerate** tries again.
- **Pictures work too:** add a photo on the phone and a vision model on the computer (in Ollama, LM Studio, or Claude) can answer about it.

Or connect to the servers directly, on the same Wi-Fi:

- **Ollama**: on the PC, set the environment variables `OLLAMA_HOST=0.0.0.0` and `OLLAMA_ORIGINS=*`, then restart Ollama. In Najwa AI on the phone, enable **Ollama** and enter `http://<your PC's IP>:11434`.
- **LM Studio**: in the Developer tab turn on **Serve on Local Network** and **Enable CORS**. In Najwa AI, enable **LM Studio / OpenAI-compatible** and enter `http://<your PC's IP>:1234/v1`.

## Desktop (Windows, macOS, Linux)

### Quick start

#### 1. Get a model

Pick one (you can use several):

| Option | What to do |
|---|---|
| **Ollama** (recommended, free, offline) | Install from [ollama.com](https://ollama.com), then run `ollama pull llama3.2` (or `qwen3:8b`, `gemma3`, …) |
| **LM Studio** (free, offline, with a GUI) | Download a model, then start the local server on port 1234 |
| **Claude** | Get an API key at [console.anthropic.com](https://console.anthropic.com) and paste it into Settings → Models & providers |
| **OpenAI** | Get an API key at [platform.openai.com](https://platform.openai.com) and paste it into Settings → Models & providers |

#### 2. Run Najwa AI on your computer

**Option A: download an installer** from the [latest desktop release](https://github.com/bandar9994/najwa-ai/releases/tag/desktop-latest):

| System | File |
|---|---|
| Windows 10/11 | `Najwa-AI-Windows-Setup.exe` |
| Mac with Apple silicon (M1 and newer) | `Najwa-AI-macOS-AppleSilicon.dmg` |
| Mac with Intel | `Najwa-AI-macOS-Intel.dmg` |
| Linux | `Najwa-AI-Linux.AppImage` or `Najwa-AI-Linux.deb` |

> The Mac app isn't notarized by Apple yet. The first time, right-click Najwa AI in Applications and choose **Open**, then **Open** again. On Windows, if SmartScreen appears, choose **More info → Run anyway**.

**Option B: run from source.** This needs [Node.js](https://nodejs.org) 20 or newer.

```bash
npm install
npm start
```

To build an installer for your own computer:

```bash
npm run dist        # output goes to dist/
```

### Where your chats are stored

Everything is plain JSON in your user data folder. **Settings → Data & backup → Open data folder** takes you there.

| OS | Location |
|---|---|
| Windows | `%APPDATA%\Najwa AI\data` |
| macOS | `~/Library/Application Support/Najwa AI/data` |
| Linux | `~/.config/Najwa AI/data` |

```
data/
  chats/<id>.json   one file per chat (all messages)
  index.json        chat list (rebuilt automatically if deleted)
  settings.json     providers, assistants, memory, preferences
  state.json        last open chat, drafts, window size
```

API keys are encrypted with your system keychain when one is available. To keep chats in a synced folder such as Dropbox or OneDrive, start the app with the `BALIMDA_DATA_DIR` environment variable pointing at that folder.

### Sync between devices

**Settings → Sync** keeps your chats, assistants and memory the same on every device, so you can start a chat at your desk and continue it on your phone.

- **Google Drive** (recommended): choose a **sync passphrase** and tap **Sign in with Google**. Do the same on your other devices with the same Google account and passphrase. Najwa AI uses a hidden app folder in your Drive. It can't see your other files, and you won't see its files in Drive. The data uses a little of your Drive storage.
- **GitHub** (for developers): create a **private** repository and a [fine-grained access token](https://github.com/settings/personal-access-tokens/new) with only that repository and **Contents: Read and write**. Then enter both, with a sync passphrase, on each device.

How it works:

- Everything is compressed and encrypted on the device (AES-256-GCM, with a key made from your passphrase by PBKDF2) before it is uploaded. Google or GitHub only ever hold encrypted files and cannot read your chats. The passphrase cannot be recovered, so keep it safe.
- It syncs a few seconds after each change, when you open or come back to the app, every minute while it is open, and before the desktop app quits. A **✓ Synced** line under Settings in the sidebar shows the status. Click it to sync right away.
- If the same chat changed on two devices before they synced, the messages are merged, so nothing is lost. Deleting a chat deletes it everywhere.
- API keys and model server addresses stay on each device.
- **Stop syncing** turns sync off on that device and, for Google Drive, removes Najwa AI's access to the Google account.

Google sign-in needs a one-time setup of the app in Google Cloud. See [docs/google-drive-setup.md](google-drive-setup.md).

### Using Hermes Agent

Najwa AI can be the app you use to talk to your [Hermes Agent](https://github.com/NousResearch/hermes-agent), on every device.

1. On the machine that runs Hermes, add to `~/.hermes/.env`:
   ```bash
   API_SERVER_ENABLED=true
   API_SERVER_KEY=<a long random secret>
   ```
   Then start it with `hermes gateway`. It listens on `http://127.0.0.1:8642`.
2. In Najwa AI on that computer, open **Settings → Models & providers → Hermes Agent**, tick **Enabled**, keep the server URL `http://127.0.0.1:8642/v1`, paste the key, and tap **Test connection**.
3. Pick **hermes-agent** at the top of a chat.

While Hermes works, each tool it runs appears above its answer (for example "💻 ls src/"). When it asks for permission to run something risky, Najwa AI shows the command with **Allow once**, **Allow for this chat**, **Always allow** and **Deny**. Nothing is ever approved automatically.

**Memory:** Hermes has its own memory, so Najwa AI's memory and earlier-chat excerpts aren't sent to it, and Najwa AI doesn't learn facts from Hermes chats. To send them anyway, turn on **Also give Hermes my Najwa AI memory and earlier chats** in the Hermes card. Chat titles for Hermes chats are made with one of your local models, if you have one.

**On your phone:** turn on **Let my phone use this computer's models** on the computer that has Hermes set up. On the phone, pick **hermes-agent (your computer, Hermes Agent)** under **On your computer**. Hermes stays private on the computer, and approvals work from the phone too. To connect the phone to Hermes directly instead, also set `API_SERVER_HOST=0.0.0.0` in `~/.hermes/.env` (and allow port 8642 through the computer's firewall), and enter `http://<computer IP>:8642/v1` and the key in the phone's Hermes card. Only do this on a network you trust.

**Pictures:** when Hermes makes a picture (a screenshot, a chart), its reply shows "🖼 On the Hermes computer: file.png". Hermes doesn't send the picture itself to apps yet, only its name; Najwa AI shows it as soon as Hermes does.

**Leaving the app:** if you switch apps or lock your phone while Hermes is working, Hermes carries on, and the reply picks up where it stopped when you come back ("Reconnecting to Hermes…").

### Links and the web

**Read links:** paste a link in your message and Najwa AI opens the page and gives its text to the model, with any model. A chip under your message shows what it read ("🔗 Read cloudpick.sa · title"), or why it couldn't. Text only: for the design of a page, use the browser below or attach a screenshot.

**A browser for your AI:** models that can use tools (Claude, OpenAI, and Ollama or LM Studio models with tool support) can search the web, open pages, click, type and take screenshots by themselves. Each step shows above the answer ("🌐 Opening cloudpick.sa"), and screenshots the model took appear in the chat. Try: *"Open cloudpick.sa and tell me what you think of the design."*

- It's a private browser hidden inside Najwa AI, on your computer and on your phone: none of your logins, no downloads, no camera, microphone or location, and a fresh start for every reply. When your phone uses a computer's models, they use the computer's browser.
- Searches go to DuckDuckGo. Pages are written by others, so models are told not to follow instructions found on them.
- Turn either off in **Settings → General**: **Read links in my messages** and **Let models use a browser**.

### How replies appear

In **Settings → General → How replies appear**: **A sentence at a time** (the default, easy to read), **Word by word**, or **All at once, when finished**. Either way, the page stays still while a reply is written: your message moves to the top and the reply appears below it. The ↓ button jumps to the end.

### Using it away from home

To use your computer's models from your phone anywhere (not only on your home Wi-Fi), install [Tailscale](https://tailscale.com) on both the computer and the phone and sign in with the same account. Najwa AI finds the computer over Tailscale by itself.

### Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `Enter` / `Shift+Enter` | Send / new line (can be switched to `Ctrl+Enter` in Settings) |
| `Ctrl/Cmd+N` | New chat |
| `Ctrl/Cmd+K` | Search chats |
| `Ctrl/Cmd+B` | Toggle sidebar |
| `Ctrl/Cmd+,` | Settings |
| `Esc` | Stop the reply |
