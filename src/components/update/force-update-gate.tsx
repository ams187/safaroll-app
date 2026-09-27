import { Press3D } from '@/components/ui/press-3d';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useState, type PropsWithChildren } from 'react';
import { Linking, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import VersionCheck from 'react-native-version-check';
import { StyleSheet } from 'react-native-unistyles';
import { useTranslation } from 'react-i18next';

const appIcon = require('../../../assets/icon.png');

export function ForceUpdateGate({ children }: PropsWithChildren) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [storeUrl, setStoreUrl] = useState<string | null>(null);

  useEffect(() => {
    if (__DEV__) return;

    let mounted = true;
    void VersionCheck.needUpdate()
      .then((update) => {
        if (mounted && update.isNeeded && update.storeUrl) setStoreUrl(update.storeUrl);
      })
      // A Store outage or an offline phone must not brick every installed app.
      .catch(() => undefined);

    return () => {
      mounted = false;
    };
  }, []);

  const openStore = useCallback(() => {
    if (storeUrl) void Linking.openURL(storeUrl).catch(() => undefined);
  }, [storeUrl]);

  if (!storeUrl) return children;

  return (
    <View style={[styles.screen, { paddingBottom: insets.bottom + 28, paddingTop: insets.top + 28 }]}>
      <StatusBar style="dark" />
      <View style={styles.content}>
        <View style={styles.iconStage}>
          <Image accessibilityIgnoresInvertColors contentFit="cover" source={appIcon} style={styles.icon} />
          <View style={styles.downloadBadge}>
            <Ionicons color="#2b2418" name="arrow-down" size={28} />
          </View>
        </View>

        <Text accessibilityRole="header" style={styles.title}>
          {t('update_required_title')}
        </Text>
        <Text style={styles.body}>{t('update_required_body')}</Text>

        <Press3D
          accessibilityLabel={t('update_required_action')}
          borderRadius={36}
          faceStyle={styles.buttonFace}
          onPress={openStore}
          shadowColor="#8d8271"
          style={styles.button}
          testID="force-update-button"
        >
          <Text style={styles.buttonText}>{t('update_required_action')}</Text>
        </Press3D>
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  screen: {
    flex: 1,
    justifyContent: 'center',
    backgroundColor: theme.colors.background,
    paddingHorizontal: 32,
  },
  content: {
    alignItems: 'center',
    width: '100%',
  },
  iconStage: {
    position: 'relative',
    width: 122,
    height: 122,
    marginBottom: 34,
  },
  icon: {
    width: 112,
    height: 112,
    borderRadius: 27,
  },
  downloadBadge: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 21,
    backgroundColor: theme.colors.surface,
  },
  title: {
    color: theme.colors.foreground,
    fontFamily: theme.fonts.display,
    fontSize: 32,
    lineHeight: 38,
    textAlign: 'center',
  },
  body: {
    maxWidth: 340,
    marginTop: 16,
    color: theme.colors.muted,
    fontFamily: theme.fonts.regular,
    fontSize: 18,
    lineHeight: 25,
    textAlign: 'center',
  },
  button: {
    alignSelf: 'stretch',
    marginTop: 38,
  },
  buttonFace: {
    height: 70,
    backgroundColor: theme.colors.primary,
  },
  buttonText: {
    color: theme.colors.onPrimary,
    fontFamily: theme.fonts.bold,
    fontSize: 18,
  },
}));
