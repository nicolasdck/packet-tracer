import { useEffect, useState } from 'react'

interface Viewport {
  height: number
  offsetTop: number
}

function read(): Viewport {
  const vv = window.visualViewport
  return vv ? { height: vv.height, offsetTop: vv.offsetTop } : { height: window.innerHeight, offsetTop: 0 }
}

/**
 * Visible area above the on-screen keyboard. `dvh` does not shrink for the
 * keyboard on iOS, so full-screen views size themselves from this instead.
 */
export function useVisualViewport(): Viewport {
  const [viewport, setViewport] = useState(read)
  useEffect(() => {
    const vv = window.visualViewport
    const update = () => setViewport(read())
    vv?.addEventListener('resize', update)
    vv?.addEventListener('scroll', update)
    window.addEventListener('resize', update)
    return () => {
      vv?.removeEventListener('resize', update)
      vv?.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
    }
  }, [])
  return viewport
}
