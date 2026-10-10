import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Entry, FollowUp, Quiz, QuizItem, RelatedQuestion } from '../types'
import type { QuestionToggleProps } from './questionToggle'
import type { QuizKeysProps } from './quizKeys'

const HISTORY_PANE = 'qa-history'
const QUIZ_PANE = 'qa-testme'
const QUIZ_KEYS = 'quiz-keys'
const TOGGLE_PREFIX = 'toggle-'
const entries = atom({ plugin: 'qa-history', key: 'entries' } as const, [])
const quiz = atom({ plugin: 'qa-history', key: 'quiz' } as const, null)
const quizStatus = atom({ plugin: 'qa-history', key: 'quizStatus' } as const, '')
const hiddenAnswerIds = atom({ plugin: 'qa-history', key: 'hiddenAnswerIds' } as const, [])
const isEnabled = atom({ plugin: 'qa-history', key: 'isEnabled' } as const, true)
const isConfirmingClear = atom({ plugin: 'qa-history', key: 'isConfirmingClear' } as const, false)
const isBandHidden = atom({ plugin: 'qa-history', key: 'isBandHidden' } as const, false)
const TOGGLE_SHORTCUT = 'alt+q' // bound to /qa-toggle in ~/.claude/keybindings.json while on
const QUIZ_SHORTCUT = 'alt+t' // bound to /qa-testme there
const CLEAR_SHORTCUT = 'alt+c' // bound to /qa-clear there
const ASK_SHORTCUT = 'alt+s' // bound to /qa-ask there

// How Ask starts the draft; a prompt starting so is recorded even when it doesn't read as a question.
const ASK_PREFIX = 'About "'
const EXPLAIN_PREFIX = 'Explain this: '

// Prompts the person typed (terminal, desktop app, remote); not plugin or task prompts.
const PERSON_ORIGINS = ['composer', 'sdk', 'bridge']

// Theme keys, so cards follow the person's light or dark theme.
const CARD_COLORS = ['claude', 'suggestion', 'merged', 'permission', 'planMode', 'ide'] as const

// "do" is left out: "Do the migration" is a request far more often than a question.
export function isQuestion(text: string): boolean {
  const trimmedText = text.trim()
  return trimmedText.endsWith('?') || /^(how|where|when|why|what|which|who|is|are|can|could|does|should|would)\b/i.test(trimmedText)
}

// Settles a question whose turn ended with no text (interrupted, an error, tools only), so the next reply can't land on it;
// also what a skipped AskUserQuestion question is saved with.
export const NO_ANSWER = '(no answer)'

const QUIZ_ITEMS_PER_QUESTION = 3
const QUIZ_ITEMS_MAX = 60
const QUIZ_TOKENS_PER_ITEM = 250 // room for one quiz question with its 4 options in the JSON reply

export function quizItemCount(questionCount: number): number {
  return Math.min(QUIZ_ITEMS_MAX, questionCount * QUIZ_ITEMS_PER_QUESTION)
}

function quizPrompt(itemCount: number): string {
  return `Write a multiple-choice quiz that checks whether the learner understood the questions and answers below.
Reply with JSON only, no code fence: {"items":[{"question":"...","options":["...","...","...","..."],"correct":0}]}
${itemCount} questions, 4 options each, "correct" is the 0-based index of the right option. Vary the position of the right option.
Cover every one of the learner's questions as evenly as you can, about ${QUIZ_ITEMS_PER_QUESTION} quiz questions for each.

`
}

export function rating(score: number, total: number): string {
  const ratio = total === 0 ? 0 : score / total
  if (ratio === 1) return 'Excellent: you nailed it'
  if (ratio >= 0.8) return 'Great: solid understanding'
  if (ratio >= 0.6) return 'Good: a few gaps to review'
  if (ratio >= 0.4) return 'Fair: worth rereading the answer'
  return 'Needs work: go over it again'
}

export function parseQuizItems(text: string): QuizItem[] {
  const json = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)
  const items = (JSON.parse(json) as { items: QuizItem[] }).items
  return items.filter(
    item =>
      typeof item.question === 'string' &&
      Array.isArray(item.options) &&
      item.options.length >= 2 &&
      Number.isInteger(item.correct) &&
      item.correct >= 0 &&
      item.correct < item.options.length,
  )
}

