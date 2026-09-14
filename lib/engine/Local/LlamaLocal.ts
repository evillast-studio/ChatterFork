import { closeFd, getContentFd } from '@vali98/react-native-fs'
import {
    CompletionParams,
    ContextParams,
    initLlama,
    LlamaContext,
    RNLLAMA_MTMD_DEFAULT_MEDIA_MARKER,
} from 'cui-llama.rn'
import { t } from 'i18next'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import { ModelDataType } from '@db/schema'
import { Storage } from '@lib/enums/Storage'
import { AppDirectory, fileExists, readableFileSize, writeBase64File } from '@lib/utils/File'

import { checkGGMLDeprecated } from './GGML'
import { KV, Model } from './Model'
import { AppSettings } from '../../constants/GlobalValues'
import { Logger } from '../../state/Logger'
import { createMMKVStorage, mmkv } from '../../storage/MMKV'

export type CompletionTimings = {
    predicted_per_token_ms: number
    predicted_per_second: number | null
    predicted_ms: number
    predicted_n: number

    prompt_per_token_ms: number
    prompt_per_second: number | null
    prompt_ms: number
    prompt_n: number
}

export type CompletionOutput = {
    text: string
    timings: CompletionTimings
}

export type LlamaState = {
    context: LlamaContext | undefined
    model?: ModelDataType
    mmproj?: ModelDataType
    loadProgress: number
    chatCount: number
    promptCache?: string
    load: (model: ModelDataType) => Promise<void>
    loadMmproj: (model: ModelDataType) => Promise<void>
    setLoadProgress: (progress: number) => void
    unload: () => Promise<void>
    unloadMmproj: () => Promise<void>
    saveKV: (prompt: string | undefined, media_paths?: string[]) => Promise<void>
    loadKV: () => Promise<boolean>
    completion: (
        params: CompletionParams,
        callback: (text: string) => void,
        completed: (text: string, timngs: CompletionTimings) => void
    ) => Promise<void>
    stopCompletion: () => Promise<void>
    tokenLength: (text: string, mediaPaths?: string[]) => Promise<number>
    tokenize: (text: string, media_paths?: string[]) => Promise<{ tokens: number[] } | undefined>
}

export type FlashAttnMode = 'off' | 'auto' | 'on'
export type KVCacheType = 'f16' | 'f32' | 'q8_0' | 'q6_k' | 'q5_1' | 'q5_0' | 'q4_1' | 'q4_0' | 'iq4_nl'

export type LlamaConfig = {
    context_length: number
    threads: number
    gpu_layers: number
    batch: number
    ctx_shift: boolean
    devices: string[]
    // Memory
    use_mmap: boolean
    use_mlock: boolean
    no_extra_buf: boolean
    // KV Cache
    cache_type_k: KVCacheType
    cache_type_v: KVCacheType
    kv_unified: boolean
    swa_full: boolean
    // Performance
    flash_attn: FlashAttnMode
    ubatch: number
    disable_log: boolean
    // CPU affinity
    cpu_mask: string
    cpu_strict: boolean
    // RoPE
    rope_freq_base: number
    rope_freq_scale: number
    // Context shift
    n_keep: number
    defrag_thold: number
    // Force backend
    force_device: boolean
    custom_device: string
}

export type EngineDataProps = {
    config: LlamaConfig
    lastModel?: ModelDataType
    lastMmproj?: ModelDataType
    setConfiguration: (config: LlamaConfig) => void
    setLastModelLoaded: (model: ModelDataType | undefined) => void
    setLastMmprojLoaded: (model: ModelDataType | undefined) => void
    maybeClearLastLoaded: (mode: ModelDataType) => void
}

const sessionFile = `${AppDirectory.SessionPath}llama-session.bin`

const defaultConfig: LlamaConfig = {
    context_length: 4096,
    threads: 4,
    gpu_layers: 0,
    batch: 512,
    ctx_shift: true,
    devices: [],
    // Memory
    use_mmap: true,
    use_mlock: true,
    no_extra_buf: false,
    // KV Cache
    cache_type_k: 'f16',
    cache_type_v: 'f16',
    kv_unified: true,
    swa_full: true,
    // Performance
    flash_attn: 'off',
    ubatch: 256,
    disable_log: true,
    // CPU affinity
    cpu_mask: '',
    cpu_strict: false,
    // RoPE
    rope_freq_base: 0,
    rope_freq_scale: 0,
    // Context shift
    n_keep: 256,
    defrag_thold: 0.1,
    // Force backend
    force_device: false,
    custom_device: '',
}

