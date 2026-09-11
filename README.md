# Agent Native - Web-Tool

> Converts the ZIP file of a static website into an **agent-native** version-clean HTML, Markdown, `llms.txt`, and ready-to-use server configurations-and returns everything as a new ZIP file. Runs entirely in the browser.

![Version](https://img.shields.io/badge/version-1.0.0-0b6e68)
![License](https://img.shields.io/badge/license-GPLv2-3da639)

The counterpart to the WordPress plugin for **static websites**. You upload the ZIP file of your site, and the tool generates a machine-readable version for AI agents (ChatGPT, Claude, Perplexity, etc.) for each page and packs them together with your original site into a new ZIP file-including server rules that redirect known agents to the clean version on your server.

The entire conversion takes place **on the client side**: Your files aren’t uploaded anywhere.

---

## Features

- **Clean HTML Mirror** – structured HTML + JSON-LD per page under `/agent/`.
- **Markdown Version** – token-efficient `.md` version per page.
- **Discovery** – `llms.txt` (index) and `llms-full.txt` (full-text export).
- **Server Config** – pre-configured `.htaccess` and nginx rules for user-agent routing.
- **Alternate Links** – optionally inserts `<link rel="alternate" type="text/markdown">` into your original pages.
- **Configurable** – options can be enabled individually; the agent user-agent list is editable.
- **Privacy** – browser-only processing; no uploads, no servers.

## Usage

1. Open `index.html` in your browser (or upload the tool to a static host).
2. Drag the **ZIP file of your website** into the drop zone (it expects `.html` files).
3. Select your options and click **Convert**.
4. Download the **converted ZIP file**.

## What's inside the result ZIP

```text
your-site-agent-native.zip
├── index.html                 # Original (optionally supplemented with <link rel="alternate">)
├── about.html
├── assets/…                   # Copied unchanged
├── agent/                     # Machine-readable mirror
│   ├── index.html             #   Clean HTML + JSON-LD, canonical link → original
│   ├── index.md               #   Markdown version
│   ├── about.html
│   └── about.md
├── llms.txt                   # machine-readable index
├── llms-full.txt              # full-text export
├── .htaccess                  # Apache: route agents to /agent/
├── agent-native-nginx.conf    # nginx snippet (map + location)
└── AGENT-NATIVE-README.md     # deployment notes
```

## Deployment

1. Upload the **complete bundle** to the web root (keep the `/agent/` folder).
2. **Apache:** The included `.htaccess` file takes effect when `mod_rewrite` is enabled.
   **nginx:** Include the `map` and `location` lines from `agent-native-nginx.conf`.
3. Test:

```bash
curl -A "ClaudeBot" https://your-domain.tld/some-page.html
```

## Launch Local / Structure

The tool consists of four files that must be placed together in **one folder**:

```text
index.html      # Structure / UI
style.css       # Styling
app.js          # Conversion logic
jszip.min.js    # Bundled ZIP library (allows offline operation)
```

To use it, simply open `index.html`. To host it, place all four files in the same directory on your static host.

## Notes & Limitations

> [!IMPORTANT]
> **Static vs. Runtime:** Live detection cannot be performed using static files alone. The tool therefore generates a `/agent/` mirror **and** server configurations that route traffic at runtime. The mirror displays the same content as the original (the canonical URL points back to the origin)-no deceptive **cloaking**.

> [!NOTE]
> - **User-agent detection** can be spoofed and is never complete-best-effort by design.
> - The **Markdown converter** is intentionally lightweight (standard tags); for complex pages, HTML mode is more reliable.
> - Since everything runs in the browser, **very large sites** are limited by available memory.

## Dependencies

- [JSZip](https://stuk.github.io/jszip/) – for reading and writing ZIP files (dual MIT / GPLv3). Bundled locally as `jszip.min.js`.

## License

Released under [GPLv2 (or later)](https://www.gnu.org/licenses/gpl-2.0.html).