function followUpsText(followUps: FollowUp[]): string {
  return followUps.map(followUp => `Follow-up question: ${followUp.question}\nLearner's answer: ${followUp.answer}`).join('\n')
}

function transcriptOf(entry: Entry): string {
  const followUps = followUpsText(entry.followUps)
  const relatedQuestions = (entry.relatedQuestions ?? [])
    .map(related => `Learner then asked: ${related.question}\n${followUpsText(related.followUps ?? [])}\nAnswer given: ${related.answer}`)
    .join('\n')
  return `Learner asked: ${entry.question}\n${followUps}\nAnswer given: ${entry.answer}\n${relatedQuestions}`
}

// shortcut: only the newest cards that fit in this many characters go to the model, so a long history loses its oldest
// cards first; raise it, or summarize old cards, if quizzes should reach back further.
const QUIZ_TRANSCRIPT_LIMIT = 60_000

// The answered cards for the quiz, newest kept first when the history is too long; oldest first in the text.
// questionCount: the person's questions in it, a card's own and its related ones.
export function quizTranscript(list: Entry[]): { transcript: string; questionCount: number } {
  let transcript = ''
  let questionCount = 0
  for (const entry of list.filter(entry => entry.answer !== '' && entry.answer !== NO_ANSWER).toReversed()) {
    const entryText = transcriptOf(entry).slice(0, QUIZ_TRANSCRIPT_LIMIT) // so even one huge card fits
    if (transcript.length + entryText.length > QUIZ_TRANSCRIPT_LIMIT) break
    transcript = `${entryText}\n\n${transcript}`
    questionCount += 1 + (entry.relatedQuestions ?? []).length
  }
  return { transcript, questionCount }
}

// Changes the newest question still waiting for its answer: the last card's own, else its newest related one.
function withWaitingQuestion(
  list: Entry[],
  change: (waitingQuestion: RelatedQuestion) => { answer: string } | { followUps: FollowUp[] },
): Entry[] {
  const lastEntry = list.at(-1)
  if (lastEntry === undefined) return list
  const relatedQuestions = lastEntry.relatedQuestions ?? []
  const lastRelated = relatedQuestions.at(-1)
  if (lastEntry.answer === '') return [...list.slice(0, -1), { ...lastEntry, ...change(lastEntry) }]
  if (lastRelated === undefined || lastRelated.answer !== '') return list
  const changedRelated = { ...lastRelated, ...change(lastRelated) }
  return [...list.slice(0, -1), { ...lastEntry, relatedQuestions: [...relatedQuestions.slice(0, -1), changedRelated] }]
}

export function withAnswer(list: Entry[], answer: string): Entry[] {
  return withWaitingQuestion(list, () => ({ answer }))
}

// What Claude asked back goes to the same question withAnswer would answer, so a merged follow-up keeps it too.
export function withFollowUps(list: Entry[], followUps: FollowUp[]): Entry[] {
  return withWaitingQuestion(list, waitingQuestion => ({ followUps: [...(waitingQuestion.followUps ?? []), ...followUps] }))
}

// Moves a card (with its answer, if it already has one) under another as a related question.
export function mergedInto(list: Entry[], targetId: string, movedId: string): Entry[] {
  const movedEntry = list.find(entry => entry.id === movedId)
  if (movedEntry === undefined || !list.some(entry => entry.id === targetId)) return list
  const movedQuestions = [
    { question: movedEntry.question, answer: movedEntry.answer, followUps: movedEntry.followUps },
    ...(movedEntry.relatedQuestions ?? []),
  ]
  return list
    .filter(entry => entry.id !== movedId)
    .map(entry =>
      entry.id === targetId
        ? { ...entry, relatedQuestions: [...(entry.relatedQuestions ?? []), ...movedQuestions] }
        : entry,
    )
}

