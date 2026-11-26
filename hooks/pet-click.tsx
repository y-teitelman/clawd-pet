import type { ClientModule } from 'claude-code'

/**
 * An invisible layer laid over the pet's picture on the desktop app: the
 * picture (an Svg) takes no presses, so this turns a left click into a post
 * that the hooks module hears as `ui.message` and answers with a reaction.
 */
const PetClick: ClientModule<null, true> = (_props, surface) => {
  if (surface.state === undefined) {
    surface.onPointer(event => {
      if (event.type === 'down' && (event.button ?? 'left') === 'left') surface.post({ poke: true })
    })
    surface.setState(true)
  }
  const { Box } = surface.elements
  return <Box width="100%" height="100%" />
}

export default PetClick