export namespace Llama {
    export const useLlamaPreferencesStore = create<EngineDataProps>()(
        persist(
            (set, get) => ({
                config: defaultConfig,
                setConfiguration: (config: LlamaConfig) => {
                    set({ config: config })
                },
                setLastModelLoaded: (model: ModelDataType | undefined) => {
                    if (get().lastModel?.id === model?.id) return
                    set({ lastModel: model, lastMmproj: undefined })
                },
                setLastMmprojLoaded: (mmproj: ModelDataType | undefined) => {
                    set({ lastMmproj: mmproj })
                },
                maybeClearLastLoaded: (data) => {
                    if (data.id === get().lastModel?.id) {
                        set({ lastModel: undefined, lastMmproj: undefined })
                    } else if (data.id === get().lastMmproj?.id) {
                        set({ lastMmproj: undefined })
                    }
                },
            }),
            {
                name: Storage.EngineData,
                partialize: (state) => ({
                    config: state.config,
                    lastModel: state.lastModel,
                    lastMmproj: state.lastMmproj,
                }),
                storage: createMMKVStorage(),
                version: 6,
                migrate: (persistedState: any, version) => {
                    if (version === 1) {
                        persistedState.config.ctx_shift = true
                        Logger.info('Migrated to v2 EngineData')
                    }
                    if (version === 2) {
                        persistedState.config.devices = []
                        Logger.info('Migrated to v3 EngineData')
                    }
                    if (version === 3) {
                        // Migrate to v4: add new performance params
                        const c = persistedState.config
                        c.use_mmap = c.use_mmap ?? true
                        c.use_mlock = c.use_mlock ?? true
                        c.no_extra_buf = c.no_extra_buf ?? false
                        c.cache_type_k = c.cache_type_k ?? 'f16'
                        c.cache_type_v = c.cache_type_v ?? 'f16'
                        c.kv_unified = c.kv_unified ?? true
                        c.swa_full = c.swa_full ?? true
                        c.flash_attn = c.flash_attn ?? 'off'
                        c.ubatch = c.ubatch ?? 256
                        c.disable_log = c.disable_log ?? true
                        c.cpu_mask = c.cpu_mask ?? ''
                        c.cpu_strict = c.cpu_strict ?? false
                        c.rope_freq_base = c.rope_freq_base ?? 0
                        c.rope_freq_scale = c.rope_freq_scale ?? 0
                        Logger.info('Migrated to v4 EngineData')
                    }
                    if (version === 4) {
                        persistedState.config.force_device = false
                        persistedState.config.custom_device = ''
                        Logger.info('Migrated to v5 EngineData')
                    }
                    if (version === 5) {
                        persistedState.config.n_keep = 256
                        persistedState.config.defrag_thold = 0.1
                        Logger.info('Migrated to v6 EngineData')
                    }
                    return persistedState
                },
            }
        )
    )

