import { useSyncExternalStore } from 'react'

/**
 * PWA installation state.
 * - Chromium (Android, desktop) fires `beforeinstallprompt`: we keep the event
 *   to trigger the native install dialog from our own button.
 * - iOS has no such API: the user must use Share → Add to Home Screen.
 * This module is loaded at startup so the event is never missed.
 */

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

/** How the app can be installed right now. */
export type InstallMode = 'native' | 'ios' | 'none'

const DISMISS_KEY = 'install-banner-dismissed'

let deferred: BeforeInstallPromptEvent | null = null
let installed = isStandalone()
let dismissed = readDismissed()
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

function isStandalone(): boolean {
  const iosStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true
  return iosStandalone || window.matchMedia('(display-mode: standalone)').matches
}

function isIos(): boolean {
  // iPadOS reports itself as a Mac; touch support tells them apart.
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || (/macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1)
}

function readDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === '1'
  } catch {
    return false
  }
}

window.addEventListener('beforeinstallprompt', (e) => {
  // Keep Chrome's own mini-infobar away; our banner offers the install instead.
  e.preventDefault()
  deferred = e as BeforeInstallPromptEvent
  emit()
})

window.addEventListener('appinstalled', () => {
  deferred = null
  installed = true
  emit()
})

function mode(): InstallMode {
  if (installed || dismissed) return 'none'
  if (deferred) return 'native'
  return isIos() ? 'ios' : 'none'
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useInstallMode(): InstallMode {
  return useSyncExternalStore(subscribe, mode)
}

/** Opens the browser's install dialog (native mode only). */
export async function promptInstall(): Promise<void> {
  const event = deferred
  if (!event) return
  // The event can only be used once.
  deferred = null
  await event.prompt()
  const { outcome } = await event.userChoice
  if (outcome === 'accepted') installed = true
  emit()
}

/** Hides the banner for good on this device. */
export function dismissInstall() {
  dismissed = true
  try {
    localStorage.setItem(DISMISS_KEY, '1')
  } catch {
    // Private mode: dismissed for this session only.
  }
  emit()
}
