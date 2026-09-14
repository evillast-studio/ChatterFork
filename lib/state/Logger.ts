import Toast from 'react-native-simple-toast'
import { create } from 'zustand'

// No persist - logs son solo en memoria. Elimina escrituras a MMKV por cada log.
// Reduces RAM: 200 entries max vs 2000 antes.
const MAX_LOG_LENGTH = 200

export enum LogLevel {
    INFO,
    WARN,
    ERROR,
    DEBUG,
}

type LogEntry = {
    timestamp: string
    message: string
    level: LogLevel
}

type LogStateProps = {
    logs: LogEntry[]
    addLog: (entry: LogEntry) => void
    flushLogs: () => void
}

export namespace Logger {
    // Flag: durante inferencia solo escribimos ERRORs al estado para no bloquear JS thread
    let _inferencing = false
    export const setInferencing = (v: boolean) => { _inferencing = v }

    export const useLoggerStore = create<LogStateProps>()((set, get) => ({
        logs: [],
        addLog: (entry) => {
            // Durante inferencia: silenciar INFO/DEBUG/WARN para no triggerar re-renders
            if (_inferencing && entry.level !== LogLevel.ERROR) return
            const newlogs = [...get().logs, entry]
            if (newlogs.length > MAX_LOG_LENGTH) newlogs.shift()
            set({ logs: newlogs })
        },
        flushLogs: () => set({ logs: [] }),
    }))

    export const LevelName: Record<LogLevel, string> = {
        [LogLevel.INFO]: 'INFO',
        [LogLevel.WARN]: 'WARN',
        [LogLevel.ERROR]: 'ERROR',
        [LogLevel.DEBUG]: 'DEBUG',
    }

    const toastTime = Toast.SHORT

    const createLog = (data: string, level: LogLevel): LogEntry => ({
        timestamp: new Date().toLocaleTimeString(),
        message: data,
        level,
    })

    export const info = (data: string) => {
        const logItem = createLog(data, LogLevel.INFO)
        // Durante inferencia, no actualizar estado para no bloquear JS thread
        if (!_inferencing) {
            useLoggerStore.getState().addLog(logItem)
        }
        console.log(`[INFO]: ${data}`)
    }

    export const infoToast = (data: string) => {
        info(data)
        Toast.show(data, toastTime)
    }

    export const warn = (data: string) => {
        const logItem = createLog(data, LogLevel.WARN)
        if (!_inferencing) {
            useLoggerStore.getState().addLog(logItem)
        }
        console.warn(`[WARN]: ${data}`)
    }

    export const warnToast = (data: string) => {
        warn(data)
        Toast.show(data, toastTime)
    }

    export const error = (data: string) => {
        // Errores siempre se guardan, incluso durante inferencia
        const logItem = createLog(data, LogLevel.ERROR)
        useLoggerStore.getState().addLog(logItem)
        console.error(`[ERROR]: ${data}`)
    }

    export const errorToast = (data: string, extra?: string) => {
        error(extra ? `${data}\n→ ${extra}` : data)
        Toast.show(data, toastTime)
    }

    export const debug = (data: string) => {
        if (_inferencing) return
        const logItem = createLog(data, LogLevel.DEBUG)
        useLoggerStore.getState().addLog(logItem)
        console.debug(`[DEBUG]: ${data}`)
    }
}
