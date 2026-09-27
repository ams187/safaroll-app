import { useTranslation as useUiTranslation } from 'react-i18next';
import { requestExpandableCamera } from '@/components/navigation/expandable-camera-state';
import { AnimatedView } from '@/components/ui/animated-view';
import { ImmersiveDialog } from '@/components/ui/immersive-dialog';
import { LiquidPopup } from '@/components/ui/liquid-popup';
import { EmptyState } from '@/components/empty-state';
import type { FeedItem } from '@/components/item-card';
import { MasonryFeed } from '@/components/masonry-feed';
import { api } from '@/lib/supabase/api';
import type { Id } from '@/lib/supabase/api';
import { backendQuery } from '@/lib/supabase/backend';
import { useQuery } from '@tanstack/react-query';
import { useMutation } from '@/lib/supabase/backend';
import * as Haptics from 'expo-haptics';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { ProgressiveBlurHeader } from 'progressive-blur';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { FadeIn, FadeOut } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

export default function SpaceScreen() {
  const { t: copy } = useUiTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { theme } = useUnistyles();
  const { data: space } = useQuery(
    backendQuery(api.spaces.getSpace, { id: id as Id<'spaces'> }),
  );
  const deleteSpace = useMutation(api.spaces.deleteSpace);
  const acceptAllSuggestions = useMutation(api.spaces.acceptAllSuggestions);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [addMenuOpen, setAddMenuOpen] = useState(false);

  // Suggestions lead the feed (they're the ones asking for a decision),
  // wearing the sparkle badge; saved items follow. Item detail rebuilds this
  // exact ordering for swipe-paging, so keep the two in sync.
  const feedItems = useMemo<FeedItem[]>(() => {
    if (!space) return [];
    return [
      ...space.suggestions.map((item) => ({ ...item, suggested: true })),
      ...space.items,
    ];
  }, [space]);

  // `undefined` = loading (nothing cached yet); `null` = not found.
  if (space === undefined) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator />
      </View>
    );
  }

  if (space === null) {
    return (
      <View style={styles.loading}>
        <EmptyState title="Gone" message="This space no longer exists." />
      </View>
    );
  }

  const confirmDelete = () => setConfirmingDelete(true);

  const performDelete = async () => {
    setConfirmingDelete(false);
    router.back();
    await deleteSpace({ id: space._id });
  };

  const addAll = () => {
    if (process.env.EXPO_OS === 'ios') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
    acceptAllSuggestions({ spaceId: space._id });
  };

  const suggestionCount = space.suggestions.length;

  return (
    <>
      <Stack.Title
        style={{
          fontFamily: theme.fonts.display,
          color: theme.colors.foreground,
        }}
      >
        {space.name}
      </Stack.Title>
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Menu icon="ellipsis">
          <Stack.Toolbar.MenuAction
            icon="pencil"
            onPress={() =>
              router.push({ pathname: '/new-space', params: { id } })
            }
          >
            Edit space
          </Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction icon="trash" destructive onPress={confirmDelete}>
            Delete space
          </Stack.Toolbar.MenuAction>
        </Stack.Toolbar.Menu>
      </Stack.Toolbar>
      <View style={styles.container}>
        <MasonryFeed
          items={feedItems}
          source={{ from: 'space', spaceId: id }}
          firstItemZoomTarget
          ListHeaderComponent={
            suggestionCount > 0 ? (
              <AnimatedView
                entering={FadeIn.duration(250)}
                exiting={FadeOut.duration(200)}
                style={styles.suggestionsPill}
              >
                <SymbolView name="sparkles" size={14} tintColor={theme.colors.primaryText} />
                <Text style={styles.suggestionsText}>
                  {suggestionCount === 1
                    ? '1 suggestion'
                    : `${suggestionCount} suggestions`}
                </Text>
                <Pressable
                  onPress={addAll}
                  hitSlop={8}
                  style={({ pressed }) => pressed && { opacity: 0.7 }}
                >
                  <Text style={styles.addAllText}>Add all</Text>
                </Pressable>
              </AnimatedView>
            ) : undefined
          }
          ListEmptyComponent={
            <EmptyState
              title="Nothing here yet"
              message={'SafaRoll is looking for saves that fit this space —\nor add your own with the + above.'}
            />
          }
        />
        <ProgressiveBlurHeader />
        <View style={[styles.fab, { bottom: insets.bottom + 18 }]}>
          <LiquidPopup
            cacheKeys={[space._id, theme.colors.primary]}
            panel={
              <View style={styles.addPanel}>
                <View style={styles.addPanelHeader}>
                  <Text style={styles.addPanelTitle}>{copy("ui_copy_194")}{' '}{space.name}</Text>
                  <Pressable
                    accessibilityLabel={copy("ui_copy_195")}
                    accessibilityRole="button"
                    hitSlop={8}
                    onPress={() => setAddMenuOpen(false)}
                  >
                    <SymbolView name="xmark" size={15} tintColor={theme.colors.muted} />
                  </Pressable>
                </View>
                <LiquidMenuAction
                  icon="square.and.pencil"
                  label={copy("ui_copy_196")}
                  onPress={() => {
                    setAddMenuOpen(false);
                    router.push({ pathname: '/add', params: { spaceId: id } });
                  }}
                />
                <LiquidMenuAction
                  icon="camera.fill"
                  label={copy("ui_copy_197")}
                  onPress={() => {
                    setAddMenuOpen(false);
                    requestExpandableCamera();
                  }}
                />
              </View>
            }
            button={
              <Pressable
                accessibilityLabel={`Ajouter à ${space.name}`}
                accessibilityRole="button"
                onPress={() => setAddMenuOpen(true)}
                style={({ pressed }) => [styles.addFab, pressed && styles.addFabPressed]}
              >
                <SymbolView name="plus" size={23} tintColor={theme.colors.onPrimary} weight="semibold" />
              </Pressable>
            }
            toggled={addMenuOpen}
          />
        </View>
        <ImmersiveDialog visible={confirmingDelete} onDismiss={() => setConfirmingDelete(false)}>
          <View style={styles.dialogCard}>
            <Text style={styles.dialogTitle}>{copy("ui_copy_198")}</Text>
            <Text style={styles.dialogMessage}>
              {copy("ui_copy_199")}</Text>
            <View style={styles.dialogActions}>
              <Pressable style={styles.dialogCancel} onPress={() => setConfirmingDelete(false)}>
                <Text style={styles.dialogCancelText}>{copy("common_cancel")}</Text>
              </Pressable>
              <Pressable style={styles.dialogConfirm} onPress={() => void performDelete()}>
                <Text style={styles.dialogConfirmText}>{copy("card_menu_delete")}</Text>
              </Pressable>
            </View>
          </View>
        </ImmersiveDialog>
      </View>
    </>
  );
}