// Asks the small model whether the question builds on the card's latest answer; false when unsure.
async function isFollowUp($: EngineInterface, previousEntry: Entry, question: string): Promise<boolean> {
  const latestAnswer = (previousEntry.relatedQuestions ?? []).at(-1)?.answer ?? previousEntry.answer
  const text =
    `Previous question: ${previousEntry.question}\n` +
    `Previous answer: ${latestAnswer.slice(0, 2000)}\n` +
    `New question: ${question}\n` +
    'Is the new question a follow-up that builds on the previous answer, or a new topic?'
  try {
    return (await $.model.classify(text, ['follow-up', 'new-topic'])) === 'follow-up'
  } catch {
    return false
  }
}

// Records an answer only for the question still on screen, so a double press can't skip one.
function pickOption($: EngineInterface, questionIndex: number, optionIndex: number) {
  return update($, quiz, saved =>
    saved === null ||
    saved.picks.length !== questionIndex ||
    optionIndex < 0 ||
    optionIndex >= (saved.items[questionIndex]?.options.length ?? 0)
      ? saved
      : { ...saved, picks: [...saved.picks, optionIndex] },
  )
}

// Adds a question as a card, then merges it under the previous card if it builds on that card's answer.
async function recordQuestion($: EngineInterface, question: string): Promise<void> {
  const previousEntry = (await read($, entries)).at(-1)
  const entry: Entry = { id: crypto.randomUUID(), question, answer: '', followUps: [] }
  // Added at once and merged after the check, so an answer that lands first is kept.
  await update($, entries, list => [...list, entry].slice(-100))
  if (previousEntry !== undefined && previousEntry.answer !== '' && previousEntry.answer !== NO_ANSWER && (await isFollowUp($, previousEntry, question))) {
    await update($, entries, list => mergedInto(list, previousEntry.id, entry.id))
  }
}

// The text the person last selected with the mouse, or undefined when there is none (or the surface reports none).
async function selectedText($: EngineInterface): Promise<string | undefined> {
  return (await $.ui.selection())?.text.trim() || undefined
}

const NO_SELECTION = 'Select some text first.'

// Ask: starts a draft about the selection for the person to finish; it is recorded when they send it.
async function askAboutSelection($: EngineInterface): Promise<string> {
  const text = await selectedText($)
  if (text === undefined) return NO_SELECTION
  const { isFilled } = await $.prompt.fill({ text: `${ASK_PREFIX}${text}": ` })
  return isFilled ? 'Type your question about the selection and press Enter.' : 'Could not fill the prompt box.'
}

// Explain: "Explain this: <selection>", or undefined with nothing selected.
async function explainQuestion($: EngineInterface): Promise<string | undefined> {
  const text = await selectedText($)
  return text === undefined ? undefined : EXPLAIN_PREFIX + text
}

// A plugin's own prompt skips the person-only recording in prompt.submit, so the card is added here first.
async function sendExplain($: EngineInterface, question: string): Promise<void> {
  if (await read($, isEnabled)) await recordQuestion($, question)
  $.prompt.submit({ text: question, asUser: true }).catch(() => $.ui.toast('Q&A history: could not send the question'))
}

// /qa-explain's question: its command.run hook holds a turn and may not submit, so turn.complete sends it.
let queuedExplainQuestion: string | undefined

// Folds or unfolds one answer in the history ('<card id>' or '<card id>:<related index>').
function toggleAnswer($: EngineInterface, answerId: string) {
  return update($, hiddenAnswerIds, ids => (ids.includes(answerId) ? ids.filter(id => id !== answerId) : [...ids, answerId]))
}

// The plugin's own keys: added to keybindings.json while on, removed while off, so other plugins can take them.
const QA_BINDINGS: Record<string, string> = {
  [TOGGLE_SHORTCUT]: 'command:qa-toggle',
  [QUIZ_SHORTCUT]: 'command:qa-testme',
  [CLEAR_SHORTCUT]: 'command:qa-clear',
  [ASK_SHORTCUT]: 'command:qa-ask',
}
type KeybindingsFile = { bindings?: { context?: string; bindings?: Record<string, string> }[] }

