import { create } from 'zustand'

type TTSStore = {
    enabled: boolean
    activeSwipeId: string | undefined
    isSpeaking: boolean
    startTTS: () => void
    stopTTS: () => void
    insertBuffer: (text: string) => void
}

export const useTTSStore = create<TTSStore>()(() => ({
    enabled: false,
    activeSwipeId: undefined,
    isSpeaking: false,
    startTTS: () => {},
    stopTTS: () => {},
    insertBuffer: () => {},
}))