function LiquidMenuAction({
  icon,
  label,
  onPress,
}: {
  icon: 'camera.fill' | 'square.and.pencil';
  label: string;
  onPress: () => void;
}) {
  const { theme } = useUnistyles();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.addAction, pressed && styles.addActionPressed]}
    >
      <View style={styles.addActionIcon}>
        <SymbolView name={icon} size={18} tintColor={theme.colors.primaryText} />
      </View>
      <Text style={styles.addActionText}>{label}</Text>
      <SymbolView name="chevron.right" size={12} tintColor={theme.colors.muted} />
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
  },
  fab: {
    position: 'absolute',
    right: -2,
    zIndex: 12,
  },
  addFab: {
    width: 58,
    height: 58,
    borderRadius: 29,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.primary,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 7 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 8,
  },
  addFabPressed: {
    transform: [{ scale: 0.94 }],
  },
  addPanel: {
    width: 244,
    overflow: 'hidden',
    borderRadius: 24,
    borderCurve: 'continuous',
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.18,
    shadowRadius: 20,
    elevation: 10,
  },
  addPanelHeader: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 15,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.border,
  },
  addPanelTitle: {
    flex: 1,
    color: theme.colors.foreground,
    fontFamily: theme.fonts.bold,
    fontSize: 13,
  },
  addAction: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    paddingHorizontal: 13,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.border,
  },
  addActionPressed: {
    backgroundColor: theme.colors.surfaceMuted,
  },
  addActionIcon: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.primarySoft,
  },
  addActionText: {
    flex: 1,
    color: theme.colors.foreground,
    fontFamily: theme.fonts.medium,
    fontSize: 13,
  },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.background,
  },
  suggestionsPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.gap(1),
    alignSelf: 'center',
    backgroundColor: theme.colors.primarySoft,
    borderRadius: 50,
    paddingVertical: theme.gap(1),
    paddingHorizontal: theme.gap(2),
    marginTop: theme.gap(0.5),
    marginBottom: theme.gap(1),
  },
  suggestionsText: {
    fontFamily: theme.fonts.medium,
    fontSize: 13,
    color: theme.colors.primaryText,
  },
  addAllText: {
    fontFamily: theme.fonts.bold,
    fontSize: 13,
    color: theme.colors.primaryText,
    textDecorationLine: 'underline',
  },
  dialogCard: {
    alignSelf: 'stretch',
    gap: 10,
    alignItems: 'center',
  },
  dialogTitle: {
    color: '#fff8e5',
    fontFamily: theme.fonts.display,
    fontSize: 26,
    textAlign: 'center',
  },
  dialogMessage: {
    color: 'rgba(255,248,229,0.72)',
    fontFamily: theme.fonts.regular,
    fontSize: 15,
    lineHeight: 21,
    textAlign: 'center',
  },
  dialogActions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 14,
  },
  dialogCancel: {
    minHeight: 48,
    justifyContent: 'center',
    borderRadius: 999,
    paddingHorizontal: 22,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  dialogCancelText: {
    color: '#fff8e5',
    fontFamily: theme.fonts.medium,
    fontSize: 15,
  },
  dialogConfirm: {
    minHeight: 48,
    justifyContent: 'center',
    borderRadius: 999,
    paddingHorizontal: 22,
    backgroundColor: theme.colors.danger,
  },
  dialogConfirmText: {
    color: '#fff8e5',
    fontFamily: theme.fonts.bold,
    fontSize: 15,
  },
}));