// Adds or removes QA_BINDINGS in the file's text; a key already bound to something else is skipped, never overwritten.
// Nothing to add or remove: the text comes back as it was, so the person's formatting is kept and no file is created.
export function withQaBindings(fileText: string, isOn: boolean): { text: string; skippedKeys: string[] } {
  const file = (fileText.trim() === '' ? {} : JSON.parse(fileText)) as KeybindingsFile
  const blocks = (file.bindings ??= [])
  const skippedKeys: string[] = []
  let isChanged = false
  if (isOn) {
    let chatBlock = blocks.find(block => block.context === 'Chat')
    if (chatBlock === undefined) blocks.push((chatBlock = { context: 'Chat', bindings: {} }))
    const chatBindings = (chatBlock.bindings ??= {})
    for (const [key, action] of Object.entries(QA_BINDINGS)) {
      const boundAction = blocks.map(block => block.bindings?.[key]).find(found => found !== undefined)
      if (boundAction === undefined) {
        chatBindings[key] = action
        isChanged = true
      } else if (boundAction !== action) skippedKeys.push(key)
    }
  } else {
    for (const block of blocks) {
      for (const [key, action] of Object.entries(QA_BINDINGS)) {
        if (block.bindings?.[key] === action) {
          delete block.bindings[key]
          isChanged = true
        }
      }
    }
  }
  return { text: isChanged ? JSON.stringify(file, null, 2) + '\n' : fileText, skippedKeys }
}

// Brings ~/.claude/keybindings.json in line with on/off; a file it can't read as JSON is left alone.
async function syncKeybindings($: EngineInterface, isOn: boolean): Promise<void> {
  let path = 'keybindings.json'
  try {
    const configDir = (await $.env.get('CLAUDE_CONFIG_DIR')) ?? `${await $.env.get('HOME')}/.claude`
    path = `${configDir}/keybindings.json`
    const fileText = (await $.fs.exists(path)) ? await $.fs.read(path) : ''
    const { text, skippedKeys } = withQaBindings(fileText, isOn)
    if (text !== fileText) await $.fs.write(path, text)
    if (skippedKeys.length > 0) $.ui.toast(`Q&A history: ${skippedKeys.join(', ')} already taken, left as is`)
  } catch {
    $.ui.toast(`Q&A history: could not update ${path}`)
  }
}

// Off: questions are no longer recorded, the history pane closes and the shortcuts are freed; saved history stays.
async function toggleEnabled($: EngineInterface): Promise<boolean> {
  const isNowEnabled = await update($, isEnabled, wasEnabled => !wasEnabled)
  await $.store.set('isEnabled', isNowEnabled)
  await syncKeybindings($, isNowEnabled)
  if (isNowEnabled) await $.ui.open({ id: HISTORY_PANE, title: 'Q&A history' })
  else await $.ui.close({ id: HISTORY_PANE })
  $.ui.toast(`Q&A history ${isNowEnabled ? 'on' : 'off'}`)
  return isNowEnabled
}

// Two presses (button, c or alt+c), so a stray one can't wipe the history; resolves the line to show.
async function clearHistory($: EngineInterface): Promise<string> {
  if (await update($, isConfirmingClear, wasConfirming => !wasConfirming)) return `Press Clear or ${CLEAR_SHORTCUT} again to clear the history.`
  await update($, entries, () => [])
  await update($, hiddenAnswerIds, () => [])
  $.ui.toast('Q&A history cleared')
  return 'Q&A history cleared.'
}

