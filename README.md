# Lacuna!
TL;DR
Lacuna is a “man-in-the-middle” (benign) firewall for your browser. Completely invisible to your workflow, Lacuna intercepts prompts and documents uploaded to ChatGPT, Claude, Gemini, or even Deepseek -  seamlessly replacing your private data, passwords, and API keys with realistic synthetic placeholders before they ever leave your machine, and translating the AI’s response back to reality in real time. When sharing your screen, Lacuna gaslights your browser into doing the same, hiding sensitive information whilst keeping true data stored locally.

Why?
Every day, 2.5 billion prompts are sent to ChatGPT alone. As university students, it’s virtually impossible to find someone who doesn’t use gen AI weekly, much less daily. For many of us, it’s become pure muscle memory - copying and pasting homework (for conceptual understanding only, we swear), debugging code at 11:57 PM, or summarizing dense 20-page long pdfs that are somehow required reading.
But that habit has created a massive security blindspot. Across industry and academia, 77% of users paste sensitive data directly into chat boxes, and over 1 in 4 uploaded files contain private/sensitive financial, medical, or proprietary records. People aren’t trying to leak data maliciously, but there are serious security and privacy concerns, especially for personal and individual users. When a breach happens, you’re suddenly dealing with exploited health records, exposed chat histories 💀, or drained AWS credits from leaked API keys. 
Leaks don’t stop at the prompt box, either. While innocuous, screen sharing on Zoom or Discord can also lead to unintentionally flashing private dashboards or .env files. It only takes a bad actor a single frame or slip up for you to get DDoSed. have your identity stolen, admin password to be gone forever.

How?
Lacuna acts as a client-side proxy running entirely in your browser memory. Instead of fighting your habits, or requiring a middle step, Lacuna lets you copy + paste or upload whatever you want, splitting the world into what the server sees and what you see. There are two main features:

## Cloud Filter
*Keep your personal information close at hand*
Lacuna automatically intercepts and substitutes or redacts any sensitive data in document uploads and prompts before they are sent to the cloud, guaranteeing that third-party servers never see your raw sensitive data. It keeps track of real data to placeholder mappings locally, and when a response is sent back to the user, it reverses the substitution so the user does not have to see or worry about synthetic placeholders.
While text input is straightforward to process, Lacuna can also process docx, pdf, TODO ask claude docs documents and redact them inline.

## Screen Shield
*Protect your information from prying eyes*
The instant you click “Share Screen,” Lacuna’s DOM observer automatically moves into action. Instead of putting black boxes over your page, Lacuna substitutes any sensitive data with placeholders on your own screen. It uses the same mapping as Cloud Shield, and works on any website by modifying the DOM itself. If you need to copy a key while screen-sharing, there’s no need to worry, just highlight and copy the fake key right on screen! Lacuna intercepts the OS copy event and silently slips the real key into your clipboard, allowing you to work normally while showing viewers the fake text.

