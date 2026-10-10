export type FollowUp = { question: string; answer: string }
// followUps: what Claude asked back (AskUserQuestion) while answering it (absent on ones saved before it existed)
export type RelatedQuestion = FollowUp & { followUps?: FollowUp[] }
// relatedQuestions: later questions that built on this answer (absent on cards saved before it existed)
export type Entry = {
  id: string
  question: string
  answer: string
  followUps: FollowUp[]
  relatedQuestions?: RelatedQuestion[]
}
export type QuizItem = { question: string; options: string[]; correct: number }
export type Quiz = { topic: string; items: QuizItem[]; picks: number[] }

declare module 'claude-code' {
  interface PluginState {
    // hiddenAnswerIds: questions whose answers are folded in the history ('<card id>' or '<card id>:<related index>')
    // isBandHidden: the band's ✕ hides it until /qa-history
    // isEnabled: off stops recording, closes the history pane and frees the shortcuts (/qa-toggle, alt+q); kept in $.store too
    'qa-history': { entries: Entry[]; quiz: Quiz | null; quizStatus: string; hiddenAnswerIds: string[]; isEnabled: boolean; isConfirmingClear: boolean; isBandHidden: boolean }
  }
}
