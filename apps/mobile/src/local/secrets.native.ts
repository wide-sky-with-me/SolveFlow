import * as SecureStore from 'expo-secure-store';
export async function readKey(role: string) { return SecureStore.getItemAsync(`solveflow.local.${role}`); }
export async function writeKey(role: string, key: string | null) { if (key) await SecureStore.setItemAsync(`solveflow.local.${role}`, key, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }); else await SecureStore.deleteItemAsync(`solveflow.local.${role}`); }
