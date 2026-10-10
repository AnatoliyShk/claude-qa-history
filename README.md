# qa-history

A Claude Code plugin that keeps your questions and Claude's answers in a side pane, and quizzes you on the last one.

- **History pane:** every prompt you type that ends with *?* or starts with a question word (*how, what, why, which, can, does, should*…) becomes a card with Claude's answer. A follow-up that builds on the previous answer is grouped under that card. Click a question to fold its answer.
- **Quiz:** `/qa-testme` writes a 5-question multiple-choice quiz on your last answered question (using Haiku) and rates your score.
- **Band above the prompt:** turn recording on or off, start a quiz, or clear the history. The ✕ hides it until you run `/qa-history`.

## Install

```
/plugin marketplace add AnatoliyShk/qa-history
/plugin install qa-history@qa-history
```

## Commands and shortcuts

| Command | Shortcut | What it does |
|---|---|---|
| `/qa-history` | | Open the history pane and bring back the band |
| `/qa-testme` | `alt+t` | Quiz yourself on your last question |
| `/qa-toggle` | `alt+q` | Turn recording on or off |
| `/qa-clear` | `alt+c` | Clear the history (run twice to confirm) |

In the desktop app, click the band once, then use `q`, `t` and `c`. In the quiz, click the options box once, then press `1`–`9`.

## It edits your keybindings

While recording is on, the plugin adds the three `alt+` shortcuts to `~/.claude/keybindings.json` (or `$CLAUDE_CONFIG_DIR/keybindings.json`). Turning it off removes them again. It never overwrites a key that is already bound to something else: it skips that key and tells you. A file that isn't valid JSON is left alone.

**Before you uninstall,** run `/qa-toggle` to turn it off, so the shortcuts are removed. Otherwise delete the `command:qa-toggle`, `command:qa-testme` and `command:qa-clear` lines from that file by hand.

## Limits

- A request phrased as a question ("Can you fix the tests?") is recorded too. One starting with *do* is not.
- A question whose turn ends with no text (interrupted, an error) shows *(no answer)*.
- The history keeps the last 100 questions.
- Questions and answers stay on your machine. The quiz and the follow-up check send the question and answer to Claude's small model.

## Development

```
claude plugin test .
claude plugin validate .
```

## License

[MIT](LICENSE)