// Quizzes the person on the whole Q&A history; resolves the line to show. Off: refuses, so alt+t does nothing.
async function startQuiz($: EngineInterface): Promise<string> {
  if (!(await read($, isEnabled))) return 'Q&A history is off: turn it on to take a quiz.'
  const { transcript, questionCount } = quizTranscript(await read($, entries))
  if (questionCount === 0) return 'Nothing to test yet: ask a question first.'

  await update($, quiz, () => null)
  await update($, quizStatus, () => 'Writing your quiz…')
  await $.ui.open({ id: QUIZ_PANE, title: 'Test me', focus: true, closeOnEscape: true })

  const itemCount = quizItemCount(questionCount)
  const completion = await $.model.complete({
    model: 'haiku',
    prompt: quizPrompt(itemCount) + transcript,
    maxTokens: Math.max(2048, itemCount * QUIZ_TOKENS_PER_ITEM),
  })
  let items: QuizItem[] = []
  if (completion.isAnswered) {
    try {
      items = parseQuizItems(completion.text)
    } catch {
      items = []
    }
  }
  if (items.length === 0) {
    await update($, quizStatus, () => 'Could not write a quiz. Run /qa-testme again.')
    return 'The quiz could not be written.'
  }
  const newQuiz: Quiz = { items, picks: [] }
  await update($, quiz, () => newQuiz)
  await update($, quizStatus, () => '')

  return `Quiz of ${items.length} on ${questionCount === 1 ? 'your 1 question' : `your ${questionCount} questions`} opened.`
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'qa-testme',
      description: 'Quiz yourself on your whole Q&A history and get rated',
    })
    await $.command.register({
      name: 'qa-history',
      description: 'Show the history of your questions and answers',
    })
    await $.command.register({
      name: 'qa-clear',
      description: `Clear the Q&A history; run twice to confirm (${CLEAR_SHORTCUT})`,
    })
    await $.command.register({
      name: 'qa-ask',
      description: `Start a question about the text you selected (${ASK_SHORTCUT})`,
    })
    await $.command.register({
      name: 'qa-explain',
      description: 'Ask Claude to explain the text you selected',
    })
    await $.command.register({
      name: 'qa-toggle',
      description: `Turn Q&A history recording on or off (${TOGGLE_SHORTCUT})`,
    })
    // on/off outlives the session, as the keybindings it adds or removes do
    const storedEnabled = (await $.store.get('isEnabled')) !== false
    await update($, isEnabled, () => storedEnabled)
    // a fresh install is on but has no shortcuts yet; off already removed them when it was turned off
    if (storedEnabled) await syncKeybindings($, true)
    if (storedEnabled) void $.ui.open({ id: HISTORY_PANE, title: 'Q&A history' })

    return next(e)
  })

  on('command.run', { command: 'qa-history' }, async $ => {
    await $.ui.open({ id: HISTORY_PANE, title: 'Q&A history' })
    await update($, isBandHidden, () => false)

    return { text: 'Q&A history opened.' }
  })

  on('command.run', { command: 'qa-toggle' }, async $ => ({
    text: `Q&A history ${(await toggleEnabled($)) ? 'on' : 'off'}.`,
  }))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || (await read($, isBandHidden))) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const isOn = await read($, isEnabled)
    const isConfirming = await read($, isConfirmingClear)

    return (
      <Box gap={1} width="100%">
        <Text dimColor>{`Q&A history: ${isOn ? 'on' : 'off'}`}</Text>
        <Button key="qa-toggle" label={isOn ? 'Turn off' : 'Turn on'} variant="secondary" hotkey="q" onPress={() => toggleEnabled($)} />
        <Button
          key="qa-quiz"
          label="Quiz me"
          variant="secondary"
          hotkey={isOn ? 't' : undefined}
          onPress={async () => $.ui.toast(await startQuiz($))}
        />
        <Button key="qa-clear" label={isConfirming ? 'Really clear?' : 'Clear'} variant="secondary" hotkey={isOn ? 'c' : undefined} onPress={() => clearHistory($)} />
        <Button key="qa-ask" label="Ask" variant="secondary" hotkey={isOn ? 'a' : undefined} onPress={async () => $.ui.toast(await askAboutSelection($))} />
        <Button
          key="qa-explain"
          label="Explain"
          variant="secondary"
          hotkey={isOn ? 'e' : undefined}
          onPress={async () => {
            const question = await explainQuestion($)
            if (question === undefined) $.ui.toast(NO_SELECTION)
            else await sendExplain($, question)
          }}
        />
        {isConfirming && <Button key="qa-clear-cancel" label="Keep" variant="secondary" onPress={() => update($, isConfirmingClear, () => false)} />}
        {/* keybindings.json chords reach the terminal only; elsewhere q works once the band has the focus */}
        <Text dimColor>{e.surface === 'terminal' ? (isOn ? `${TOGGLE_SHORTCUT} toggle, ${QUIZ_SHORTCUT} quiz, ${CLEAR_SHORTCUT} clear, ${ASK_SHORTCUT} ask` : 'shortcuts off') : 'click the band for keyboard control'}</Text>
        <Box flexGrow={1} />
        {/* plain one-glyph label: drawn as a bare cross */}
        <Button key="qa-band-close" label="✕" plain role="dismiss" onPress={() => update($, isBandHidden, () => true)} />
      </Box>
    )
  })

  on('prompt.submit', async ($, e, next) => {
    const result = await next(e)
    // Any message cancels a pending clear, so a stray press much later can't wipe the history; /qa-clear itself keeps it.
    if (!e.text.trimStart().startsWith('/')) await update($, isConfirmingClear, () => false)
    const isAsked = isQuestion(e.text) || e.text.trimStart().startsWith(ASK_PREFIX)
    if (PERSON_ORIGINS.includes(e.origin.kind) && isAsked && !('drop' in result) && (await read($, isEnabled))) {
      await recordQuestion($, e.text.trim())
    }

    return result
  }).catch(($, e, next) => next(e)) // a failed record never blocks the prompt

  on('tool.call', { tool: 'AskUserQuestion' }, async ($, e, next) => {
    const result = await next(e)
    if ('deny' in result || result.isError || e.agentId !== undefined) return result
    const answers = (result.result as { answers?: Record<string, string> }).answers ?? {}
    const followUps = e.questions.map(asked => ({
      question: asked.question,
      answer: answers[asked.question] ?? NO_ANSWER,
    }))
    await update($, entries, list => withFollowUps(list, followUps))

    return result
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      await update($, entries, list => withAnswer(list, e.answer.trim() || NO_ANSWER))
      const question = queuedExplainQuestion
      queuedExplainQuestion = undefined
      if (question !== undefined) await sendExplain($, question) // after withAnswer, so this turn can't answer its card
    }

    return next(e)
  })

  on('command.run', { command: 'qa-testme' }, async $ => ({ text: await startQuiz($) }))

  on('command.run', { command: 'qa-ask' }, async $ => ({ text: await askAboutSelection($) }))

  on('command.run', { command: 'qa-explain' }, async $ => {
    queuedExplainQuestion = await explainQuestion($)
    return { text: queuedExplainQuestion === undefined ? NO_SELECTION : 'Explaining the selection.' }
  })

  on('command.run', { command: 'qa-clear' }, async $ => ({
    text: (await read($, isEnabled)) ? await clearHistory($) : 'Q&A history is off: turn it on to clear it.',
  }))

  on('ui.render', { component: 'Pane', requestId: HISTORY_PANE }, async ($, e) => {
    const elements = $.ui.resolve(e)
    const { Box, Button, Text, Markdown } = elements
    const list = await read($, entries)
    const hiddenIds = await read($, hiddenAnswerIds)
    // A clickable question line: a Client keeps its colors; a surface without one gets a plain Button.
    const questionLine = (answerId: string, toggleProps: QuestionToggleProps) =>
      'Client' in elements ? (
        <elements.Client
          key={TOGGLE_PREFIX + answerId}
          module="./questionToggle.tsx"
          props={toggleProps}
          width="100%"
        />
      ) : (
        <Button key={TOGGLE_PREFIX + answerId} plain onPress={() => toggleAnswer($, answerId)}>
          {toggleProps.label}
        </Button>
      )

    return (
      <Box flexDirection="column" gap={1}>
        {list.length === 0 && <Text dimColor>Ask something and it shows up here.</Text>}
        {list
          .map((entry, entryIndex) => ({ entry, cardColor: CARD_COLORS[entryIndex % CARD_COLORS.length] ?? CARD_COLORS[0] }))
          .reverse()
          .map(({ entry, cardColor }) => (
            <Box key={entry.id} flexDirection="column" borderStyle="round" borderColor={cardColor} paddingX={1}>
              <Box marginBottom={hiddenIds.includes(entry.id) ? 0 : 1}>
                {questionLine(entry.id, {
                  label: `${hiddenIds.includes(entry.id) ? ' ▸' : ' ▾'} Q: ${entry.question} `,
                  color: cardColor,
                  isBand: true,
                })}
              </Box>
              {!hiddenIds.includes(entry.id) &&
                entry.followUps.map(followUp => (
                  <Text color={cardColor}>
                    ↳ {followUp.question} → {followUp.answer}
                  </Text>
                ))}
              {hiddenIds.includes(entry.id) ? null : entry.answer === '' ? (
                <Text dimColor>Answering…</Text>
              ) : (
                <Markdown text={entry.answer} />
              )}
              {(entry.relatedQuestions ?? []).map((related, relatedIndex) => {
                const relatedId = `${entry.id}:${relatedIndex}`
                const isHidden = hiddenIds.includes(relatedId)
                return (
                  <Box flexDirection="column" marginTop={1}>
                    <Box marginBottom={isHidden ? 0 : 1}>
                      {questionLine(relatedId, {
                        label: `${isHidden ? '▸' : '▾'} ↳ Q: ${related.question}`,
                        color: cardColor,
                        isBand: false,
                      })}
                    </Box>
                    {!isHidden &&
                      (related.followUps ?? []).map(followUp => (
                        <Text color={cardColor}>
                          ↳ {followUp.question} → {followUp.answer}
                        </Text>
                      ))}
                    {isHidden ? null : related.answer === '' ? (
                      <Text dimColor>Answering…</Text>
                    ) : (
                      <Markdown text={related.answer} />
                    )}
                  </Box>
                )
              })}
            </Box>
          ))}
      </Box>
    )
  })

  on('ui.message', { requestId: HISTORY_PANE }, async ($, e, next) => {
    if (e.element.startsWith(TOGGLE_PREFIX)) await toggleAnswer($, e.element.slice(TOGGLE_PREFIX.length))

    return next(e)
  })

  on('ui.message', { requestId: QUIZ_PANE, element: QUIZ_KEYS }, async ($, e, next) => {
    const message = e.data as Partial<{ questionIndex: unknown; optionIndex: unknown }>
    if (Number.isInteger(message.questionIndex) && Number.isInteger(message.optionIndex)) {
      await pickOption($, message.questionIndex as number, message.optionIndex as number)
    }

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: QUIZ_PANE }, async ($, e) => {
    const elements = $.ui.resolve(e)
    const { Box, Text, Button } = elements
    const Client = 'Client' in elements ? elements.Client : Box
    const current = await read($, quiz)
    const status = await read($, quizStatus)
    if (current === null) return <Text dimColor>{status}</Text>

    const index = current.picks.length
    const item = current.items[index]
    if (item !== undefined) {
      return (
        <Box flexDirection="column" gap={1}>
          <Text dimColor>
            Question {index + 1} of {current.items.length}
          </Text>
          <Box borderStyle="double" borderColor="claude" paddingX={2} paddingY={1}>
            <Text bold color="claude">
              {item.question}
            </Text>
          </Box>
          {e.surface === 'terminal' || e.surface === 'desktop' ? (
            // One key across questions, so the focus a click gave it stays for the next one.
            <Client
              key={QUIZ_KEYS}
              module="./quizKeys.tsx"
              props={{ questionIndex: index, options: item.options } satisfies QuizKeysProps}
            />
          ) : (
            item.options.map((option, optionIndex) => (
              <Button
                key={`q${index}-o${optionIndex}`}
                label={option}
                hotkey={String(optionIndex + 1)}
                plain
                onPress={() => pickOption($, index, optionIndex)}
              />
            ))
          )}
        </Box>
      )
    }

    const score = current.items.filter((item, itemIndex) => current.picks[itemIndex] === item.correct).length
    return (
      <Box flexDirection="column">
        <Text bold>
          Score: {score}/{current.items.length}. {rating(score, current.items.length)}
        </Text>
        {current.items.map((item, itemIndex) => {
          const isRight = current.picks[itemIndex] === item.correct
          return (
            <Box flexDirection="column" marginTop={1}>
              <Text>
                {isRight ? '✓' : '✗'} {item.question}
              </Text>
              {!isRight && <Text dimColor>You: {item.options[current.picks[itemIndex] ?? -1]}</Text>}
              <Text dimColor>Right: {item.options[item.correct]}</Text>
            </Box>
          )
        })}
        <Button key="close" label="Close" role="dismiss" onPress={() => $.ui.close({ id: QUIZ_PANE })} />
      </Box>
    )
  })
}
