import { getApp, getApps, initializeApp, type FirebaseApp } from "firebase/app";
import { getStorage, type FirebaseStorage } from "firebase/storage";

function getFirebaseConfig(): Record<string, string> | null {
  const config = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? "",
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ?? "",
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "",
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ?? "",
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID ?? ""
  };

  if (Object.values(config).some((value) => !value.trim())) {
    return null;
  }

  return config;
}

export function hasFirebaseConfig(): boolean {
  return Boolean(getFirebaseConfig());
}

export function getFirebaseApp(): FirebaseApp | null {
  const config = getFirebaseConfig();
  if (!config) {
    return null;
  }

  return getApps().length > 0 ? getApp() : initializeApp(config);
}

export function getFirebaseStorageClient(): FirebaseStorage | null {
  const app = getFirebaseApp();
  return app ? getStorage(app) : null;
}
