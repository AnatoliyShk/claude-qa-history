import { expect, test } from 'claude-code/testing'

import { isQuestion, mergedInto, parseQuizItems, quizItemCount, quizTranscript, rating, withAnswer, withFollowUps, withQaBindings } from '../hooks/register'

const paneProps = (title: string) => ({
  title,
  isFocused: true,
  bodyColumns: 60,
  placement: 'dock' as const,
  scroll: { offset: 0, bodyRows: 40 },
  view: {},
})

const QUIZ_JSON = JSON.stringify({
  items: [
    { question: 'Q one?', options: ['a', 'b', 'c', 'd'], correct: 1 },
    { question: 'Q two?', options: ['a', 'b', 'c', 'd'], correct: 0 },
    { question: 'Bad', options: ['a', 'b'], correct: 5 },
  ],
})

test('parses quiz JSON and drops invalid items', () => {
  expect(parseQuizItems('Sure:\n' + QUIZ_JSON).length).toBe(2)
  expect(rating(2, 2)).toBe('Excellent: you nailed it')
  expect(rating(0, 2)).toBe('Needs work: go over it again')
  expect(isQuestion('  Where is JSX used')).toBe(true)
  expect(isQuestion('why not?')).toBe(true)
  expect(isQuestion('What is the diff with rust')).toBe(true)
  expect(isQuestion('Is it fast?')).toBe(true)
  expect(isQuestion('Isolate the bug')).toBe(false)
  expect(isQuestion('Which one')).toBe(true)
  expect(isQuestion('Can I push a plugin?')).toBe(true)
  expect(isQuestion('copy the plugin, ok?')).toBe(true) // ends with "?"
  expect(isQuestion('Do the migration')).toBe(false)
  expect(isQuestion('Show me how')).toBe(false)
  expect(isQuestion('Howdy')).toBe(false)
})

test('toggling adds and removes only its own keybindings', () => {
  const userFile = JSON.stringify({
    $schema: 'x',
    bindings: [{ context: 'Chat', bindings: { 'alt+a': 'command:tracker-agents', 'alt+c': 'command:other' } }],
  })
  const turnedOn = withQaBindings(userFile, true)
  expect(turnedOn.skippedKeys).toEqual(['alt+c']) // taken by another command: left alone
  expect(JSON.parse(turnedOn.text).bindings[0].bindings).toEqual({
    'alt+a': 'command:tracker-agents',
    'alt+c': 'command:other',
    'alt+q': 'command:qa-toggle',
    'alt+t': 'command:qa-testme',
    'alt+s': 'command:qa-ask',
  })
  const turnedOff = withQaBindings(turnedOn.text, false)
  expect(JSON.parse(turnedOff.text)).toEqual(JSON.parse(userFile))
  expect(withQaBindings(turnedOn.text, true).text).toBe(turnedOn.text) // already on: unchanged
  expect(JSON.parse(withQaBindings('', true).text).bindings[0].context).toBe('Chat') // no file yet
  expect(() => withQaBindings('{ not json', false)).toThrow()
  // nothing to add or remove: the person's own formatting is kept, and no file is made while off
  const handFormatted = '{\n    "bindings": []\n}'
  expect(withQaBindings(handFormatted, false).text).toBe(handFormatted)
  expect(withQaBindings('', false).text).toBe('')
})

test('a follow-up answered before the check finishes keeps its answer', () => {
  const original = { id: 'a', question: 'How?', answer: 'Like this.', followUps: [] }
  const pending = { id: 'b', question: 'Why?', answer: '', followUps: [] }
  const answered = withAnswer([original, pending], 'Because.')
  const merged = mergedInto(answered, 'a', 'b')
  expect(merged.length).toBe(1)
  expect(merged[0]?.relatedQuestions).toEqual([{ question: 'Why?', answer: 'Because.', followUps: [] }])
  // and one merged first gets its answer under the original card
  const answeredLater = withAnswer(mergedInto([original, pending], 'a', 'b'), 'Because.')
  expect(answeredLater).toEqual(merged)
})

