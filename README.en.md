<div align="center">

![DSH Next Message — Your next message, one Tab away.](docs/assets/hero.svg)

# Your next message, one Tab away.

**Conversation-aware next-message predictions for DeepSeek Harness.**

Let the reply finish. See a suggestion. Press **Tab** to keep the conversation going.

[简体中文](README.md) · **English**

[Download](https://github.com/746445568/dsh-next-message/releases/download/v0.1.0/dsh-next-message-0.1.0.tgz) · [Releases](https://github.com/746445568/dsh-next-message/releases) · [Report an issue](https://github.com/746445568/dsh-next-message/issues)

`v0.1.0` · `MIT` · `DSH 0.2.1-rc` · `No added runtime dependencies`

</div>

---

## Stay in the conversation

Sometimes you already know you want to follow up. You just do not want to type the whole sentence again.

**DSH Next Message** predicts what you might say next after the assistant finishes a normal reply. A suggestion appears as ghost text in an empty composer. Press **Tab** to turn it into an editable draft. Press **Esc** to dismiss it, or simply start typing your own message.

> **The model suggests. You send.** Accepted text stays editable and undoable. The plugin never sends a message for you.

The cover is a UI illustration, not a screenshot of the running plugin.

## Small gestures. Fewer interruptions.

| What you want | How it works |
| --- | --- |
| **A relevant next step** | Uses recent text and user constraints from the current conversation to predict a user message |
| **One-key acceptance** | Tab inserts the whole suggestion as a draft, with native undo support |
| **Your typing comes first** | Starting to type removes the suggestion; accepting it rechecks the live draft state |
| **IME-friendly input** | Leaves composition, slash commands and @ menus in control of the keyboard |
| **Your choice of model** | Follows the conversation or uses a separate fast model already configured in DSH |
| **A quiet composer** | Skips existing drafts, attachments, quotes, queued messages, cancelled turns and failed turns |

## Get started in a minute

1. [Download **dsh-next-message-0.1.0.tgz**](https://github.com/746445568/dsh-next-message/releases/download/v0.1.0/dsh-next-message-0.1.0.tgz). Keep the `.tgz` file; **do not extract it**.
2. Open DSH's plugin manager, choose the add-plugin action, enter the full local path, and install and enable the plugin. Fully quit and restart DSH.
3. Open the plugin's settings section, **下一句预测**. Confirm it is enabled. Finish a conversation turn and leave the composer empty to see a suggestion.

You can also use your existing `dsh` command. Example for PowerShell and the desktop profile:

```powershell
dsh plugin --profile desktop add "C:\Downloads\dsh-next-message-0.1.0.tgz"
```

Use the matching `web` profile for the Web UI. Disable other ghost-text prediction plugins first to avoid competing for the composer and Tab key.

**Target: DSH core `0.2.1-rc.1/rc.2`.** Tested against `0.2.1-rc.2` in the Linux / Chromium Web UI. Native Windows/macOS desktop shells and rc.1 have not been tested. Desktop app and core versions are separate fields. See the [validation record](docs/VALIDATION.md) for the full scope.

## Three gestures to remember

| Action | Result |
| --- | --- |
| **Tab** | Accept the whole suggestion as an editable draft; do not send |
| **Esc** | Dismiss the suggestion for this turn |
| **Start typing** | Remove the suggestion and write your own message |

Switching conversations or starting a new turn cancels the old prediction. Late results are discarded. Timeouts, failed generations and unsuitable follow-ups leave the composer quiet, without an error banner.

## Set your own pace

The **下一句预测** settings section lets you choose the model, suggestion language, timeout, length and context budget. Click the save-settings button to apply changes.

- **Use your current model.** Predictions follow the provider and model actually selected for the conversation, with the lowest reasoning effort the model declares it supports.
- **Choose a separate fast model.** Pick one already configured in DSH. The plugin has no separate API-key field.
- **Put a limit on waiting.** The default timeout is 3000 ms, adjustable from 1000 to 10000 ms. A timeout skips the turn without automatic repeated retries.
- **Avoid duplicate requests.** Results, empty predictions and failures are cached for the same turn, context and model configuration. Changing settings allows a fresh prediction.

Real response times and suggestion quality depend on the provider, model and context. This project makes no fixed latency or accuracy promise. The current settings UI uses Chinese labels; model output can be configured separately.

## Where does the data go?

Predictions use **DSH's native model service**. Selected recent text from the current conversation is sent to the chosen provider and consumes its normal credits or usage allowance. The plugin has no separate third-party API endpoint.

- It handles only the current conversation. It does not read other conversations, execute tools, browse new websites or send messages automatically.
- Common secret patterns are redacted before the auxiliary request. This does not identify every sensitive detail; treat conversation data according to the provider you select.
- Preferences live in `$DSH_HOME/next-message.json`, or `~/.dsh/next-message.json` when `DSH_HOME` is unset. Conversation text and keys are not stored there.
- Request counts, acceptances, durations and provider-reported token usage stay in host memory and reset on restart.

## Tested interactions. Clear limits.

| Check | Result and scope |
| --- | --- |
| **58 unit and boundary tests** | Pass: context, output rules, caching, cancellation, timeouts, draft checks, settings and more |
| **72 offline replay cases** | Pass: context and output contracts using prewritten candidates; not a measurement of real prediction accuracy |
| **12 real DSH UI assertions** | Pass: ghost text, Tab, Esc, undo, IME protection and settings in the Web UI, using fixed model responses |

These checks validate the integration and deterministic behavior. They **do not establish parity with Codex**. Real-model acceptance rates, costs and network latency still need evaluation in actual use. [Full validation record →](docs/VALIDATION.md)

<details>
<summary><strong>No suggestion appearing?</strong></summary>

1. Check that the plugin is connected and enabled, and the chosen model is available.
2. Complete a new normal assistant reply, then clear the composer. Running, cancelled and failed turns do not trigger predictions.
3. Check the status in the settings panel. For timeouts, increase the limit or choose a faster model. For model failures, verify the model works in DSH itself.
4. Fully quit and restart DSH, inspect plugin-loading errors, and disable other prediction plugins.

</details>

## Development and contributions

Node.js `^22.19 || >=24`. The client uses React supplied by DSH, with no added runtime dependencies.

```sh
git clone https://github.com/746445568/dsh-next-message.git
cd dsh-next-message
npm run check
npm pack
```

| Entry point | Responsibility |
| --- | --- |
| `lib/context.js` | Context selection, prompting and output checks |
| `lib/engine.js` | Turns, models, caching and cancellation |
| `lib/client-state.js` | Async predictions and draft state |
| `src/client-entry.js` | Native editor, keyboard handling and settings |

`client.js` is generated; run `npm run build` after client changes. See [qa/README.md](qa/README.md) for reproducible browser tests. [Issues](https://github.com/746445568/dsh-next-message/issues) are welcome with your DSH core version, OS, model name and reproduction steps. Leave out keys and private conversations.

## Credits and license

Reworked from [Tieboyh/dsh-next-step](https://github.com/Tieboyh/dsh-next-step), with thanks for the integration foundation. Upstream copyright, attribution and the scope of changes are preserved in [NOTICE](NOTICE) and the [MIT LICENSE](LICENSE).

An independent community project, with no official affiliation to DeepSeek or OpenAI. Discover more DSH plugins under the [`dsh-plugin`](https://github.com/topics/dsh-plugin) topic.