    export const useLlamaModelStore = create<LlamaState>()((set, get) => ({
        context: undefined,
        loadProgress: 0,
        chatCount: 0,
        promptCache: undefined,
        load: async (model: ModelDataType) => {
            const config = useLlamaPreferencesStore.getState().config

            if (get()?.model?.id === model.id) {
                return Logger.errorToast(t('model.toast.modelAlreadyLoaded'))
            }

            if (checkGGMLDeprecated(parseInt(model.quantization))) {
                return Logger.errorToast(t('model.toast.quantizationNoLongerSupported'))
            }

            if (!(await Model.getModelExists(model.file_path))) {
                Logger.errorToast(t('model.toast.modelDoesNotExist'))
                Model.verifyModelList()
                return
            }

            if (get().context !== undefined) {
                await get().unload()
            }

            let model_path = model.file_path
            if (model.file_path.includes('content://')) {
                model_path = (await getContentFd(model_path)) ?? model_path
            }

            // Map flash_attn mode: 'auto' omits the key so llama.cpp decides
            const flashAttnValue: boolean | undefined = config.flash_attn === 'on'
                ? true
                : config.flash_attn === 'off'
                ? false
                : undefined

            const params: ContextParams = {
                model: model_path,
                n_ctx: config.context_length,
                n_threads: config.threads,
                n_batch: config.batch,
                n_ubatch: config.ubatch,
                ctx_shift: config.ctx_shift,
                n_gpu_layers: config.gpu_layers,
                use_mlock: config.use_mlock,
                use_mmap: config.use_mmap,
                devices: config.devices,
                // KV cache
                cache_type_k: config.cache_type_k,
                cache_type_v: config.cache_type_v,
                // @ts-ignore - extended params supported in cui-llama.rn 1.12+
                kv_unified: config.kv_unified,
                // @ts-ignore
                swa_full: config.swa_full,
                // @ts-ignore
                no_extra_buf: config.no_extra_buf,
                // Performance (omit flash_attn key when 'auto' so llama.cpp decides)
                ...(flashAttnValue !== undefined ? {
                    // @ts-ignore
                    flash_attn: flashAttnValue,
                } : {}),
                // @ts-ignore
                disable_log: config.disable_log,
                // CPU affinity (only if mask is set)
                ...(config.cpu_mask ? {
                    // @ts-ignore
                    cpu_mask: config.cpu_mask,
                    // @ts-ignore
                    cpu_strict: config.cpu_strict,
                } : {}),
                // Context shift optimization
                // @ts-ignore
                n_keep: config.n_keep,
                // @ts-ignore
                defrag_thold: config.defrag_thold,
                // RoPE (only if non-zero)
                ...(config.rope_freq_base > 0 ? {
                    // @ts-ignore
                    rope_freq_base: config.rope_freq_base,
                } : {}),
                ...(config.rope_freq_scale > 0 ? {
                    // @ts-ignore
                    rope_freq_scale: config.rope_freq_scale,
                } : {}),
            }

            Logger.info(
                `\n------ MODEL LOAD -----\n Model Name: ${model.name}\nStarting with parameters: \nContext Length: ${params.n_ctx}\nThreads: ${params.n_threads}\nBatch Size: ${params.n_batch}\nuBatch: ${params.n_ubatch}\nGPU Layers: ${params.n_gpu_layers}\nFlash Attn: ${config.flash_attn}\nCache K: ${config.cache_type_k} | Cache V: ${config.cache_type_v}\nKV Unified: ${config.kv_unified} | SWA Full: ${config.swa_full}\nuse_mmap: ${config.use_mmap} | use_mlock: ${config.use_mlock}`
            )

            const progressCallback = (progress: number) => {
                if (progress % 5 === 0) get().setLoadProgress(progress)
            }

            const llamaContext = await initLlama(params, progressCallback).catch((error) => {
                Logger.errorToast(t('model.toast.couldNotLoadModel'), JSON.stringify(error))
                if (model.file_path.includes('content://')) {
                    closeFd(model_path)
                }
            })

            if (!llamaContext) return

            set({
                context: llamaContext,
                model: model,
                chatCount: 1,
            })

            // updated EngineData
            useLlamaPreferencesStore.getState().setLastModelLoaded(model)
            KV.useKVStore.getState().setKvCacheLoaded(false)
        },
        loadMmproj: async (model: ModelDataType) => {
            const context = get().context
            if (!context) return

            let model_path = model.file_path
            if (model.file_path.includes('content://')) {
                model_path = (await getContentFd(model_path)) ?? model_path
            }

            Logger.info('Loading MMPROJ')
            await context.initMultimodal({ path: model_path, use_gpu: true }).catch((e) => {
                if (model.file_path.includes('content://')) {
                    closeFd(model_path)
                }

                Logger.errorToast(t('model.toast.failedToLoadMMPROJ'), JSON.stringify(e))
            })
            if (await context.isMultimodalEnabled()) {
                const capabilities = await context.getMultimodalSupport()
                Logger.info(
                    `MMPROJ Loaded:\n- Vision: ${capabilities.vision}\n- Audio: ${capabilities.audio}`
                )
            }

            set({
                mmproj: model,
            })

            useLlamaPreferencesStore.getState().setLastMmprojLoaded(model)
        },
        setLoadProgress: (progress: number) => {
            set({ loadProgress: progress })
        },
        unload: async () => {
            if (get().mmproj) {
                await get().context?.releaseMultimodal()
            }

            await get().context?.release()
            set({
                context: undefined,
                model: undefined,
                mmproj: undefined,
            })
            Logger.info('Model Unloaded')
        },
        unloadMmproj: async () => {
            if (!get().mmproj) return
            await get()
                .context?.releaseMultimodal()
                .catch((e) => {
                    Logger.errorToast(t('model.toast.failedToUnloadMMPROJ'), JSON.stringify(e))
                })
            set({
                mmproj: undefined,
            })
        },
        completion: async (
            params: CompletionParams,
            callback = (text: string) => {},
            completed = (text: string) => {}
        ) => {
            const llamaContext = get().context
            if (llamaContext === undefined) {
                Logger.errorToast(t('model.toast.noModelLoaded'))
                return
            }

            return llamaContext
                .completion(params, (data) => {
                    callback(data.token)
                })
                .then(async ({ text, timings }: CompletionOutput) => {
                    completed(text, timings)
                    Logger.info(
                        `\n---- Start Chat ${get().chatCount} ----\n${textTimings(timings)}\n---- End Chat ${get().chatCount} ----\n`
                    )
                    set({ chatCount: get().chatCount + 1 })
                    if (mmkv.getBoolean(AppSettings.SaveLocalKV)) {
                        await get().saveKV(params.prompt, params.media_paths ?? [])
                    }
                })
        },
        stopCompletion: async () => {
            await get().context?.stopCompletion()
        },
        saveKV: async (prompt, media_paths) => {
            const llamaContext = get().context
            if (!llamaContext) {
                Logger.errorToast(t('model.toast.noModelLoaded'))
                return
            }

            if (prompt) {
                const tokens = (await get().tokenize(prompt, media_paths ?? []))?.tokens
                KV.useKVStore.getState().setKvCacheTokens(tokens ?? [])
            }

            if (!fileExists(sessionFile)) {
                Logger.warn('Session file does not exist, creating...')
                await writeBase64File(sessionFile, '')
            }

            const now = performance.now()
            const data = await llamaContext.saveSession(sessionFile.replace('file://', ''))
            Logger.info(
                data === -1
                    ? 'Failed to save KV cache'
                    : `Saved KV in ${Math.floor(performance.now() - now)}ms with ${data} tokens`
            )
            Logger.info(`Current KV Size is: ${readableFileSize(await KV.getKVSize())}`)
        },
        loadKV: async () => {
            let result = false
            const llamaContext = get().context
            if (!llamaContext) {
                Logger.errorToast(t('model.toast.noModelLoaded'))
                return false
            }
            if (!fileExists(sessionFile)) {
                Logger.warn('No Cache found')
                return false
            }
            await llamaContext
                .loadSession(sessionFile.replace('file://', ''))
                .then(() => {
                    Logger.info('Session loaded from KV cache')
                    result = true
                })
                .catch(() => {
                    Logger.error('Session loaded could not load from KV cache')
                })
            return result
        },
        tokenLength: async (text: string, mediaPaths: string[] = []) => {
            const finalPaths = get().mmproj ? mediaPaths : []
            if (!get().mmproj && mediaPaths.length > 0) {
                Logger.warnToast(t('model.toast.mediaAddedWithoutMMPROJModel'))
            }
            const result = await get().context?.tokenize(
                text + finalPaths.map(() => RNLLAMA_MTMD_DEFAULT_MEDIA_MARKER).join(),
                {
                    media_paths: finalPaths.map((item) => item.replace('file://', '')),
                }
            )
            if (!result) return 0
            return result.tokens.length
        },
        tokenize: async (text: string, media_paths: string[] = []) => {
            const params = get().mmproj ? { media_paths } : {}
            return await get().context?.tokenize(text, params)
        },
    }))