test('what Claude asks back lands on the waiting question, merged or not', () => {
  const original = { id: 'a', question: 'How?', answer: 'Like this.', followUps: [] }
  const pending = { id: 'b', question: 'Why?', answer: '', followUps: [] }
  const asked = [{ question: 'Which part?', answer: 'The end' }]
  // asked after the merge: goes under the related question, not dropped
  const mergedFirst = withFollowUps(mergedInto([original, pending], 'a', 'b'), asked)
  expect(mergedFirst[0]?.relatedQuestions?.[0]?.followUps).toEqual(asked)
  expect(mergedFirst[0]?.followUps).toEqual([])
  // asked before the merge: carried along with the card
  expect(mergedInto(withFollowUps([original, pending], asked), 'a', 'b')).toEqual(mergedFirst)
  // nothing waiting: ignored
  expect(withFollowUps([original], asked)).toEqual([original])
})

test('a long history is cut to its newest cards for the quiz', () => {
  const card = (id: string, answer: string) => ({ id, question: `Q ${id}?`, answer, followUps: [] })
  const longAnswer = 'x'.repeat(25_000)
  const { transcript, questionCount } = quizTranscript([
    card('old', longAnswer),
    card('skipped', '(no answer)'),
    card('mid', longAnswer),
    card('new', longAnswer),
  ])
  expect(questionCount).toBe(2) // a third 25k card would pass 60k
  expect(transcript).toMatch(/Q mid\?[\s\S]*Q new\?/)
  expect(transcript).not.toMatch(/Q old|Q skipped/)
  const hugeCard = quizTranscript([card('huge', 'x'.repeat(90_000))])
  expect(hugeCard.questionCount).toBe(1) // one card always goes, cut to the limit
  expect(hugeCard.transcript.length).toBeLessThanOrEqual(60_002)
  expect(quizTranscript([card('waiting', '')]).questionCount).toBe(0)
  expect(quizItemCount(1)).toBe(3)
  expect(quizItemCount(20)).toBe(60)
  expect(quizItemCount(25)).toBe(60) // capped
})

test('Ask and Explain work on the selected text and land in the history', async ($, on) => {
  const submitted: { text: string; kind: string }[] = []
  on('prompt.submit', (_$, e) => {
    submitted.push({ text: e.text, kind: e.origin.kind })
    return { text: e.text }
  })
  const filled: string[] = []
  on('prompt.fill', (_$, e) => {
    filled.push(e.text)
    return { isFilled: true }
  })
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  const toasts: string[] = []
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  let selection: { text: string } | undefined
  on('ui.selection', () => ({ value: selection }))
  const run = (command: string) =>
    $.command.run({ command, args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 80 } })

  expect((await run('qa-ask')).text).toBe('Select some text first.')
  expect((await run('qa-explain')).text).toBe('Select some text first.')
  expect(filled).toEqual([])

  selection = { text: '  a closure keeps its scope \n' }
  await run('qa-ask')
  expect(filled).toEqual(['About "a closure keeps its scope": '])
  // what the person then sends is recorded, though it isn't phrased as a question
  await $.prompt.submit({ text: 'About "a closure keeps its scope": give an example', wait: false, origin: { kind: 'composer' } })

  // /qa-explain sends once its own turn is over
  await run('qa-explain')
  expect(submitted.length).toBe(1)
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  expect(submitted.at(-1)).toEqual({ text: 'Explain this: a closure keeps its scope', kind: 'plugin' })

  // the band's Explain sends at once
  selection = { text: 'hoisting' }
  const bandProps = { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 80, scroll: { offset: 0, bodyRows: 10 }, view: {} }
  const band = await $.ui.mount({ plugin: 'qa-history', surface: 'desktop', component: 'AbovePrompt', props: bandProps })
  await band.press({ key: 'qa-explain' })
  expect(submitted.at(-1)).toEqual({ text: 'Explain this: hoisting', kind: 'plugin' })
  selection = undefined
  await band.press({ key: 'qa-explain' })
  expect(toasts.at(-1)).toBe('Select some text first.')

  const history = await $.ui.mount({
    plugin: 'qa-history',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'qa-history',
    props: paneProps('Q&A history'),
  })
  const questionLabels = (await history.findAll({ type: 'Client' })).map(toggle => (toggle.props.props as { label: string }).label)
  expect(questionLabels).toEqual([
    ' ▾ Q: Explain this: hoisting ',
    ' ▾ Q: Explain this: a closure keeps its scope ',
    ' ▾ Q: About "a closure keeps its scope": give an example ',
  ]) // newest first, recorded once each
})

