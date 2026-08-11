import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import client from '../api/client';

const PROJECT_ID = '672f434c-fd1e-4f58-bce6-fc4100de3db0';

export async function registerForPushNotifications(): Promise<void> {
  try {
    const { status: existing } = await Notifications.getPermissionsAsync();
    let finalStatus = existing;

    if (existing !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== 'granted') return;

    const pushToken = await Notifications.getExpoPushTokenAsync({ projectId: PROJECT_ID });

    await client.post('/users/push-token', { token: pushToken.data });

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'default',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
      });
    }
  } catch {
    // Notifications are best-effort — never crash the app
  }
}
