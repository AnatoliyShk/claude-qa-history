# claude-qa-history

A Claude Code plugin that keeps your questions and Claude's answers in a side pane, and quizzes you on all of it.

- **History pane:** every prompt you type that ends with *?* or starts with a question word (*how, what, why, which, can, does, should*…) becomes a card with Claude's answer. A follow-up that builds on the previous answer is grouped under that card. Click a question to fold its answer.
- **Quiz:** `/qa-testme` writes a multiple-choice quiz on your whole history (using Haiku): 3 quiz questions for each question you asked, 60 at most and rates your score.
- **Ask about a selection:** select text anywhere with the mouse (an answer in the pane, the transcript), then press **Ask** to start a prompt `About "<selection>": ` and type your question, or **Explain** to send "Explain this: <selection>" at once. Both are recorded in the history.
- **Band above the prompt:** turn recording on or off, start a quiz, clear the history, and in the terminal Ask or Explain. The ✕ hides it until you run `/qa-history`.

## Install

```
/plugin marketplace add AnatoliyShk/claude-qa-history
/plugin install qa-history@claude-qa-history
```

## Commands and shortcuts

| Command | Shortcut | What it does |
|---|---|---|
| `/qa-history` | | Open the history pane and bring back the band |
| `/qa-testme` | `alt+t` | Quiz yourself on your whole history |
| `/qa-toggle` | `alt+q` | Turn recording on or off |
| `/qa-clear` | `alt+c` | Clear the history (run twice to confirm) |
| `/qa-ask` | `alt+s` | Start a question about the selected text |
| `/qa-explain` | | Ask Claude to explain the selected text |

In the desktop app, click the band once, then use `q`, `t` and `c`. Ask and Explain aren't on the desktop band, since the app doesn't tell plugins what you selected. In the quiz, click the options box once, then press `1`–`9`.

## It edits your keybindings

While recording is on, the plugin adds its four `alt+` shortcuts to `~/.claude/keybindings.json` (or `$CLAUDE_CONFIG_DIR/keybindings.json`). Turning it off removes them again. It never overwrites a key that is already bound to something else: it skips that key and tells you. A file that isn't valid JSON is left alone.

**Before you uninstall,** run `/qa-toggle` to turn it off, so the shortcuts are removed. Otherwise delete the `command:qa-toggle`, `command:qa-testme`, `command:qa-clear` and `command:qa-ask` lines from that file by hand.

## Limits

- Ask and Explain need a surface that reports the mouse selection: the terminal in fullscreen mode. The desktop band leaves them out; `/qa-ask` and `/qa-explain` there say "Select some text first."

- A request phrased as a question ("Can you fix the tests?") is recorded too. One starting with *do* is not.
- A question whose turn ends with no text (interrupted, an error) shows *(no answer)*.
- The history keeps the last 100 questions. A very long history is cut to its newest cards (about 60,000 characters) before quizzing.
- Questions and answers stay on your machine. The quiz and the follow-up check send the question and answer to Claude's small model.

## Development

```
claude plugin test .
claude plugin validate .
```

## License

[MIT](LICENSE)