test('a fresh install binds its shortcuts at session start', async ($, on) => {
  const files: Record<string, string> = {}
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('store.get', () => ({ value: undefined })) // never toggled: on
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  on('env.get', (_$, e) => ({ value: e.name === 'HOME' ? '/home/test' : undefined }))
  on('fs.exists', (_$, e) => ({ value: e.path in files }))
  on('fs.read', (_$, e) => ({ value: files[e.path] ?? '' }))
  on('fs.write', (_$, e) => {
    files[e.path] = e.text
    return { value: undefined }
  })
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  const bindings = JSON.parse(files['/home/test/.claude/keybindings.json'] ?? '{}').bindings?.[0]?.bindings ?? {}
  expect(Object.keys(bindings)).toEqual(['alt+q', 'alt+t', 'alt+c', 'alt+s'])
})

test('a question whose turn ends with no text does not take the next reply', async ($, on) => {
  on('prompt.submit', (_$, e) => ({ text: e.text }))
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  await $.prompt.submit({ text: 'How do tides work?', wait: false, origin: { kind: 'composer' } })
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: true, turnId: 't1', reason: 'aborted' })
  await $.prompt.submit({ text: 'Fix the tests', wait: false, origin: { kind: 'composer' } })
  await $.turn.complete({ answer: 'Fixed them.', durationMs: 1, isAborted: false, turnId: 't2', reason: 'answer' })
  const history = await $.ui.mount({
    plugin: 'qa-history',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'qa-history',
    props: paneProps('Q&A history'),
  })
  expect(await history.find({ text: /no answer/ })).toBeDefined()
  expect(await history.find({ text: /Fixed them/ })).toBeUndefined()
  expect(await history.find({ text: /Answering/ })).toBeUndefined()
})

