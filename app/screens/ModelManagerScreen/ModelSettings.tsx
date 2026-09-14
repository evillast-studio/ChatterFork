import { useFocusEffect } from 'expo-router'
import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Alert as RNAlert, BackHandler, Platform, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { useMMKVBoolean, useMMKVNumber } from 'react-native-mmkv'
import Animated, { Easing, SlideInRight, SlideOutRight } from 'react-native-reanimated'
import { useShallow } from 'zustand/react/shallow'

import ThemedButton from '@components/buttons/ThemedButton'
import HorizontalSelector from '@components/input/HorizontalSelector'
import ThemedSlider from '@components/input/ThemedSlider'
import ThemedSwitch from '@components/input/ThemedSwitch'
import ThemedTextInput from '@components/input/ThemedTextInput'
import SectionTitle from '@components/text/SectionTitle'
import Alert from '@components/views/Alert'
import { AppSettings, Global } from '@lib/constants/GlobalValues'
import { Llama, KVCacheType, FlashAttnMode, LlamaConfig } from '@lib/engine/Local/LlamaLocal'
import { KV } from '@lib/engine/Local/Model'
import useBackendDevices from '@lib/hooks/BackendDevices'
import { Logger } from '@lib/state/Logger'
import { readableFileSize } from '@lib/utils/File'

type ModelSettingsProp = {
    modelImporting: boolean
    modelLoading: boolean
    exit: () => void
}

const KNOWN_BACKENDS = [
    { label: 'CPU', value: 'CPU' },
    { label: 'OpenCL', value: 'GPUOpenCL' },
    { label: 'Vulkan', value: 'Vulkan' },
    { label: 'Hexagon', value: 'HTP0' },
    { label: 'HTP1', value: 'HTP1' },
    { label: 'RNPU', value: 'RNPU' },
]

const deviceLabels: Record<string, string> = {
    GPUOpenCL: 'OpenCL', HTP0: 'Hexagon', Vulkan: 'Vulkan', RNPU: 'RNPU', CPU: 'CPU',
}

const KV_CACHE_TYPES: { label: string; value: KVCacheType }[] = [
    { label: 'f16', value: 'f16' }, { label: 'f32', value: 'f32' },
    { label: 'q8_0', value: 'q8_0' }, { label: 'q6_k', value: 'q6_k' },
    { label: 'q5_1', value: 'q5_1' }, { label: 'q5_0', value: 'q5_0' },
    { label: 'q4_1', value: 'q4_1' }, { label: 'q4_0', value: 'q4_0' },
    { label: 'iq4_nl', value: 'iq4_nl' },
]

const FLASH_ATTN_MODES: { label: string; value: FlashAttnMode }[] = [
    { label: 'off', value: 'off' }, { label: 'auto', value: 'auto' }, { label: 'on', value: 'on' },
]