    // ── Presets ──────────────────────────────────────────────
    export type ConfigPreset = {
        id: string
        name: string
        description: string
        builtin: boolean
        config: Partial<LlamaConfig>
    }

    export const BUILTIN_PRESETS: ConfigPreset[] = [
        {
            id: 'kirin710',
            name: '⚡ Kirin 710 (A73)',
            description: 'Optimizado para Cortex-A73. Pinea hilos a big cores, batch conservador para L3 de 1MB, KV q8_0 para ahorrar ancho de banda RAM.',
            builtin: true,
            config: {
                threads: 4,
                cpu_mask: '4-7',
                cpu_strict: true,
                batch: 512,
                ubatch: 128,
                context_length: 2048,
                use_mmap: true,
                use_mlock: true,
                no_extra_buf: false,
                cache_type_k: 'q8_0',
                cache_type_v: 'q8_0',
                kv_unified: true,
                swa_full: true,
                flash_attn: 'off',
                disable_log: true,
                n_keep: 256,
                defrag_thold: 0.1,
                gpu_layers: 0,
            },
        },
        {
            id: 'gemma2_2b',
            name: '💎 Gemma 2 2B',
            description: 'Contexto 4096 (ventana SWA), swa_full ON obligatorio, KV q8_0, flash auto. Vocab de 256k requiere más RAM.',
            builtin: true,
            config: {
                context_length: 4096,
                cache_type_k: 'q8_0',
                cache_type_v: 'q8_0',
                swa_full: true,
                kv_unified: true,
                flash_attn: 'auto',
                ubatch: 128,
                n_keep: 256,
                defrag_thold: 0.1,
            },
        },
        {
            id: 'llama32_3b',
            name: '🦙 Llama 3.2 3B',
            description: 'GQA con 8 query / 4 KV heads. KV q4_0 reduce mucho RAM. Contexto 4096 es el punto dulce.',
            builtin: true,
            config: {
                context_length: 4096,
                cache_type_k: 'q4_0',
                cache_type_v: 'q4_0',
                kv_unified: true,
                swa_full: false,
                flash_attn: 'off',
                ubatch: 256,
                n_keep: 512,
                defrag_thold: 0.1,
            },
        },
        {
            id: 'balanced',
            name: '⚖️ Balanceado',
            description: 'Config conservadora para cualquier dispositivo. Buen balance RAM/velocidad.',
            builtin: true,
            config: {
                threads: 4,
                batch: 512,
                ubatch: 256,
                context_length: 4096,
                cache_type_k: 'f16',
                cache_type_v: 'f16',
                kv_unified: true,
                swa_full: true,
                flash_attn: 'off',
                disable_log: true,
                n_keep: 256,
                defrag_thold: 0.1,
            },
        },
    ]