test('records a question with its answer and quizzes on it', async ($, on) => {
  on('prompt.submit', (_$, e) => ({ text: e.text }))
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  on('model.classify', (_$, e) => ({ value: e.text.includes('New question: Is it fast') ? 'follow-up' : 'new-topic' }))
  const quizPrompts: string[] = []
  on('model.complete', (_$, e) => {
    quizPrompts.push(e.prompt)
    return {
    value: {
      isAnswered: true as const,
      text: QUIZ_JSON,
      usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    },
    }
  })

  await $.prompt.submit({ text: 'Add a margin', wait: false, origin: { kind: 'composer' } })
  await $.prompt.submit({ text: 'How does a closure work?', wait: false, origin: { kind: 'composer' } })
  await $.turn.complete({
    answer: 'A function with its scope.',
    durationMs: 1,
    isAborted: false,
    turnId: 't1',
    reason: 'answer',
  })
  await $.prompt.submit({ text: 'Is it fast?', wait: false, origin: { kind: 'composer' } })
  await $.turn.complete({ answer: 'Yes, quite.', durationMs: 1, isAborted: false, turnId: 't2', reason: 'answer' })
  await $.prompt.submit({ text: 'Where is Rust used?', wait: false, origin: { kind: 'composer' } })
  await $.turn.complete({ answer: 'In systems.', durationMs: 1, isAborted: false, turnId: 't3', reason: 'answer' })

  for (const surface of ['terminal', 'desktop'] as const) {
    const history = await $.ui.mount({
      plugin: 'qa-history',
      surface,
      component: 'Pane',
      requestId: 'qa-history',
      props: paneProps('Q&A history'),
    })
    // each question line is its own Client: two cards ("Add a margin" is no question) and one follow-up
    const toggleKeys = (await history.findAll({ type: 'Client' })).map(toggle => toggle.key ?? '')
    expect(toggleKeys.length).toBe(3)
    const relatedKey = toggleKeys.find(key => key.includes(':')) ?? ''
    const closureKey = relatedKey.slice(0, relatedKey.indexOf(':'))
    expect(await history.find({ type: 'Text', text: /^▾ ↳ Q: Is it fast/, in: relatedKey })).toBeDefined()
    expect(await history.find({ text: /Yes, quite/ })).toBeDefined()
    expect(await history.find({ type: 'Text', text: /^ ▾ Q: How does a closure work/, in: closureKey })).toBeDefined()
    await history.pointer({ type: 'down', x: 1, y: 0, button: 'left', in: closureKey })
    expect(await history.find({ text: /function with its scope/ })).toBeUndefined()
    expect(await history.find({ text: /Yes, quite/ })).toBeDefined() // a related answer folds on its own
    expect(await history.find({ type: 'Text', text: /^ ▸ Q: How/, in: closureKey })).toBeDefined()
    await history.pointer({ type: 'down', x: 1, y: 0, button: 'left', in: closureKey })
    expect(await history.find({ text: /function with its scope/ })).toBeDefined()
    await history.unmount()
  }

  for (const surface of ['terminal', 'desktop'] as const) {
    await $.command.run({
      command: 'qa-testme',
      args: '',
      origin: { kind: 'composer' },
      presentation: { isFullscreen: true, columns: 160 },
    })
    // the whole history, follow-ups included, not just the last card
    expect(quizPrompts.at(-1)).toMatch(/closure[\s\S]*Is it fast[\s\S]*Rust/)
    expect(quizPrompts.at(-1)).toMatch(/^9 questions/m) // 3 questions (one a merged follow-up), 3 each
    const quizPane = await $.ui.mount({
      plugin: 'qa-history',
      surface,
      component: 'Pane',
      requestId: 'qa-testme',
      props: paneProps('Test me'),
    })
    await quizPane.key({ key: '9', in: 'quiz-keys' }) // no 9th option: ignored
    await quizPane.key({ key: '2', in: 'quiz-keys' })
    expect(await quizPane.find({ text: /Q two/ })).toBeDefined()
    await quizPane.pointer({ type: 'move', x: 4, y: 7, button: 'left', in: 'quiz-keys' })
    expect(await quizPane.find({ text: /▶ 2/, in: 'quiz-keys' })).toBeDefined()
    // header 2 rows, then 3-row options 1 row apart: y = 2 + 4 * 3 + 1 is option 4
    await quizPane.pointer({ type: 'down', x: 4, y: 15, button: 'left', in: 'quiz-keys' })
    expect(await quizPane.find({ text: /Score: 1\/2/ })).toBeDefined()
    await quizPane.unmount()
  }
})

