import type { ClientModule } from 'claude-code'

// isBand: a card's own question, drawn on a band of its color; else a follow-up in that color.
export type QuestionToggleProps = { label: string; color: string; isBand: boolean }

// A question line that keeps its highlight (a desktop's native Button would drop it) and posts a click.
const QuestionToggle: ClientModule<QuestionToggleProps> = (props, surface) => {
  const { Text } = surface.elements
  surface.onPointer(event => {
    if (event.type === 'down' && event.button !== 'right') surface.post({ toggle: true })
  })

  return props.isBand ? (
    <Text bold color="inverseText" backgroundColor={props.color}>
      {props.label}
    </Text>
  ) : (
    <Text bold color={props.color}>
      {props.label}
    </Text>
  )
}

export default QuestionToggle
