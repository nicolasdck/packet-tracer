import { create } from 'zustand'
import type { LinkEnd } from '../../engine'

export type Selection = { kind: 'device'; id: string } | { kind: 'link'; id: string } | null

/**
 * Link wizard: tap device A → port → tap device B → port.
 * `pickingFor` is the device whose port sheet is open.
 */
export interface LinkDraft {
  a: LinkEnd | null
  pickingFor: string | null
}

export type Sheet = 'palette' | 'device-menu' | 'rename' | 'delete' | null

interface UiState {
  selection: Selection
  linkDraft: LinkDraft | null
  sheet: Sheet
  select(selection: Selection): void
  openSheet(sheet: Sheet): void
  startLink(): void
  cancelLink(): void
  pickLinkDevice(deviceId: string): void
  setLinkStart(end: LinkEnd): void
  closePortPicker(): void
  reset(): void
}

export const useUiStore = create<UiState>()((set) => ({
  selection: null,
  linkDraft: null,
  sheet: null,
  select: (selection) => set({ selection }),
  openSheet: (sheet) => set({ sheet }),
  startLink: () => set({ linkDraft: { a: null, pickingFor: null }, selection: null, sheet: null }),
  cancelLink: () => set({ linkDraft: null }),
  pickLinkDevice: (deviceId) =>
    set((s) => {
      if (!s.linkDraft || s.linkDraft.a?.deviceId === deviceId) return s
      return { linkDraft: { ...s.linkDraft, pickingFor: deviceId } }
    }),
  setLinkStart: (end) => set({ linkDraft: { a: end, pickingFor: null } }),
  closePortPicker: () =>
    set((s) => (s.linkDraft ? { linkDraft: { ...s.linkDraft, pickingFor: null } } : s)),
  reset: () => set({ selection: null, linkDraft: null, sheet: null }),
}))
