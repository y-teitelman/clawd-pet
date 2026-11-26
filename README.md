<div align="center">

<img src="assets/demo.gif" alt="Clawd Pet: idle, walking, hearts, shy, tsundere, star eyes, sad, sleeping, and five color skins" width="384">

# ✻ Clawd Pet

**A tiny tsundere pixel pet that lives in a pane beside your Claude Code chat.**
It walks while Claude works, naps when you're away, blushes when you poke it, and talks in comic-strip bubbles.

[English](#english) · [Українська](#українська)

<sub>Unofficial fan-made mod. Not affiliated with, endorsed by, or sponsored by Anthropic.
"Claude" and "Claude Code" are trademarks of Anthropic. The pet's pixel art is original to this project.</sub>

</div>

---

## English

### What it does

| | |
|---|---|
| 🐾 **Lives beside the chat** | A side pane with an animated pixel pet, drawn right in your terminal. |
| 🖱️ **Click it** | Hearts, shyness, or a tsundere *"hmph!"* and turn-away. Best friends sometimes get star eyes. |
| 💬 **Speech bubbles** | Comments on your tasks, tool runs, errors and finished replies, plus idle chatter. Built-in lines by default, or optional AI-written lines. |
| 💞 **Affection** | The more you hang out, the sweeter it gets: four relationship levels shift which reactions you see. Saved across sessions. |
| 😴 **Sleeps** | Dozes off after a few quiet minutes (Zs and all). Click to wake it. It will insist it wasn't asleep. |
| 🎭 **Moods** | Sheds a tear when a tool fails, hops when a turn finishes, startles when you stop Claude. |
| 🌅 **Greetings** | Says hello by time of day, and has opinions about 3 a.m. sessions. |
| 🎨 **Six skins** | Classic, Mint, Lavender, Sky, Gold and Night — the pane's accent color follows along. |
| 🧹 **Clean chat** *(optional)* | Moves tool rows, the spinner and the footer hints into the pane, and puts a clear header above each reply, so the chat holds only the conversation. |
| 📊 **Usage at a glance** | Context fill with a bar, your 5-hour and 7-day limits with reset times, and the session cost estimate. |
| ⚡ **Quick commands** | One-click `/compact`, `/context`, `/usage` and `/model`. Nothing that wipes the chat. |
| 🌍 **Two languages** | English and Ukrainian, detected automatically. |

### Install

At the prompt of a Claude Code terminal session:

```
/plugin install clawd-pet --marketplace y-teitelman/clawd-pet
```

Answer `y` to add the marketplace, then pick a scope (for yourself, or for one project).

Or from a shell:

```
claude plugin install clawd-pet --marketplace y-teitelman/clawd-pet
```

Then restart Claude Code (or open a new session). On first launch the pet opens its settings: pick what you like and press **Done**.

> The pane opens by itself in terminals at least 144 columns wide. In a narrower window, type `/clawd`.

### Commands

| Command | What it does |
|---|---|
| `/clawd` | Open the pet pane |
| `/clawd-settings` | Open settings (also: the **☰** button in the pane's header) |
| `/clawd-chat` | Toggle clean chat on and off |

### Settings

Everything is changeable at any time from **☰** or `/clawd-settings`, and is saved between sessions.

| Setting | Options | Default |
|---|---|---|
| Language | Auto · Українська · English | Auto |
| AI-written lines | Off · On | **Off** |
| Share my prompt with the AI | Off · On *(shown when AI lines are on)* | On |
| Chattiness | Often · Normal · Rarely · Silent | Normal |
| Clean chat | Off · On | Off |
| Affection | Off · On | On |
| Favorite reaction | Random · Hearts · Shy · Tsundere *(shown when affection is off)* | Random |
| Color | Classic · Mint · Lavender · Sky · Gold · Night | Classic |
| Fall asleep after | Never · 5 · 15 · 30 min | 5 min |
| Time-of-day greetings | Off · On | On |
| React to events | Off · On | On |
| Usage block | Off · On | On |
| Quick commands | Off · On | On |

**Language: Auto** starts from your system locale, then follows the language you write your prompts in.

### Affection

Each poke and each finished reply raises affection a little (with a daily cap, so spamming doesn't help). Poking four times in ten seconds lowers it. The pane shows it as hearts:

| Level | Hearts | What you'll see most |
|---|---|---|
| Reserved | ♥♡♡♡♡ | tsundere |
| Acquainted | ♥♥♡♡♡ | a mix |
| Friends | ♥♥♥♡♡ | hearts and blushing |
| Best friends | ♥♥♥♥♥ | hearts, and rare ✨ star eyes |

Turn affection off to pick a favorite reaction instead. **Reset affection** lives in settings.

### AI-written lines: cost and privacy

AI lines are **off by default**. When you turn them on:

- Each line is one short request to **Claude Haiku**, made with your Claude Code session's own credentials and counted in its usage (`/usage` shows how much came from mods). A line is about 60 output tokens; there's a cap of 200 lines per session, after which it falls back to built-in lines.
- To comment on what's happening, the model sees: the tool name and its short label (a command, a file name or a search pattern), the time a reply took, and — only if **Share my prompt** is on — the first 200 characters of your prompt.
- Nothing is sent anywhere else. With AI lines off, nothing is sent at all.

### Clean chat

When on, the chat shows only your messages and Claude's replies, each under its own header. The pane shows instead:

- **Status:** what Claude is doing right now, with a timer
- **Activity:** every tool call, `✓` done, `✗` failed
- **Hints:** the status line, mode labels and the shortcut hints from under the prompt

Failed tool calls and permission prompts always stay in the chat. Press **ctrl+o** for the full transcript any time.

### Requirements

- Claude Code with mod (hooks module) support
- A terminal with true color. On Windows, use **Windows Terminal**; the legacy console may draw the pixels poorly.
- Mouse clicks need a terminal that passes them to apps (Windows Terminal, iTerm2, most Linux terminals do).

### Troubleshooting

- **No pane?** Type `/clawd`. Below 144 columns the pane waits to be asked.
- **The pet looks striped or blocky in the wrong colors?** Your terminal is probably limited to 256 colors. Try a true-color terminal.
- **Rows highlight under the mouse?** Only the pet's edges are plain text; its body is drawn so the terminal's hover highlight is invisible. If you still see it, your terminal draws hover differently.

### Development

```
claude plugin validate .          # check the manifest and the module
claude plugin test .              # run tests/
node scripts/render-assets.mjs .  # redraw assets/icon.png and assets/demo.gif from the sprite code
```

The sprite is drawn by one pure function between the `// <sprite>` markers in `hooks/register.tsx`; the asset script renders that same code, so the README always shows the real pet.

---

## Українська

<div align="center">

<img src="assets/demo.gif" alt="Clawd Pet: спокій, ходьба, сердечка, сором, цундере, зірочки в очах, сум, сон і п'ять кольорів" width="384">

# ✻ Clawd Pet

**Крихітний цундере-улюбленець із пікселів, що живе в панелі поруч із чатом Claude Code.**
Крокує, поки Claude працює, дрімає, коли тебе немає, червоніє, коли ти його тицяєш, і говорить хмарками, як у коміксі.

[English](#english) · [Українська](#українська)

<sub>Неофіційний фанатський мод. Не пов'язаний з Anthropic, не схвалений і не спонсорований ним.
«Claude» і «Claude Code» — торгові марки Anthropic. Піксель-арт улюбленця створено саме для цього проєкту.</sub>

</div>

### Що він уміє

| | |
|---|---|
| 🐾 **Живе поруч із чатом** | Бічна панель з анімованим піксельним улюбленцем просто у терміналі. |
| 🖱️ **Клікни по ньому** | Сердечка, сором'язливість або цундерське «хмф!» з відвертанням. Найкращі друзі іноді бачать зірочки в очах. |
| 💬 **Хмарки з репліками** | Коментує завдання, інструменти, помилки й готові відповіді, а на простої нудьгує. За замовчуванням — вбудовані фрази, за бажанням — фрази від ШІ. |
| 💞 **Прихильність** | Що більше спілкуєтесь, то він ніжніший: чотири рівні стосунків змінюють, які реакції ти бачиш. Зберігається між сесіями. |
| 😴 **Спить** | Засинає після кількох хвилин тиші (із «Zzz»). Клікни — прокинеться й буде запевняти, що не спав. |
| 🎭 **Емоції** | Пускає сльозу, коли інструмент падає, підстрибує, коли відповідь готова, лякається, коли ти зупиняєш Claude. |
| 🌅 **Вітання** | Вітається залежно від часу доби й має думку про сесії о третій ночі. |
| 🎨 **Шість кольорів** | Класика, М'ята, Лаванда, Небо, Золото, Ніч — акцентний колір панелі змінюється разом із ним. |
| 🧹 **Чистий чат** *(за бажанням)* | Переносить рядки інструментів, спінер і підказки в панель, а над кожною відповіддю ставить заголовок — у чаті лишається тільки розмова. |
| 📊 **Використання** | Заповненість контексту зі шкалою, ліміти на 5 годин і 7 днів із часом скидання та оцінка вартості сесії. |
| ⚡ **Швидкі команди** | `/compact`, `/context`, `/usage` і `/model` в один клік. Нічого, що стирає чат. |
| 🌍 **Дві мови** | Українська й англійська, визначаються автоматично. |

### Встановлення

У рядку вводу Claude Code в терміналі:

```
/plugin install clawd-pet --marketplace y-teitelman/clawd-pet
```

Відповідай `y`, щоб додати marketplace, і вибери, для кого встановити (для себе чи для одного проєкту).

Або з командного рядка:

```
claude plugin install clawd-pet --marketplace y-teitelman/clawd-pet
```

Перезапусти Claude Code або відкрий нову сесію. Під час першого запуску улюбленець відкриє налаштування — вибери, що подобається, і натисни **Готово**.

> Панель відкривається сама, якщо термінал ширший за 144 колонки. У вужчому вікні введи `/clawd`.

### Команди

| Команда | Що робить |
|---|---|
| `/clawd` | Відкрити панель |
| `/clawd-settings` | Відкрити налаштування (або кнопка **☰** у заголовку панелі) |
| `/clawd-chat` | Увімкнути чи вимкнути чистий чат |

### Налаштування

Усе можна змінити будь-коли через **☰** або `/clawd-settings`, і все зберігається між сесіями.

| Налаштування | Варіанти | За замовчуванням |
|---|---|---|
| Мова | Авто · Українська · English | Авто |
| Фрази від ШІ | Вимк · Увімк | **Вимк** |
| Показувати ШІ мій запит | Вимк · Увімк *(видно, коли фрази від ШІ увімкнено)* | Увімк |
| Балакучість | Часто · Звичайно · Рідко · Мовчки | Звичайно |
| Чистий чат | Вимк · Увімк | Вимк |
| Прихильність | Вимк · Увімк | Увімк |
| Улюблена реакція | Випадково · Сердечка · Сором · Цундере *(видно, коли прихильність вимкнено)* | Випадково |
| Колір | Класика · М'ята · Лаванда · Небо · Золото · Ніч | Класика |
| Засинати через | Ніколи · 5 · 15 · 30 хв | 5 хв |
| Вітатися за часом доби | Вимк · Увімк | Увімк |
| Емоції на події | Вимк · Увімк | Увімк |
| Блок використання | Вимк · Увімк | Увімк |
| Швидкі команди | Вимк · Увімк | Увімк |

**Мова «Авто»** спершу береться з мови системи, а далі підлаштовується під мову, якою ти пишеш запити.

### Прихильність

Кожен клік і кожна завершена відповідь трохи підвищують прихильність (з денним лімітом, тож спам не допоможе). Чотири кліки за десять секунд її знижують. У панелі вона показана сердечками:

| Рівень | Сердечка | Що бачитимеш найчастіше |
|---|---|---|
| Стримано | ♥♡♡♡♡ | цундере |
| Знайомі | ♥♥♡♡♡ | усього потроху |
| Друзі | ♥♥♥♡♡ | сердечка й рум'янець |
| Найкращі друзі | ♥♥♥♥♥ | сердечка й рідкісні ✨ зірочки в очах |

Якщо вимкнути прихильність, можна натомість вибрати улюблену реакцію. Кнопка **«Скинути прихильність»** — у налаштуваннях.

### Фрази від ШІ: ціна і приватність

Фрази від ШІ **за замовчуванням вимкнено**. Якщо їх увімкнути:

- Кожна фраза — один короткий запит до **Claude Haiku** з облікових даних твоєї сесії Claude Code, і він рахується в її використанні (`/usage` показує, скільки припало на моди). Фраза — це приблизно 60 токенів відповіді; ліміт — 200 фраз за сесію, після нього — вбудовані фрази.
- Щоб коментувати, що відбувається, модель бачить: назву інструмента й коротку мітку (команду, назву файлу чи шаблон пошуку), скільки тривала відповідь і — тільки якщо увімкнено **«Показувати ШІ мій запит»** — перші 200 символів твого запиту.
- Більше нікуди нічого не надсилається. Із вимкненими фразами від ШІ не надсилається нічого.

### Чистий чат

Коли він увімкнений, у чаті лишаються тільки твої повідомлення й відповіді Claude, кожне під своїм заголовком. А панель натомість показує:

- **Стан:** що Claude робить просто зараз, із таймером
- **Дії:** кожен виклик інструмента, `✓` готово, `✗` помилка
- **Підказки:** рядок статусу, позначки режимів і підказки з-під поля вводу

Інструменти, що завершились помилкою, і запити дозволу завжди лишаються в чаті. **ctrl+o** будь-коли показує повний лог.

### Вимоги

- Claude Code з підтримкою модів (hooks module)
- Термінал із true color. На Windows використовуй **Windows Terminal**; у старій консолі пікселі можуть малюватися криво.
- Для кліків термінал має передавати мишу програмам (Windows Terminal, iTerm2 і більшість терміналів Linux це вміють).

### Якщо щось не так

- **Немає панелі?** Введи `/clawd`. Якщо термінал вужчий за 144 колонки, панель чекає, поки її покличуть.
- **Улюбленець смугастий або не тих кольорів?** Схоже, твій термінал підтримує лише 256 кольорів. Спробуй термінал із true color.
- **Рядки підсвічуються під мишкою?** Звичайним текстом намальовані лише краї улюбленця, а тіло — так, щоб підсвітку терміналу не було видно. Якщо ти все одно її бачиш, твій термінал малює підсвітку по-своєму.

### Для розробників

```
claude plugin validate .          # перевірити маніфест і модуль
claude plugin test .              # запустити tests/
node scripts/render-assets.mjs .  # перемалювати assets/icon.png і assets/demo.gif з коду спрайта
```

Спрайт малює одна чиста функція між позначками `// <sprite>` у `hooks/register.tsx`; скрипт для картинок рендерить той самий код, тож README завжди показує справжнього улюбленця.

---

<div align="center"><sub><a href="LICENSE">MIT License</a> · by <a href="https://github.com/y-teitelman">KypiCTiHka</a> · made with ♥ and a lot of pokes</sub></div>
