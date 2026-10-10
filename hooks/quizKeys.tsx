import type { ClientModule } from 'claude-code'

export type QuizKeysProps = { questionIndex: number; options: string[] }

// Row layout the pointer math below depends on: a hint, a blank row, then each option
// (a bordered box of 3 rows: border, text, border) with a blank row after it.
const HEADER_ROWS = 2
const OPTION_ROWS = 3
const OPTION_STRIDE = OPTION_ROWS + 1

// The option index under a row of the region, or null between options and above them.
function optionAtRow(row: number, optionCount: number): number | null {
  const optionRow = row - HEADER_ROWS
  if (optionRow < 0 || optionRow % OPTION_STRIDE >= OPTION_ROWS) return null
  const optionIndex = Math.floor(optionRow / OPTION_STRIDE)
  return optionIndex < optionCount ? optionIndex : null
}

// Draws the options and answers both a click on one and a 1-9 key once a click gave it the focus.
// Local state: the option under the pointer, lit up since no surface lets a plugin set the cursor.
const QuizKeys: ClientModule<QuizKeysProps, number | null> = (props, surface) => {
  const { Box, Text } = surface.elements
  const hoveredIndex = surface.state ?? null
  const pick = (optionIndex: number) => {
    if (optionIndex >= 0 && optionIndex < props.options.length) {
      surface.post({ questionIndex: props.questionIndex, optionIndex })
    }
  }

  surface.onKey(event => {
    if (/^[1-9]$/.test(event.key) && !event.ctrl && !event.meta) pick(Number(event.key) - 1)
  })
  surface.onPointer(event => {
    const optionIndex = event.type === 'leave' ? null : optionAtRow(event.y, props.options.length)
    if (optionIndex !== hoveredIndex) surface.setState(optionIndex)
    if (event.type === 'down' && event.button !== 'right' && optionIndex !== null) pick(optionIndex)
  })

  return (
    <Box flexDirection="column">
      <Text dimColor>Click here once, then press 1-{props.options.length}</Text>
      <Text> </Text>
      {props.options.map((option, optionIndex) => {
        const isHovered = optionIndex === hoveredIndex
        return (
          <Box
            borderStyle={isHovered ? 'bold' : 'round'}
            borderColor={isHovered ? 'claude' : 'subtle'}
            height={OPTION_ROWS}
            marginBottom={optionIndex < props.options.length - 1 ? 1 : 0}
            paddingX={1}
          >
            <Text wrap="truncate-end" bold={isHovered}>
              <Text bold color="claude">
                {isHovered ? '▶ ' : '  '}
                {optionIndex + 1}
              </Text>
              {'  '}
              {option}
            </Text>
          </Box>
        )
      })}
    </Box>
  )
}

export default QuizKeys
