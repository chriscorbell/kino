import { connectNativeExternalNavigation } from './player';

export async function openExternalUrl(url: string): Promise<void> {
  const navigation = await connectNativeExternalNavigation();
  if (!navigation || !(await navigation.openUrl(url))) {
    throw new Error('The system browser could not be opened.');
  }
}
