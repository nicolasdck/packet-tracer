/**
 * Hands a text file to the user. On touch devices the share sheet is used
 * (downloads are unreliable in installed iOS PWAs); elsewhere a download starts.
 */
export async function saveFile(name: string, text: string, type = 'application/json'): Promise<void> {
  const file = new File([text], name, { type })
  const touch = window.matchMedia('(pointer: coarse)').matches
  if (touch && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name })
      return
    } catch (e) {
      // The user closed the share sheet: nothing else to do.
      if (e instanceof DOMException && e.name === 'AbortError') return
    }
  }
  const url = URL.createObjectURL(file)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