const ModelSettings: React.FC<ModelSettingsProp> = ({ modelImporting, modelLoading, exit }) => {
    const { t } = useTranslation()

    const { config, setConfig } = Llama.useLlamaPreferencesStore(
        useShallow((s) => ({ config: s.config, setConfig: s.setConfiguration }))
    )
    const { userPresets, saveUserPreset, deleteUserPreset, getAllPresets } =
        Llama.usePresetsStore(useShallow((s) => ({
            userPresets: s.userPresets,
            saveUserPreset: s.saveUserPreset,
            deleteUserPreset: s.deleteUserPreset,
            getAllPresets: s.getAllPresets,
        })))

    const detectedDevices = useBackendDevices()
    const [saveKV, setSaveKV] = useMMKVBoolean(AppSettings.SaveLocalKV)
    const [autoloadLocal, setAutoloadLocal] = useMMKVBoolean(AppSettings.AutoLoadLocal)
    const [showModelInChat, setShowModelInChat] = useMMKVBoolean(AppSettings.ShowModelInChat)
    const [threadCount] = useMMKVNumber(Global.CPUThreads)
    const [kvSize, setKVSize] = useState(0)
    const [savePresetName, setSavePresetName] = useState('')
    const [showSavePreset, setShowSavePreset] = useState(false)

    useEffect(() => { KV.getKVSize().then(setKVSize) }, [])
    const getKVSize = async () => setKVSize(await KV.getKVSize())

    useFocusEffect(() => {
        const handler = BackHandler.addEventListener('hardwareBackPress', () => { exit(); return true })
        return () => handler.remove()
    })

    if (!config) return null

    const forceGPU = config.force_device ?? false
    const customDeviceName = config.custom_device ?? ''
    const hasAutoGPU = Platform.OS === 'ios' || detectedDevices.length > 1
    const showGPUSlider = hasAutoGPU || forceGPU
    const effectiveDevice = forceGPU
        ? (customDeviceName || config.devices?.[0] || 'CPU')
        : (detectedDevices.join(', ') || 'CPU (auto)')

    const handleDeleteKV = () => {
        Alert.alert({
            title: t('model.alert.deletekv.title'),
            description: t('model.alert.deletekv.description', { size: readableFileSize(kvSize) }),
            buttons: [
                { label: t('common.actions.delete') },
                {
                    label: t('model.alert.deletekv.title'),
                    onPress: async () => { await KV.deleteKV(); Logger.info(t('model.toast.deletekv')); getKVSize() },
                    type: 'warning',
                },
            ],
        })
    }

    const applyPreset = (partialConfig: Partial<LlamaConfig>) => {
        setConfig({ ...config, ...partialConfig })
    }

    const handleSavePreset = () => {
        if (!savePresetName.trim()) return
        saveUserPreset(savePresetName.trim(), config)
        setSavePresetName('')
        setShowSavePreset(false)
        Logger.infoToast(`Preset "${savePresetName.trim()}" guardado`)
    }

    const allPresets = getAllPresets()

    return (
        <Animated.ScrollView
            showsVerticalScrollIndicator={false}
            style={{ flex: 1 }}
            entering={SlideInRight.easing(Easing.inOut(Easing.cubic))}
            exiting={SlideOutRight.easing(Easing.inOut(Easing.cubic))}>

            {/* ── Presets ── */}
            <SectionTitle>🎛 Presets</SectionTitle>
            <View style={{ marginTop: 8, marginBottom: 4 }}>
                <Text style={{ color: '#aaa', fontSize: 12, marginHorizontal: 4, marginBottom: 8 }}>
                    Tocá un preset para aplicarlo. Los presets built-in están optimizados para hardware específico.
                </Text>
                {allPresets.map((preset) => (
                    <View key={preset.id} style={{
                        flexDirection: 'row', alignItems: 'center',
                        marginBottom: 6, gap: 6,
                    }}>
                        <TouchableOpacity
                            style={{
                                flex: 1, backgroundColor: '#1a2a1a', borderRadius: 8,
                                padding: 10, borderWidth: 1, borderColor: '#2d4a2d',
                            }}
                            onPress={() => {
                                applyPreset(preset.config)
                                Logger.infoToast(`Preset "${preset.name}" aplicado`)
                            }}>
                            <Text style={{ color: '#cfe', fontWeight: 'bold', fontSize: 13 }}>
                                {preset.name}
                            </Text>
                            <Text style={{ color: '#888', fontSize: 11, marginTop: 2 }}>
                                {preset.description}
                            </Text>
                        </TouchableOpacity>
                        {!preset.builtin && (
                            <TouchableOpacity
                                style={{
                                    backgroundColor: '#3a1010', borderRadius: 8,
                                    padding: 10, borderWidth: 1, borderColor: '#6a2020',
                                }}
                                onPress={() => {
                                    RNAlert.alert('Eliminar preset', `¿Eliminar "${preset.name}"?`, [
                                        { text: 'Cancelar', style: 'cancel' },
                                        { text: 'Eliminar', style: 'destructive', onPress: () => deleteUserPreset(preset.id) },
                                    ])
                                }}>
                                <Text style={{ color: '#f66', fontSize: 13 }}>✕</Text>
                            </TouchableOpacity>
                        )}
                    </View>
                ))}

                {/* Save current config as preset */}
                {showSavePreset ? (
                    <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
                        <TextInput
                            style={{
                                flex: 1, backgroundColor: '#111', color: '#ddd',
                                borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8,
                                borderWidth: 1, borderColor: '#333', fontSize: 13,
                            }}
                            value={savePresetName}
                            onChangeText={setSavePresetName}
                            placeholder="Nombre del preset..."
                            placeholderTextColor="#555"
                            autoFocus
                        />
                        <TouchableOpacity
                            style={{ backgroundColor: '#1a4a1a', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8, justifyContent: 'center' }}
                            onPress={handleSavePreset}>
                            <Text style={{ color: '#4f4', fontSize: 13, fontWeight: 'bold' }}>OK</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                            style={{ backgroundColor: '#2a1a1a', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8, justifyContent: 'center' }}
                            onPress={() => { setShowSavePreset(false); setSavePresetName('') }}>
                            <Text style={{ color: '#f66', fontSize: 13 }}>✕</Text>
                        </TouchableOpacity>
                    </View>
                ) : (
                    <TouchableOpacity
                        style={{
                            backgroundColor: '#111', borderRadius: 8, padding: 10,
                            borderWidth: 1, borderColor: '#333', marginTop: 4, alignItems: 'center',
                        }}
                        onPress={() => setShowSavePreset(true)}>
                        <Text style={{ color: '#6af', fontSize: 13 }}>＋ Guardar config actual como preset</Text>
                    </TouchableOpacity>
                )}
            </View>

            {/* ── CPU Settings ── */}
            <SectionTitle>{t('model.settings.cpu')}</SectionTitle>
            <View style={{ marginTop: 8 }} />

            <ThemedSlider label={t('model.maxcontext')} value={config.context_length}
                onValueChange={(v) => setConfig({ ...config, context_length: v })}
                min={512} max={32768} step={512} disabled={modelImporting || modelLoading} />
            <ThemedSlider label={t('model.threads')} value={config.threads}
                onValueChange={(v) => setConfig({ ...config, threads: v })}
                min={1} max={threadCount ?? 8} step={1} disabled={modelImporting || modelLoading} />
            <ThemedSlider label={t('model.batch')} value={config.batch}
                onValueChange={(v) => setConfig({ ...config, batch: v })}
                min={1} max={1024} step={1} disabled={modelImporting || modelLoading} />

            <ThemedSwitch label={t('model.usemmap')} value={config.use_mmap}
                description={t('model.usemmapdesc')}
                onChangeValue={(v) => setConfig({ ...config, use_mmap: v })} />
            <ThemedSwitch label={t('model.usemlock')} value={config.use_mlock}
                description={t('model.usemlockdesc')}
                onChangeValue={(v) => setConfig({ ...config, use_mlock: v })} />
            <ThemedSwitch label={t('model.noextrabuf')} value={config.no_extra_buf}
                description={t('model.noextrabufdesc')}
                onChangeValue={(v) => setConfig({ ...config, no_extra_buf: v })} />
            <ThemedSwitch label={t('model.contextshift')} value={config.ctx_shift}
                onChangeValue={(v) => setConfig({ ...config, ctx_shift: v })} />

            {/* ── CPU Affinity ── */}
            <SectionTitle>{t('model.settings.cpuaffinity')}</SectionTitle>
            <View style={{ marginTop: 8, paddingHorizontal: 4, marginBottom: 8 }}>
                <ThemedTextInput label={t('model.cpumask')} value={config.cpu_mask}
                    onChangeText={(v) => setConfig({ ...config, cpu_mask: v })}
                    placeholder="e.g. 4-7  (vacío = automático)" placeholderTextColor="#555" />
            </View>
            <ThemedSwitch label={t('model.cpustrict')} value={config.cpu_strict}
                description={t('model.cpustrictdesc')}
                onChangeValue={(v) => setConfig({ ...config, cpu_strict: v })} />

            {/* ── Context Management ── */}
            <SectionTitle>{t('model.settings.ctxmgmt')}</SectionTitle>
            <View style={{ marginTop: 8 }} />
            <ThemedSlider
                label={t('model.nkeep')}
                value={config.n_keep}
                onValueChange={(v) => setConfig({ ...config, n_keep: v })}
                min={-1} max={2048} step={1}
                disabled={modelImporting || modelLoading} />
            <Text style={{ color: '#aaa', fontSize: 12, marginHorizontal: 4, marginBottom: 12 }}>
                {t('model.nkeepdesc')}
            </Text>
            <ThemedSlider
                label={t('model.defragthold')}
                value={Math.round(config.defrag_thold * 100)}
                onValueChange={(v) => setConfig({ ...config, defrag_thold: v / 100 })}
                min={-1} max={50} step={1}
                disabled={modelImporting || modelLoading} />
            <Text style={{ color: '#aaa', fontSize: 12, marginHorizontal: 4, marginBottom: 12 }}>
                {t('model.defragdesc')} ({config.defrag_thold < 0 ? 'desactivado' : `${Math.round(config.defrag_thold * 100)}%`})
            </Text>

            {/* ── Performance Mode ── */}
            <SectionTitle>{t('model.settings.perfmode')}</SectionTitle>
            <View style={{ marginTop: 8 }} />
            <ThemedSwitch label={t('model.disablelog')} value={config.disable_log}
                description={t('model.disablelogdesc')}
                onChangeValue={(v) => setConfig({ ...config, disable_log: v })} />

            {/* ── GPU / Backend ── */}
            <SectionTitle>{t('model.settings.gpu')}</SectionTitle>
            <View style={{ marginTop: 8 }} />
            {hasAutoGPU && (
                <HorizontalSelector style={{ paddingBottom: 12 }} label={t('model.backenddev')}
                    values={detectedDevices.map((item) => ({ label: deviceLabels[item] ?? item, value: item }))}
                    selected={config.devices?.[0]}
                    onPress={(value) => {
                        const devs = value === 'CPU' ? ['CPU'] : [value, 'CPU']
                        setConfig({ ...config, devices: devs, force_device: false })
                    }} />
            )}
            <ThemedSwitch label={t('model.forcegpu')} value={forceGPU}
                description={t('model.forcegpudesc')}
                onChangeValue={(v) => {
                    if (!v) setConfig({ ...config, force_device: false, devices: [] })
                    else setConfig({ ...config, force_device: true })
                }} />
            {forceGPU && (
                <View style={{ marginTop: 8 }}>
                    <Text style={{ color: '#aaa', fontSize: 12, marginBottom: 6, marginHorizontal: 4 }}>
                        {t('model.forcebackendpick')}
                    </Text>
                    <HorizontalSelector style={{ paddingBottom: 8 }} label=""
                        values={KNOWN_BACKENDS} selected={config.devices?.[0]}
                        onPress={(value) => {
                            const devs = value === 'CPU' ? ['CPU'] : [value, 'CPU']
                            setConfig({ ...config, devices: devs, custom_device: value })
                        }} />
                    <View style={{ paddingHorizontal: 4, marginBottom: 8 }}>
                        <ThemedTextInput label={t('model.forcebackendcustom')} value={customDeviceName}
                            onChangeText={(v) => {
                                const trimmed = v.trim()
                                const devs = !trimmed || trimmed === 'CPU' ? ['CPU'] : [trimmed, 'CPU']
                                setConfig({ ...config, custom_device: trimmed, devices: devs })
                            }}
                            placeholder="GPUOpenCL / Vulkan / HTP0 / RNPU..."
                            placeholderTextColor="#555" autoCapitalize="none" autoCorrect={false} />
                    </View>
                    <Text style={{ color: '#888', fontSize: 12, marginHorizontal: 4, marginBottom: 4 }}>
                        ⚠ {t('model.forcegpuwarn')}
                    </Text>
                    <Text style={{ color: '#6af', fontSize: 12, marginHorizontal: 4, marginBottom: 12 }}>
                        {t('model.forcebackendactive')}: [{effectiveDevice}]
                    </Text>
                </View>
            )}
            {showGPUSlider && (
                <ThemedSlider label={t('model.gpulayers')} value={config.gpu_layers}
                    onValueChange={(v) => setConfig({ ...config, gpu_layers: v })}
                    min={0} max={100} step={1} disabled={modelImporting || modelLoading} />
            )}

            {/* ── Math & Precision ── */}
            <SectionTitle>{t('model.settings.mathprecision')}</SectionTitle>
            <View style={{ marginTop: 8 }} />
            <HorizontalSelector style={{ paddingBottom: 4 }} label={t('model.flashattn')}
                values={FLASH_ATTN_MODES} selected={config.flash_attn}
                onPress={(v) => setConfig({ ...config, flash_attn: v as FlashAttnMode })} />
            <Text style={{ color: '#aaa', fontSize: 12, marginBottom: 12, marginHorizontal: 4 }}>
                {t('model.flashattndesc')}
            </Text>
            <HorizontalSelector style={{ paddingBottom: 4 }} label={t('model.cachetypek')}
                values={KV_CACHE_TYPES} selected={config.cache_type_k}
                onPress={(v) => setConfig({ ...config, cache_type_k: v as KVCacheType })} />
            <HorizontalSelector style={{ paddingBottom: 12 }} label={t('model.cachetypev')}
                values={KV_CACHE_TYPES} selected={config.cache_type_v}
                onPress={(v) => setConfig({ ...config, cache_type_v: v as KVCacheType })} />
            <ThemedSwitch label={t('model.kvunified')} value={config.kv_unified}
                description={t('model.kvunifieddesc')}
                onChangeValue={(v) => setConfig({ ...config, kv_unified: v })} />
            <ThemedSwitch label={t('model.swafull')} value={config.swa_full}
                description={t('model.swafulldesc')}
                onChangeValue={(v) => setConfig({ ...config, swa_full: v })} />

            {/* ── Advanced Performance ── */}
            <SectionTitle>{t('model.settings.advperf')}</SectionTitle>
            <View style={{ marginTop: 8 }} />
            <ThemedSlider label={t('model.ubatch')} value={config.ubatch}
                onValueChange={(v) => setConfig({ ...config, ubatch: v })}
                min={1} max={2048} step={1} disabled={modelImporting || modelLoading} />
            <ThemedSlider label={t('model.ropefreqbase')} value={config.rope_freq_base}
                onValueChange={(v) => setConfig({ ...config, rope_freq_base: v })}
                min={0} max={1000000} step={1000} disabled={modelImporting || modelLoading} />
            <ThemedSlider label={t('model.ropefreqscale')}
                value={Math.round(config.rope_freq_scale * 100)}
                onValueChange={(v) => setConfig({ ...config, rope_freq_scale: v / 100 })}
                min={0} max={100} step={1} disabled={modelImporting || modelLoading} />

            {/* ── Advanced Settings ── */}
            <SectionTitle>{t('model.settings.advanced')}</SectionTitle>
            <ThemedSwitch label={t('model.modelnamechat')} value={showModelInChat}
                onChangeValue={setShowModelInChat} />
            <ThemedSwitch label={t('model.autoload')} value={autoloadLocal}
                onChangeValue={setAutoloadLocal} />
            <ThemedSwitch label={t('model.savekv')} value={saveKV}
                onChangeValue={setSaveKV}
                description={saveKV ? '' : t('model.savekvdesc')} />
            {saveKV && (
                <ThemedButton buttonStyle={{ marginTop: 8 }}
                    label={t('model.purgekv', { size: readableFileSize(kvSize) })}
                    onPress={handleDeleteKV}
                    variant={kvSize === 0 ? 'disabled' : 'critical'} />
            )}
            <View style={{ height: 40 }} />
        </Animated.ScrollView>
    )
}

export default ModelSettings