test('the band and /qa-toggle turn recording off and on', async ($, on) => {
  on('prompt.submit', (_$, e) => ({ text: e.text }))
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  on('ui.close', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  const files: Record<string, string> = {}
  const stored: Record<string, unknown> = {}
  on('store.set', (_$, e) => {
    stored[e.key] = e.value
    return { value: undefined }
  })
  on('env.get', (_$, e) => ({ value: e.name === 'HOME' ? '/home/test' : undefined }))
  on('fs.exists', (_$, e) => ({ value: e.path in files }))
  on('fs.read', (_$, e) => ({ value: files[e.path] ?? '' }))
  on('fs.write', (_$, e) => {
    files[e.path] = e.text
    return { value: undefined }
  })
  const boundKeys = () => Object.keys(JSON.parse(files['/home/test/.claude/keybindings.json'] ?? '{}').bindings?.[0]?.bindings ?? {})
  on('ui.render', () => ({ type: 'Box', props: {}, children: [] })) // the engine's empty band
  const bandProps = {
    hasSurvey: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 80,
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  }
  const run = (command: string) =>
    $.command.run({ command, args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })

  for (const surface of ['terminal', 'desktop'] as const) {
    const band = await $.ui.mount({ plugin: 'qa-history', surface, component: 'AbovePrompt', props: bandProps })
    expect((await band.find({ key: 'qa-toggle' }))?.props).toMatchObject({ hotkey: 'q' })
    expect(await band.find({ text: /Q&A history: on/ })).toBeDefined()
    await band.press({ key: 'qa-toggle' })
    expect(await band.find({ text: /Q&A history: off/ })).toBeDefined()
    await band.press({ key: 'qa-toggle' })
    expect(await band.find({ text: /Q&A history: on/ })).toBeDefined()
    await band.unmount()
  }

  await run('qa-toggle') // off
  expect(boundKeys()).toEqual([]) // shortcuts freed
  expect(stored.isEnabled).toBe(false) // and off stays off in the next session
  expect((await run('qa-testme')).text).toMatch(/is off/) // alt+t does nothing while off
  await $.prompt.submit({ text: 'Why is the sky blue?', wait: false, origin: { kind: 'composer' } })
  await run('qa-toggle') // on
  expect(boundKeys()).toEqual(['alt+q', 'alt+t', 'alt+c', 'alt+s'])
  await $.prompt.submit({ text: 'How do tides work?', wait: false, origin: { kind: 'composer' } })
  const history = await $.ui.mount({
    plugin: 'qa-history',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'qa-history',
    props: paneProps('Q&A history'),
  })
  // only the question asked while on was recorded
  const questionKeys = (await history.findAll({ type: 'Client' })).map(toggle => toggle.key ?? '')
  expect(questionKeys.length).toBe(1)
  expect(await history.find({ type: 'Text', text: /tides/, in: questionKeys[0] ?? '' })).toBeDefined()

  // Clear asks once more before wiping the history
  const band = await $.ui.mount({ plugin: 'qa-history', surface: 'desktop', component: 'AbovePrompt', props: bandProps })
  await band.press({ key: 'qa-quiz' }) // the tides question has no answer yet
  expect(await band.find({ key: 'qa-quiz' })).toBeDefined()
  await band.press({ key: 'qa-clear' })
  await band.press({ key: 'qa-clear-cancel' })
  expect((await history.findAll({ type: 'Client' })).length).toBe(1)
  await band.press({ key: 'qa-clear' })
  await band.press({ key: 'qa-clear' })
  expect((await history.findAll({ type: 'Client' })).length).toBe(0)
  expect(await history.find({ text: /Ask something/ })).toBeDefined()

  // alt+c runs /qa-clear: twice to clear, refused while off
  await $.prompt.submit({ text: 'Why is ice slippery?', wait: false, origin: { kind: 'composer' } })
  expect((await run('qa-clear')).text).toMatch(/again/)
  expect((await history.findAll({ type: 'Client' })).length).toBe(1)
  expect((await run('qa-clear')).text).toMatch(/cleared/)
  expect((await history.findAll({ type: 'Client' })).length).toBe(0)
  await run('qa-toggle') // off
  expect((await run('qa-clear')).text).toMatch(/is off/)
  await run('qa-toggle') // on

  // ✕ hides the band; /qa-history brings it back
  await band.press({ key: 'qa-band-close' })
  expect(await band.find({ key: 'qa-toggle' })).toBeUndefined()
  await run('qa-history')
  expect(await band.find({ key: 'qa-toggle' })).toBeDefined()

  // a message sent between the two presses cancels the clear
  await $.prompt.submit({ text: 'Why is the sea salty?', wait: false, origin: { kind: 'composer' } })
  await band.press({ key: 'qa-clear' })
  await $.prompt.submit({ text: 'thanks', wait: false, origin: { kind: 'composer' } })
  expect(await band.find({ key: 'qa-clear-cancel' })).toBeUndefined()
  await band.press({ key: 'qa-clear' })
  expect((await history.findAll({ type: 'Client' })).length).toBe(1)
  // but typing /qa-clear as the second press keeps it, so the command still clears in two goes
  await $.prompt.submit({ text: '/qa-clear', wait: false, origin: { kind: 'composer' } })
  expect(await band.find({ key: 'qa-clear-cancel' })).toBeDefined()
})
