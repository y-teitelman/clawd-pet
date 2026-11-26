# Changelog

All notable changes to Clawd Pet. Newest first.
Each version is also a [GitHub release](https://github.com/y-teitelman/clawd-pet/releases) and a git tag (`v1.3.0`, …).
To update: `/plugin`, or `claude plugin marketplace update clawd-pet` and then `claude plugin update clawd-pet`.

## 1.3.0 — 2026-11-26

### Added
- **Any language.** *Own…* in settings asks for a language by name (written in any language). After you agree, the AI translates everything Clawd shows, once (roughly 10k Haiku tokens, billed to your own session). The translation is checked line by line, kept between sessions, and offered again when an update brings new words. Russian is not available.
- **Japanese and Korean** built in, picked automatically from your system or your prompts.
- **The ? button** next to the hearts: what improves your relationship, what hurts it, the levels, what Clawd reacts to, and what you have earned today.
- **Reset settings** in settings.
- README in four separate files: English, Ukrainian, Japanese and Korean (the last two are machine translations).

### Changed
- Clawd talks about the work as his own ("fixing it now"), instead of commenting on Claude from the side.
- AI lines repeat themselves less: the model sees its last few lines, and interjections are kept for when they fit.
- The speech bubble measures Japanese, Korean and Chinese characters as two cells wide and breaks Japanese lines between characters, so the frame stays straight.
- The usage block, chat headers and other labels follow the chosen language too.

### Fixed
- **Reset affection** now asks before it resets. It used to reset at once.

## 1.2.0 — 2026-11-26

### Added
- A welcome line waits in the bubble from the start of a session until your first prompt, fitted to the time of day when greetings are on.

### Changed
- AI lines are sized to the bubble: the model gets a character budget from the bubble's real width; a reply that is too long loses its tail sentences, and one that still doesn't fit is replaced by a built-in line.
- A clearer persona prompt: natural, grammatical speech, one complete line, no stage directions.

### Fixed
- AI lines no longer get cut off mid-word.
- In clean chat, "(shift+tab to cycle)" stays under the prompt next to the permission mode instead of moving into the pane.

## 1.1.0 — 2026-11-26

### Added
- **The Claude desktop app.** The pet is drawn as a crisp picture there, and clicks work. The rest of the pane is the same as in the terminal.

### Changed
- On the desktop, idle, work and sleep animate inside the picture itself, so the pane redraws only on events (redrawing every frame made the chat's message buttons flicker).
- Header lines in the chat clip at the window's edge with proportional fonts.

### Fixed
- `/clawd` no longer reports "no-surface" on the desktop while the pane is open.

## 1.0.0 — 2026-11-26

The first release: a tiny tsundere pixel pet in a pane beside the Claude Code chat.

- Click reactions: hearts, shyness, a tsundere "hmph!", star eyes for best friends.
- Speech bubbles with built-in lines, or optional AI-written lines (Claude Haiku, off by default).
- Affection with four relationship levels, saved between sessions.
- Naps after a few quiet minutes, moods on tool errors, finished replies and stops.
- Time-of-day greetings, six color skins.
- Usage at a glance (context, 5-hour and 7-day limits, cost estimate) and quick commands.
- Optional clean chat.
- English and Ukrainian.