    export const usePresetsStore = create<{
        userPresets: ConfigPreset[]
        saveUserPreset: (name: string, config: LlamaConfig) => void
        deleteUserPreset: (id: string) => void
        getAllPresets: () => ConfigPreset[]
    }>()(
        persist(
            (set, get) => ({
                userPresets: [],
                saveUserPreset: (name: string, config: LlamaConfig) => {
                    const id = `user_${Date.now()}`
                    const preset: ConfigPreset = {
                        id,
                        name,
                        description: 'Config guardada por el usuario',
                        builtin: false,
                        config,
                    }
                    set({ userPresets: [...get().userPresets, preset] })
                },
                deleteUserPreset: (id: string) => {
                    set({ userPresets: get().userPresets.filter((p) => p.id !== id) })
                },
                getAllPresets: () => [...BUILTIN_PRESETS, ...get().userPresets],
            }),
            {
                name: Storage.EnginePresets,
                storage: createMMKVStorage(),
            }
        )
    )

    const textTimings = (timings: CompletionTimings) => {
        return (
            `\n[Prompt Timings]` +
            (timings.prompt_n > 0
                ? `\nPrompt Per Token: ${timings.prompt_per_token_ms.toFixed(2)} ms/token` +
                  `\nPrompt Per Second: ${timings.prompt_per_second?.toFixed(2) ?? 0} tokens/s` +
                  `\nPrompt Time: ${(timings.prompt_ms / 1000).toFixed(2)}s` +
                  `\nPrompt Tokens: ${timings.prompt_n} tokens`
                : '\nNo Tokens Processed') +
            `\n\n[Predicted Timings]` +
            (timings.predicted_n > 0
                ? `\nPredicted Per Token: ${timings.predicted_per_token_ms.toFixed(2)} ms/token` +
                  `\nPredicted Per Second: ${timings.predicted_per_second?.toFixed(2) ?? 0} tokens/s` +
                  `\nPrediction Time: ${(timings.predicted_ms / 1000).toFixed(2)}s` +
                  `\nPredicted Tokens: ${timings.predicted_n} tokens\n`
                : '\nNo Tokens Generated')
        )
    }
}
