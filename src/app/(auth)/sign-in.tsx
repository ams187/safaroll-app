import { TermsSheet } from '@/components/legal/terms-sheet';
import { EmailOtpVerification } from '@/components/auth/email-otp-verification';
import { useSSO, useSignIn, useSignUp } from '@clerk/expo';
// Sous-chemin obligatoire : la racine de `@clerk/expo` n'exporte pas ce hook,
// il vit derrière `./apple` (l'implémentation est résolue par plateforme).
import { useSignInWithApple } from '@clerk/expo/apple';
import { APP_NAME } from '@/constants/app';
import { Image } from 'expo-image';
import { SymbolView } from 'expo-symbols';
import React from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useTranslation, useTranslation as useUiTranslation } from 'react-i18next';
import { StyleSheet } from 'react-native-unistyles';

type EmailFlow = 'sign-in' | 'sign-up';
type ClerkError = {
  errors?: { code?: string; longMessage?: string; message?: string }[];
  message?: string;
};

function errorDetails(error: unknown, fallback: string) {
  const clerkError = error as ClerkError | null;
  const first = clerkError?.errors?.[0];

  return {
    code: first?.code,
    message: first?.longMessage ?? first?.message ?? clerkError?.message ?? fallback,
  };
}

export default function SignInScreen() {
  const { t: copy } = useUiTranslation();
  const { t } = useTranslation();
  const { startSSOFlow } = useSSO();
  const { startAppleAuthenticationFlow } = useSignInWithApple();
  const { signIn, errors: signInErrors, fetchStatus: signInStatus } = useSignIn();
  const { signUp, errors: signUpErrors, fetchStatus: signUpStatus } = useSignUp();
  const [termsOpen, setTermsOpen] = React.useState(false);
  const [email, setEmail] = React.useState('');
  const [flow, setFlow] = React.useState<EmailFlow>('sign-in');
  const [showCode, setShowCode] = React.useState(false);
  const [ssoPending, setSsoPending] = React.useState(false);
  const [formError, setFormError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  const pending =
    ssoPending || signInStatus === 'fetching' || signUpStatus === 'fetching';
  const clerkFieldError = showCode
    ? signInErrors?.fields.code?.message ?? signUpErrors?.fields.code?.message
    : signInErrors?.fields.identifier?.message ?? signUpErrors?.fields.emailAddress?.message;
  const visibleError = formError ?? clerkFieldError;

  const clearMessages = () => {
    setFormError(null);
    setNotice(null);
  };

  const runSafely = (action: () => Promise<void>) => {
    void action().catch((error) => {
      setFormError(errorDetails(error, t('auth_network_error')).message);
    });
  };

  const continueWithSSO = async (strategy: 'oauth_apple' | 'oauth_google') => {
    clearMessages();
    setSsoPending(true);

    try {
      // APPLE PASSE PAR LA FEUILLE NATIVE, PAS PAR LE NAVIGATEUR.
      //
      // `startSSOFlow` ouvre Safari en vue web ; `startAppleAuthenticationFlow`
      // appelle AuthenticationServices et l'utilisateur valide par Face ID sans
      // quitter l'app. Les deux rendent la MÊME forme
      // (`createdSessionId` / `setActive` / `signUp`), donc la suite ne change pas.
      //
      // Google reste en web : il n'a pas d'équivalent natif sans embarquer son
      // propre SDK, et ça ne vaut pas une dépendance de plus.
      const result =
        strategy === 'oauth_apple' && Platform.OS === 'ios'
          ? await startAppleAuthenticationFlow()
          : await startSSOFlow({ strategy });

      if (result.createdSessionId && result.setActive) {
        await result.setActive({ session: result.createdSessionId });
      } else if (result.signUp?.status === 'missing_requirements') {
        setFormError(t('auth_clerk_more_info'));
      }
    } catch (error) {
      // Fermer la feuille native n'est pas une panne. Le flux web se contentait
      // de rendre un résultat vide ; Apple, lui, LÈVE `ERR_REQUEST_CANCELED` —
      // sans ce filtre, annuler afficherait « erreur réseau ».
      if ((error as { code?: string } | null)?.code !== 'ERR_REQUEST_CANCELED') {
        setFormError(errorDetails(error, t('auth_network_error')).message);
      }
    } finally {
      setSsoPending(false);
    }
  };

  const sendEmailCode = async () => {
    if (!signIn || !signUp) return;

    clearMessages();
    const normalizedEmail = email.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(normalizedEmail)) {
      setFormError(t('auth_invalid_email'));
      return;
    }

    setEmail(normalizedEmail);
    const signInResult = await signIn.emailCode.sendCode({ emailAddress: normalizedEmail });

    if (!signInResult.error) {
      setFlow('sign-in');
      setShowCode(true);
      return;
    }

    const details = errorDetails(signInResult.error, t('auth_generic_error'));
    if (details.code !== 'form_identifier_not_found') {
      setFormError(details.message);
      return;
    }

    const createResult = await signUp.create({ emailAddress: normalizedEmail });
    if (createResult.error) {
      setFormError(errorDetails(createResult.error, t('auth_generic_error')).message);
      return;
    }

    const sendResult = await signUp.verifications.sendEmailCode();
    if (sendResult.error) {
      setFormError(errorDetails(sendResult.error, t('auth_generic_error')).message);
      return;
    }

    setFlow('sign-up');
    setShowCode(true);
  };

  const verifyCode = async (code: string) => {
    if (!signIn || !signUp) return false;

    clearMessages();
    const normalizedCode = code.replace(/\D/g, '');
    if (normalizedCode.length < 6) {
      setFormError(t('auth_code_incomplete'));
      return false;
    }

    try {
      const result =
        flow === 'sign-in'
          ? await signIn.emailCode.verifyCode({ code: normalizedCode })
          : await signUp.verifications.verifyEmailCode({ code: normalizedCode });

      if (result.error) {
        setFormError(errorDetails(result.error, t('auth_generic_error')).message);
        return false;
      }

      const resource = flow === 'sign-in' ? signIn : signUp;
      if (resource.status === 'complete') {
        await resource.finalize();
        return true;
      }

      setFormError(t('auth_extra_step'));
      return false;
    } catch (error) {
      setFormError(errorDetails(error, t('auth_network_error')).message);
      return false;
    }
  };

  const resendCode = async () => {
    if (!signIn || !signUp) return;

    clearMessages();
    const result =
      flow === 'sign-in'
        ? await signIn.emailCode.sendCode()
        : await signUp.verifications.sendEmailCode();

    if (result.error) {
      setFormError(errorDetails(result.error, t('auth_generic_error')).message);
    } else {
      setNotice(t('auth_code_resent'));
    }
  };

  const changeEmail = () => {
    signIn?.reset();
    signUp?.reset();
    setShowCode(false);
    clearMessages();
  };

  const handleDevLogin = async () => {
    if (!signIn) return;
    const password = process.env.EXPO_PUBLIC_DEV_PASSWORD;
    if (!password) {
      setFormError(t('auth_dev_password_missing'));
      return;
    }

    clearMessages();
    const result = await signIn.password({
      identifier: 'dev+clerk_test@example.com',
      password,
    });

    if (result.error) setFormError(errorDetails(result.error, t('auth_generic_error')).message);
    else if (signIn.status === 'complete') await signIn.finalize();
  };

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.hero}>
          <Image
            accessibilityLabel={copy("ui_copy_140")}
            contentFit="contain"
            source={require('../../../assets/icon.png')}
            style={styles.appLogo}
          />
          <Text style={styles.brand}>{APP_NAME}</Text>
          <Text style={styles.tagline}>{t('auth_tagline')}</Text>
        </View>

        <View style={styles.panel}>
          <Text style={styles.eyebrow}>{showCode ? t('auth_eyebrow_code') : t('auth_eyebrow')}</Text>
          <Text style={styles.title}>{showCode ? t('auth_check_email') : t('auth_title')}</Text>
          <Text style={styles.subtitle}>
            {showCode
              ? t('auth_code_sent', { email })
              : t('auth_subtitle')}
          </Text>

          {!showCode ? (
            <>
              <View style={styles.socialRow}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('auth_apple')}
                  disabled={pending}
                  onPress={() => continueWithSSO('oauth_apple')}
                  style={({ pressed }) => [
                    styles.socialButton,
                    styles.appleButton,
                    (pressed || pending) && styles.pressed,
                  ]}
                >
                  <SymbolView name="apple.logo" tintColor="#ffffff" size={20} />
                  <Text style={styles.appleText}>Apple</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('auth_google')}
                  disabled={pending}
                  onPress={() => continueWithSSO('oauth_google')}
                  style={({ pressed }) => [
                    styles.socialButton,
                    styles.googleButton,
                    (pressed || pending) && styles.pressed,
                  ]}
                >
                  <Text style={styles.googleMark}>G</Text>
                  <Text style={styles.googleText}>Google</Text>
                </Pressable>
              </View>

              <View style={styles.dividerRow}>
                <View style={styles.divider} />
                <Text style={styles.dividerText}>{t('auth_divider_email')}</Text>
                <View style={styles.divider} />
              </View>

              <Text style={styles.label}>{t('auth_email_label')}</Text>
              <View style={styles.inputShell}>
                <SymbolView name="envelope.fill" tintColor="#7a847e" size={17} />
                <TextInput
                  autoCapitalize="none"
                  autoComplete="email"
                  autoCorrect={false}
                  editable={!pending}
                  keyboardType="email-address"
                  onChangeText={(value) => {
                    setEmail(value);
                    clearMessages();
                  }}
                  onSubmitEditing={() => runSafely(sendEmailCode)}
                  placeholder={copy("ui_copy_141")}
                  placeholderTextColor="#8b918d"
                  returnKeyType="next"
                  style={styles.input}
                  textContentType="emailAddress"
                  value={email}
                />
              </View>

              <Pressable
                accessibilityRole="button"
                disabled={pending}
                onPress={() => runSafely(sendEmailCode)}
                style={({ pressed }) => [
                  styles.primaryButton,
                  (pressed || pending) && styles.pressed,
                ]}
              >
                {pending ? (
                  <ActivityIndicator color="#07130e" />
                ) : (
                  <>
                    <Text style={styles.primaryText}>{t('auth_continue')}</Text>
                    <SymbolView name="arrow.right" tintColor="#07130e" size={17} />
                  </>
                )}
              </Pressable>
            </>
          ) : (
            <>
              <EmailOtpVerification onVerify={verifyCode} />
              <View style={styles.codeActions}>
                <Pressable disabled={pending} onPress={changeEmail}>
                  <Text style={styles.textButton}>{t('auth_change_email')}</Text>
                </Pressable>
                <Pressable disabled={pending} onPress={() => runSafely(resendCode)}>
                  <Text style={styles.textButton}>{t('auth_resend_code')}</Text>
                </Pressable>
              </View>
            </>
          )}

          {!!visibleError && (
            <View accessibilityLiveRegion="polite" style={styles.messageError}>
              <SymbolView name="exclamationmark.circle.fill" tintColor="#b33b32" size={17} />
              <Text style={styles.errorText}>{visibleError}</Text>
            </View>
          )}
          {!!notice && <Text style={styles.notice}>{notice}</Text>}
          <View nativeID="clerk-captcha" />

          {__DEV__ && !showCode && (
            <Pressable
              testID="dev-login-button"
              disabled={pending}
              onPress={() => runSafely(handleDevLogin)}
            >
              <Text style={styles.devLink}>{t('auth_dev_signin')}</Text>
            </Pressable>
          )}
        </View>

        {/* L'acceptation exigée par la directive Apple 1.2. La ligne ÉTAIT du
            texte mort : accepter des conditions qu'on ne peut pas lire n'est
            pas accepter. Elle ouvre maintenant le texte, tolérance zéro
            comprise. */}
        <Pressable onPress={() => setTermsOpen(true)}>
          <Text style={styles.legal}>
            {t('auth_legal_prefix')}
            <Text style={styles.legalLink}>{t('auth_legal_terms')}</Text>
            {t('auth_legal_suffix')}
          </Text>
        </Pressable>
        <TermsSheet onClose={() => setTermsOpen(false)} visible={termsOpen} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create((theme, rt) => ({
  screen: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  content: {
    flexGrow: 1,
    paddingTop: rt.insets.top + 28,
    paddingBottom: rt.insets.bottom + 20,
    paddingHorizontal: 20,
    justifyContent: 'center',
  },
  hero: {
    alignItems: 'center',
    paddingBottom: 24,
  },
  appLogo: {
    width: 104,
    height: 104,
    borderRadius: 24,
    marginBottom: 18,
  },
  brand: {
    marginTop: -4,
    color: theme.colors.foreground,
    fontFamily: theme.fonts.display,
    fontSize: 56,
  },
  tagline: {
    color: theme.colors.muted,
    fontFamily: theme.fonts.regular,
    fontSize: 14,
    marginTop: 4,
  },
  panel: {
    width: '100%',
    maxWidth: 430,
    alignSelf: 'center',
    backgroundColor: '#fffdf3',
    borderRadius: 26,
    padding: 22,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.42)',
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 16 },
  },
  eyebrow: {
    color: '#557063',
    fontFamily: theme.fonts.bold,
    fontSize: 10,
    letterSpacing: 1.8,
  },
  title: {
    color: '#102019',
    fontFamily: theme.fonts.bold,
    fontSize: 25,
    marginTop: 7,
  },
  subtitle: {
    color: '#68736d',
    fontFamily: theme.fonts.regular,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 6,
    marginBottom: 20,
  },
  socialRow: {
    flexDirection: 'row',
    gap: 10,
  },
  socialButton: {
    flex: 1,
    height: 50,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
  },
  appleButton: {
    backgroundColor: '#0c1511',
  },
  googleButton: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#dfe3df',
  },
  appleText: {
    color: '#ffffff',
    fontFamily: theme.fonts.medium,
    fontSize: 15,
  },
  googleMark: {
    color: '#4285f4',
    fontFamily: theme.fonts.bold,
    fontSize: 19,
  },
  googleText: {
    color: '#18231d',
    fontFamily: theme.fonts.medium,
    fontSize: 15,
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginVertical: 18,
  },
  divider: {
    flex: 1,
    height: 1,
    backgroundColor: '#e1e5e1',
  },
  dividerText: {
    color: '#929b96',
    fontFamily: theme.fonts.bold,
    fontSize: 9,
    letterSpacing: 1.3,
  },
  label: {
    color: '#334139',
    fontFamily: theme.fonts.medium,
    fontSize: 12,
    marginBottom: 7,
  },
  inputShell: {
    height: 52,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#d8ded9',
    backgroundColor: '#f6f5ef',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    gap: 10,
  },
  input: {
    flex: 1,
    height: '100%',
    color: '#122019',
    fontFamily: theme.fonts.regular,
    fontSize: 15,
  },
  primaryButton: {
    height: 52,
    borderRadius: 14,
    backgroundColor: theme.colors.primarySoft,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    marginTop: 12,
  },
  primaryText: {
    color: '#07130e',
    fontFamily: theme.fonts.bold,
    fontSize: 15,
  },
  pressed: {
    opacity: 0.58,
  },
  codeActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 16,
  },
  textButton: {
    color: '#35644d',
    fontFamily: theme.fonts.medium,
    fontSize: 12,
  },
  messageError: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: '#fbeceb',
    borderRadius: 11,
    padding: 11,
    marginTop: 14,
  },
  errorText: {
    flex: 1,
    color: '#8f2e28',
    fontFamily: theme.fonts.regular,
    fontSize: 12,
    lineHeight: 17,
  },
  notice: {
    color: '#35644d',
    fontFamily: theme.fonts.medium,
    fontSize: 12,
    textAlign: 'center',
    marginTop: 12,
  },
  devLink: {
    color: '#8b928e',
    fontFamily: theme.fonts.regular,
    fontSize: 11,
    textAlign: 'center',
    marginTop: 15,
  },
  legalLink: {
    color: '#b7c6bd',
    textDecorationLine: 'underline',
  },
  legal: {
    maxWidth: 390,
    alignSelf: 'center',
    color: '#76857d',
    fontFamily: theme.fonts.regular,
    fontSize: 10,
    lineHeight: 15,
    textAlign: 'center',
    marginTop: 15,
    paddingHorizontal: 18,
  },
}));
