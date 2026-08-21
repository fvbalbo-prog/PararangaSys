import { Platform } from 'react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';

/**
 * expo-print's web shim ignores the `html` passed to printToFileAsync and
 * just calls window.print() on whatever's currently on screen — so on web
 * this builds a hidden iframe with the real HTML and prints that instead.
 * Native (iOS/Android) already renders the given html correctly via the
 * native module, so it keeps using Print.printToFileAsync there.
 */
export async function printHtml(html: string, dialogTitle: string) {
  if (Platform.OS === 'web') {
    await new Promise<void>((resolve) => {
      const iframe = document.createElement('iframe');
      iframe.style.position = 'fixed';
      iframe.style.right = '0';
      iframe.style.bottom = '0';
      iframe.style.width = '0';
      iframe.style.height = '0';
      iframe.style.border = '0';
      iframe.onload = () => {
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();
        setTimeout(() => {
          document.body.removeChild(iframe);
          resolve();
        }, 500);
      };
      iframe.srcdoc = html;
      document.body.appendChild(iframe);
    });
    return;
  }
  const { uri } = await Print.printToFileAsync({ html });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle });
  } else {
    await Print.printAsync({ uri });
  }
}
