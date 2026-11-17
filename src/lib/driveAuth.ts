import { getApp, getApps, initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  type User,
} from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';

const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);

const provider = new GoogleAuthProvider();
provider.addScope('https://www.googleapis.com/auth/drive');

export type DriveAuthClearedReason = 'signed_out' | 'needs_token';

// Token is stored strictly in memory (never localStorage or sessionStorage).
let isSigningIn = false;
let cachedAccessToken: string | null = null;
let tokenObtainedAt: number | null = null;

export function initDriveAuth(
  onAuthSuccess?: (user: User, token: string) => void,
  onAuthCleared?: (reason: DriveAuthClearedReason, user: User | null) => void,
): () => void {
  return onAuthStateChanged(auth, (user) => {
    if (user && cachedAccessToken) {
      onAuthSuccess?.(user, cachedAccessToken);
    } else if (!isSigningIn) {
      if (!user) {
        cachedAccessToken = null;
        tokenObtainedAt = null;
        onAuthCleared?.('signed_out', null);
      } else {
        onAuthCleared?.('needs_token', user);
      }
    }
  });
}

export async function signInWithGoogleDrive(
  loginHint?: string | null,
): Promise<{ user: User; accessToken: string }> {
  isSigningIn = true;
  try {
    if (loginHint) {
      provider.setCustomParameters({ login_hint: loginHint });
    } else {
      provider.setCustomParameters({});
    }
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('Google Drive erişim izni alınamadı.');
    }
    cachedAccessToken = credential.accessToken;
    tokenObtainedAt = Date.now();
    return { user: result.user, accessToken: cachedAccessToken };
  } finally {
    isSigningIn = false;
  }
}

export function getDriveAccessToken(): string | null {
  return cachedAccessToken;
}

export function getDriveTokenAgeMs(): number | null {
  return tokenObtainedAt ? Date.now() - tokenObtainedAt : null;
}

export function clearCachedDriveToken(): void {
  cachedAccessToken = null;
  tokenObtainedAt = null;
}

export async function signOutGoogleDrive(): Promise<void> {
  cachedAccessToken = null;
  tokenObtainedAt = null;
  await auth.signOut();
}
