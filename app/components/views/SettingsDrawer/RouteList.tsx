import AntDesign, { AntDesignIconName } from '@react-native-vector-icons/ant-design/static'
import { Href, useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useMMKVBoolean } from 'react-native-mmkv'

import { AppSettings } from '@lib/constants/GlobalValues'
import { useAppMode } from '@lib/state/AppMode'
import { Theme } from '@lib/theme/ThemeManager'

type ButtonData = {
    name: string
    path: Href
    icon?: AntDesignIconName
}

type DrawerButtonProps = {
    item: ButtonData
    index: number
}

const DrawerButton = ({ item, index }: DrawerButtonProps) => {
    const styles = useStyles()
    const router = useRouter()
    const { color } = Theme.useTheme()
    return (
        <View key={index}>
            <TouchableOpacity
                style={styles.largeButton}
                onPress={() => {
                    router.push(item.path)
                }}>
                <AntDesign size={24} name={item.icon ?? 'question'} color={color.text._400} />
                <Text style={styles.largeButtonText}>{item.name}</Text>
            </TouchableOpacity>
        </View>
    )
}

const RouteList = () => {
    const { t } = useTranslation()
    const [devMode] = useMMKVBoolean(AppSettings.DevMode)
    const { appMode } = useAppMode()
    const paths = getPaths(appMode === 'remote', t)
    return (
        <FlatList
            showsVerticalScrollIndicator={false}
            data={__DEV__ || devMode ? [...paths, ...paths_dev(t)] : paths}
            renderItem={({ item, index }) => <DrawerButton item={item} index={index} />}
            keyExtractor={(item) => item.path.toString()}
        />
    )
}

export default RouteList

const useStyles = () => {
    const { color, spacing, fontSize } = Theme.useTheme()
    return StyleSheet.create({
        largeButtonText: {
            fontSize: fontSize.xl,
            paddingVertical: spacing.l,
            paddingLeft: spacing.xl,
            color: color.text._100,
        },

        largeButton: {
            paddingLeft: spacing.xl,
            flexDirection: 'row',
            alignItems: 'center',
        },
    })
}

const getPaths = (remote: boolean, t: (input: string) => string): ButtonData[] => [
    false ? { name: '', path: '/' as any } : {
              name: t('navigation.models'),
              path: '/screens/ModelManagerScreen',
              icon: 'branches',
          },
    {
        name: t('navigation.sampler'),
        path: '/screens/SamplerManagerScreen',
        icon: 'control',
    },
    {
        name: t('navigation.formatting'),
        path: '/screens/FormattingManagerScreen',
        icon: 'profile',
    },
    // DataSources y TTS eliminados para reducir overhead
    {
        name: t('navigation.logs'),
        path: '/screens/LogsScreen',
        icon: 'code',
    },
    {
        name: t('navigation.about'),
        path: '/screens/AboutScreen',
        icon: 'info-circle',
    },
    {
        name: t('navigation.settings'),
        path: '/screens/AppSettingsScreen',
        icon: 'setting',
    },
]

const paths_dev = (t: any): ButtonData[] => [
    /*{
        name: '[DEV] HF',
        path: '/HFTest',
    },*/
    {
        name: t('navigation.dev_components'),
        path: '/screens/ComponentTestScreen',
    },
    {
        name: t('navigation.dev_colortest'),
        path: '/screens/ColorTestScreen',
    },
    {
        name: t('navigation.dev_markdown'),
        path: '/screens/MarkdownTestScreen',
    },
]
